#!/usr/bin/env bash
# Wathiqa — off-host restic restore rehearsal. STAGING SERVER ONLY.
# Restores exactly one selected snapshot to an isolated QA database + folder.
# NEVER restores over a production DB, document volume, or key ring.
set -Eeuo pipefail
umask 077
die(){ echo "RESTORE_QA_ERROR: $*" >&2; exit 1; }
[[ "${WATHIQA_STAGING_RESTORE_ACK:-}" == "I_AM_ON_ISOLATED_STAGING" ]] ||
  die "Set WATHIQA_STAGING_RESTORE_ACK=I_AM_ON_ISOLATED_STAGING only on a staging host"
for tool in psql createdb dropdb pg_restore restic sha256sum mktemp openssl od tr cut grep find; do
  command -v "$tool" >/dev/null || die "Missing executable: $tool"
done
: "${RESTIC_REPOSITORY:?Encrypted off-host repository required}"
: "${RESTIC_PASSWORD_FILE:?Encrypted restic password file required}"
: "${RESTIC_SNAPSHOT_ID:?Explicit backup snapshot ID required}"
: "${PGHOST:?Staging PostgreSQL host required}"
: "${PGPORT:?Staging PostgreSQL port required}"
: "${PGUSER:?Staging PostgreSQL operator with CREATEDB required}"
: "${PGDATABASE:?Must connect to the maintenance DB postgres}"
: "${PGPASSFILE:?Staging PostgreSQL operator password file required}"
: "${WATHIQA_DOCUMENTS_ROOT:?Original backup documents volume path required}"
: "${WATHIQA_DP_KEYS_ROOT:?Original backup key-ring volume path required}"
: "${WATHIQA_DP_CERT_PATH:?Original backup PFX private-key file path required}"
: "${WATHIQA_DP_CERT_PASSWORD_FILE:?Protected PFX password file required on staging}"
: "${WATHIQA_RESTORE_TMP_ROOT:?Safe isolated scratch directory required}"
[[ "$PGDATABASE" == "postgres" ]] ||
  die "Connect only to maintenance DB postgres; never run a QA restore over the app database"
[[ "$RESTIC_SNAPSHOT_ID" =~ ^[0-9a-f]{8,64}$ ]] ||
  die "Snapshot ID must be a concrete 8-64 character hex ID"
for path in "$WATHIQA_DOCUMENTS_ROOT" "$WATHIQA_DP_KEYS_ROOT" "$WATHIQA_DP_CERT_PATH" "$WATHIQA_RESTORE_TMP_ROOT"; do
  [[ "$path" == /* ]] || die "Expected absolute path: $path"
done
[[ -d "$WATHIQA_RESTORE_TMP_ROOT" ]] || die "Restore scratch root missing"
[[ -r "$RESTIC_PASSWORD_FILE" && -r "$PGPASSFILE" ]] ||
  die "Missing staging credentials"
[[ -s "$WATHIQA_DP_CERT_PASSWORD_FILE" && -r "$WATHIQA_DP_CERT_PASSWORD_FILE" ]] ||
  die "Missing staging PFX decryption password file"
case "$RESTIC_REPOSITORY" in
  s3:*|sftp:*|b2:*|azure:*|gs:*|rest:*) ;;
  *) die "Off-host restic repository required" ;;
esac

work="$(mktemp -d -p "$WATHIQA_RESTORE_TMP_ROOT" 'wathiqa-restore.XXXXXXXX')" ||
  die "Cannot create private restore scratch"
qaDb="wathiqa_restore_qa_$(od -An -N5 -tx1 /dev/urandom | tr -d ' \n')"
created=false
cleanup(){
  if [[ "$created" == true && "$qaDb" =~ ^wathiqa_restore_qa_[0-9a-f]{10}$ ]]; then
    dropdb --if-exists "$qaDb" >/dev/null 2>&1 ||
      echo "WARNING: QA DB cleanup failed for $qaDb; delete manually after inspection" >&2
  fi
  rm -rf -- "$work"
}
trap cleanup EXIT
# Explicit snapshot selection makes the reviewed backup reproducible.
restic restore "$RESTIC_SNAPSHOT_ID" --target "$work" ||
  die "Could not restore encrypted snapshot to isolated scratch"
mapfile -d '' dumps < <(find "$work" -type f -name 'wathiqa-import.dump' -print0)
[[ "${#dumps[@]}" -eq 1 ]] || die "Snapshot must contain exactly one import.dump"
dump="${dumps[0]}"
(
  cd "$(dirname "$dump")"
  sha256sum --check db.sha256
) || die "PostgreSQL archive hash verification failed"
manifest="$(dirname "$dump")/manifest.txt"
[[ -f "$manifest" ]] || die "Backup manifest missing"
grep -Fx "product=Wathiqa.Import" "$manifest" >/dev/null || die "Wrong product in backup"
grep -Fx "document_root=$WATHIQA_DOCUMENTS_ROOT" "$manifest" >/dev/null ||
  die "Documents root changed since backup; review restore paths"
grep -Fx "data_protection_keys_root=$WATHIQA_DP_KEYS_ROOT" "$manifest" >/dev/null ||
  die "Key root changed since backup; review restore paths"
grep -Fx "data_protection_certificate_path=$WATHIQA_DP_CERT_PATH" "$manifest" >/dev/null ||
  die "PFX private-key path changed since backup; review restore paths"

restoredDocs="$work/${WATHIQA_DOCUMENTS_ROOT#/}"
restoredKeys="$work/${WATHIQA_DP_KEYS_ROOT#/}"
restoredPfx="$work/${WATHIQA_DP_CERT_PATH#/}"
[[ -d "$restoredDocs" && -d "$restoredKeys" ]] ||
  die "Snapshot must include private documents AND Data Protection key ring"
[[ -n "$(find "$restoredKeys" -maxdepth 1 -name 'key-*.xml' -type f -print -quit)" ]] ||
  die "Snapshot is missing ASP.NET cookie key files"
[[ -f "$restoredPfx" ]] ||
  die "Snapshot has encrypted key files but NOT their PFX decryption certificate"
# The PFX password is recovered through a SEPARATE approved secrets process;
# do not archive the password in the same restic snapshot.
openssl pkcs12 -in "$restoredPfx" \
  -passin "file:$WATHIQA_DP_CERT_PASSWORD_FILE" -nocerts -nodes -out /dev/null \
  >/dev/null 2>&1 || die "Cannot decrypt restored DP PFX private key with staging recovery secret"
echo "RESTORED_DP_PFX_PRIVATE_KEY_DECRYPTABLE=YES"
# A concrete, randomly generated database is created on the staging server.
# Never set --create or --clean on pg_restore.
createdb -T template0 "$qaDb" || die "Cannot create an isolated staging restore DB"
created=true
pg_restore --no-owner --no-acl --exit-on-error --dbname="$qaDb" "$dump" ||
  die "Database schema/data restore failed"
counts="$(psql -X -v ON_ERROR_STOP=1 -At -d "$qaDb" -c \
  'SELECT (SELECT count(*) FROM "Tenants"),(SELECT count(*) FROM "AspNetUsers"),(SELECT count(*) FROM "__EFMigrationsHistory");')" ||
  die "Unable to verify restored schema"
echo "RESTORED_COUNTS_TENANTS_USERS_MIGRATIONS=$counts"

# Every retained DB document must have its exact blob present, unmodified.
blobRows="$work/restored-blob-rows.txt"
psql -X -v ON_ERROR_STOP=1 -At -d "$qaDb" \
  -c "SELECT \"StorageKey\" || '|' || \"Sha256\" FROM \"StoredDocuments\";" > "$blobRows" ||
  die "Cannot enumerate restored document references"
checked=0
while IFS='|' read -r key checksum; do
  [[ -z "$key" ]] && continue
  [[ "$key" =~ ^[0-9a-f]{32}/[0-9a-f]{32}$ ]] ||
    die "Unexpected DB blob storage key during restore"
  blob="$restoredDocs/$key"
  [[ -f "$blob" ]] || die "Missing restored private document for a DB row"
  actual="$(sha256sum "$blob" | cut -d ' ' -f1)"
  [[ "$actual" == "$checksum" ]] || die "Corrupted restored document blob"
  checked=$((checked+1))
done < "$blobRows"
echo "RESTORED_BLOBS_HASH_VERIFIED=$checked"
echo "RESTORED_KEY_FILES_PRESENT=YES"
echo "STAGING_RESTORE_REHEARSAL=PASS"
# Data remains only in the scratch folder and randomly created staging DB
# until cleanup; never copy restored keys or blobs into the live app volume.
