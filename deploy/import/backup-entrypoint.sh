#!/bin/sh
# One-shot container is destroyed after use. The DB credential is passed as a
# Compose secret file, never via a Docker inspect-visible environment value.
set -eu
umask 077
test -r /run/secrets/import_db_password || { echo 'Missing database secret' >&2; exit 1; }
export PGHOST=postgres PGPORT=5432 PGUSER=wathiqa_import PGDATABASE=wathiqa_import
export PGCONNECT_TIMEOUT=10
export PGPASSFILE=/tmp/wathiqa-qa-pgpass
printf 'postgres:5432:wathiqa_import:wathiqa_import:%s\n' "$(cat /run/secrets/import_db_password)" > "$PGPASSFILE"
chmod 0600 "$PGPASSFILE"
export RESTIC_PASSWORD_FILE=/run/secrets/import_restic_password
if [ -r /run/secrets/import_s3_access_key ] && [ -r /run/secrets/import_s3_secret_key ]; then
  export AWS_ACCESS_KEY_ID="$(cat /run/secrets/import_s3_access_key)"
  export AWS_SECRET_ACCESS_KEY="$(cat /run/secrets/import_s3_secret_key)"
fi
export WATHIQA_DOCUMENTS_ROOT=/var/lib/wathiqa/documents
export WATHIQA_DP_KEYS_ROOT=/var/lib/wathiqa/keys
export WATHIQA_DP_CERT_PATH=/run/secrets/import_dp_certificate
export WATHIQA_BACKUP_TMP_ROOT=/var/lib/wathiqa/backup_tmp
exec /bin/bash /opt/wathiqa/backup-import.sh
