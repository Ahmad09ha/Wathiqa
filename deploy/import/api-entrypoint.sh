#!/bin/sh
# Secret files must be mounted externally, never committed or baked into image.
set -eu
umask 077
: "${WATHIQA_DB_PASSWORD_FILE:=/run/secrets/import_db_password}"
: "${WATHIQA_DP_PASSWORD_FILE:=/run/secrets/import_dp_password}"
: "${WATHIQA_DB_HOST:=postgres}"
: "${WATHIQA_DB_NAME:=wathiqa_import}"
: "${WATHIQA_DB_USER:=wathiqa_import}"
[ -r "$WATHIQA_DB_PASSWORD_FILE" ] || { echo 'Missing database secret' >&2; exit 1; }
[ -r "$WATHIQA_DP_PASSWORD_FILE" ] || { echo 'Missing PFX password secret' >&2; exit 1; }
db_password="$(cat "$WATHIQA_DB_PASSWORD_FILE")"
# Strict safe alphabet for Npgsql connection-string semantics. Generate a
# random 48+ character secret using URL-safe base64 and do not embed arbitrary
# semicolons/quotes into a connection string.
case "$db_password" in
  *[!a-zA-Z0-9._~-]*|'') echo 'DB secret needs URL-safe alphabet' >&2; exit 1 ;;
esac
[ "${#db_password}" -ge 24 ] || { echo 'Database password is too short' >&2; exit 1; }
export ConnectionStrings__ImportDatabase="Host=$WATHIQA_DB_HOST;Port=5432;Database=$WATHIQA_DB_NAME;Username=$WATHIQA_DB_USER;Password=$db_password;Pooling=true"
export DataProtection__CertificatePassword="$(cat "$WATHIQA_DP_PASSWORD_FILE")"
[ -n "$DataProtection__CertificatePassword" ] || { echo 'Empty PFX password' >&2; exit 1; }
# Seed is a ONE-SHOT operator action. Secrets live in individual external
# files; they are not stored in the repo or docker-compose environment values.
if [ "${1:-}" = '--seed-access-accounts' ]; then
  for required in trial_email trial_password unlimited_email unlimited_password; do
    file="/run/secrets/import_${required}"
    [ -s "$file" ] || { echo "Missing seed secret: $required" >&2; exit 1; }
  done
  export WATHIQA_TRIAL_EMAIL="$(cat /run/secrets/import_trial_email)"
  export WATHIQA_TRIAL_PASSWORD="$(cat /run/secrets/import_trial_password)"
  export WATHIQA_UNLIMITED_EMAIL="$(cat /run/secrets/import_unlimited_email)"
  export WATHIQA_UNLIMITED_PASSWORD="$(cat /run/secrets/import_unlimited_password)"
fi
unset db_password
exec dotnet /app/Wathiqa.ImportApi.dll "$@"
