#!/usr/bin/env bash
# Wathiqa Import — encrypted off-host VPS backup.
# Run in a dedicated backup job with access to app document & key volumes.
# Requires PostgreSQL pg_dump/psql, restic, sha256sum, mktemp.
set -Eeuo pipefail
umask 077
die(){ echo "BACKUP_ERROR: $*" >&2; exit 1; }
for tool in pg_dump psql restic sha256sum mktemp; do
  command -v "$tool" >/dev/null || die "Missing executable: $tool"
done
: "${PGHOST:?Specify PostgreSQL host in the job environment}"
: "${PGPORT:?Specify PostgreSQL port in the job environment}"
: "${PGUSER:?Specify restricted PostgreSQL user in the job environment}"
: "${PGDATABASE:?Specify Wathiqa Import database}"
: "${PGPASSFILE:?Use a private PostgreSQL password file, not a CLI password}"
: "${RESTIC_REPOSITORY:?Configure the remote encrypted restic repository}"
: "${RESTIC_PASSWORD_FILE:?Configure a private restic key file}"
: "${WATHIQA_DOCUMENTS_ROOT:?Point to Documents__PrivateRoot volume}"
: "${WATHIQA_DP_KEYS_ROOT:?Point to DataProtection__KeysPath volume}"
: "${WATHIQA_DP_CERT_PATH:?Absolute path to the encrypted key-ring PFX certificate}"
: "${WATHIQA_BACKUP_TMP_ROOT:?Point to a private backup staging volume}"

[[ "$PGDATABASE" != "hussam_templates" && "$PGDATABASE" != "wathiqa_docs" ]] ||
  die "Refusing to backup the unrelated legacy editor DB"
# Backups must leave the VPS in encrypted form. No plaintext local repository.
case "$RESTIC_REPOSITORY" in
  s3:*|sftp:*|b2:*|azure:*|gs:*|rest:*) ;;
  *) die "RESTIC_REPOSITORY must be an OFF-HOST backend, not a local filesystem path" ;;
esac
[[ -f "$PGPASSFILE" && -r "$PGPASSFILE" ]] || die "PGPASSFILE missing/unreadable"
[[ -f "$RESTIC_PASSWORD_FILE" && -s "$RESTIC_PASSWORD_FILE" ]] ||
  die "RESTIC_PASSWORD_FILE missing/empty"
for path in "$WATHIQA_DOCUMENTS_ROOT" "$WATHIQA_DP_KEYS_ROOT" "$WATHIQA_BACKUP_TMP_ROOT"; do
  [[ "$path" == /* && -d "$path" ]] || die "Backup paths must exist and be absolute: $path"
done
[[ "$WATHIQA_DOCUMENTS_ROOT" != "$WATHIQA_DP_KEYS_ROOT" ]] ||
  die "Documents and DP keys must use separate private volumes"
[[ -n "$(find "$WATHIQA_DP_KEYS_ROOT" -maxdepth 1 -type f -name 'key-*.xml' -print -quit)" ]] ||
  die "Cannot back up an empty ASP.NET Data Protection key ring"
[[ "$WATHIQA_DP_CERT_PATH" == /* && -f "$WATHIQA_DP_CERT_PATH" && -r "$WATHIQA_DP_CERT_PATH" ]] ||
  die "Cannot back up encrypted DP keys without a recoverable PFX private key"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"
actual="$(psql -X -v ON_ERROR_STOP=1 -Atq -c 'SELECT current_database()')" ||
  die "Could not connect to Import PostgreSQL"
[[ "$actual" == "$PGDATABASE" ]] || die "Connected to the wrong DB"
restic snapshots --json >/dev/null ||
  die "Encrypted remote restic repository is missing/unavailable (initialize securely before running backups)"
work="$(mktemp -d -p "$WATHIQA_BACKUP_TMP_ROOT" 'wathiqa-backup.XXXXXXXX')" ||
  die "Could not allocate secure temporary backup directory"
cleanup(){ rm -rf -- "$work"; }
trap cleanup EXIT
trap 'die "Backup interrupted"' HUP INT TERM

# FIRST capture a consistent database snapshot. Then copy immutable private
# blobs. Blobs added later can be extra; no DB-referenced blob can be omitted
# as long as application code does not physically purge files while backing up.
pg_dump --format=custom --no-owner --no-privileges --file="$work/wathiqa-import.dump" ||
  die "pg_dump failed"
[[ -s "$work/wathiqa-import.dump" ]] || die "Empty PostgreSQL dump"
(
  cd "$work"
  sha256sum wathiqa-import.dump > db.sha256
  {
    printf 'product=Wathiqa.Import\n'
    printf 'created_utc=%s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    printf 'database=%s\n' "$PGDATABASE"
    printf 'document_root=%s\n' "$WATHIQA_DOCUMENTS_ROOT"
    printf 'data_protection_keys_root=%s\n' "$WATHIQA_DP_KEYS_ROOT"
    printf 'data_protection_certificate_path=%s\n' "$WATHIQA_DP_CERT_PATH"
  } > manifest.txt
)
# restic encrypts before sending to remote. Exit 3 (incomplete snapshot)
# is a FAILURE. --exclude covers in-progress scanner *.pending uploads.
restic backup --tag wathiqa-import --exclude '*.pending' \
  "$work/wathiqa-import.dump" "$work/db.sha256" "$work/manifest.txt" \
  "$WATHIQA_DOCUMENTS_ROOT" "$WATHIQA_DP_KEYS_ROOT" "$WATHIQA_DP_CERT_PATH" ||
  die "Encrypted off-host restic snapshot failed or was incomplete"
echo "WATHIQA_ENCRYPTED_OFFHOST_BACKUP=SUCCESS"
echo "RESTORE_REHEARSAL_REQUIRED=Use scripts/vps/restore-rehearsal.sh on an isolated staging server"
# Does not prune backups or impose a retention policy.
