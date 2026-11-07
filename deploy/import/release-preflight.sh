#!/usr/bin/env bash
# Run ON THE VPS. Static checks only, not permission to release to Production.
set -Eeuo pipefail
die(){ echo "WATHIQA_RELEASE_PRECHECK_BLOCKED: $*" >&2; exit 1; }
for tool in docker openssl bash; do
  command -v "$tool" >/dev/null || die "Missing $tool"
done
[[ -f deploy/import/compose.yml && -f deploy/import/.env ]] ||
  die 'Run from the repository root after creating deploy/import/.env'
set -a
# shellcheck disable=SC1091
source deploy/import/.env
set +a
: "${WATHIQA_PRIVATE_SUBNET:?Set private Docker CIDR}"
: "${WATHIQA_WEB_IP:?Set static frontend address inside private CIDR}"
: "${WATHIQA_PRIVATE_ROOT:?Set private persistent host root}"
: "${WATHIQA_SECRETS_ROOT:?Set external secret directory}"
: "${RESTIC_REPOSITORY:?Off-host encrypted restic repo required}"
[[ "$WATHIQA_PRIVATE_ROOT" == /* && "$WATHIQA_SECRETS_ROOT" == /* ]] ||
  die 'Persistent and secret roots must be absolute paths'
[[ "$WATHIQA_PRIVATE_ROOT" != "$WATHIQA_SECRETS_ROOT" ]] ||
  die 'Private documents and secret files cannot share the same root'
case "$RESTIC_REPOSITORY" in
  s3:*|sftp:*|b2:*|azure:*|gs:*|rest:*) ;;
  *) die 'Backup must use an off-host restic backend' ;;
esac
for dir in "$WATHIQA_PRIVATE_ROOT/documents" "$WATHIQA_PRIVATE_ROOT/keys" \
           "$WATHIQA_PRIVATE_ROOT/backup_tmp" "$WATHIQA_SECRETS_ROOT"; do
  [[ -d "$dir" ]] || die "Missing persistent directory: $dir"
done
for filename in import_db_password import_dp_certificate.pfx import_dp_password \
  import_restic_password import_trial_email import_trial_password \
  import_unlimited_email import_unlimited_password import_superadmin_email \
  import_superadmin_password import_s3_access_key import_s3_secret_key; do
  [[ -s "$WATHIQA_SECRETS_ROOT/$filename" ]] || die "Missing secret file: $filename"
done
openssl pkcs12 -in "$WATHIQA_SECRETS_ROOT/import_dp_certificate.pfx" \
  -passin "file:$WATHIQA_SECRETS_ROOT/import_dp_password" \
  -nocerts -nodes -out /dev/null >/dev/null 2>&1 ||
  die 'PFX certificate cannot be decrypted using the supplied password'
bash -n deploy/import/api-entrypoint.sh deploy/import/backup-entrypoint.sh \
  scripts/vps/backup-import.sh scripts/vps/restore-rehearsal.sh || die 'Bash syntax failed'
docker info >/dev/null || die 'Docker daemon is not accessible'
docker network inspect dokploy-network >/dev/null || die 'Dokploy ingress network missing'
docker compose --env-file deploy/import/.env -f deploy/import/compose.yml \
  --profile ops config --quiet || die 'Compose config invalid'
echo 'WATHIQA_STATIC_RELEASE_PREFLIGHT=PASS'
echo 'PENDING=Actual image build, EICAR, HTTPS, off-host restore and merchant pilot'
