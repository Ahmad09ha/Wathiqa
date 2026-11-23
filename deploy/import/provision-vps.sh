#!/usr/bin/env bash
# First-time Hostinger/Dokploy host provisioning. This script never deploys
# containers, overwrites credentials, resets PostgreSQL, or changes a tenant.
set -Eeuo pipefail
umask 077

die() { printf 'WATHIQA_PROVISION_ERROR: %s\n' "$*" >&2; exit 1; }
[[ "$EUID" -eq 0 ]] || die 'Run on the VPS as root (sudo).'
for command_name in openssl mktemp chown chmod find; do
  command -v "$command_name" >/dev/null || die "Missing command: $command_name"
done

private_root="${WATHIQA_PRIVATE_ROOT:-/opt/wathiqa/import-private}"
secrets_root="${WATHIQA_SECRETS_ROOT:-/opt/wathiqa/import-secrets}"
[[ "$private_root" == /* && "$secrets_root" == /* ]] ||
  die 'Private and secrets roots must be absolute Linux paths.'
[[ "$private_root" != "$secrets_root" ]] ||
  die 'Private data and secrets must have different directories.'
[[ ! -L "$private_root" && ! -L "$secrets_root" ]] ||
  die 'Refusing symlinked data or secrets root.'

mkdir -p "$private_root/documents" "$private_root/keys" \
  "$private_root/backup_tmp" "$secrets_root"
for path in "$private_root/documents" "$private_root/keys" "$private_root/backup_tmp" "$secrets_root"; do
  [[ ! -L "$path" ]] || die "Refusing a symlinked data path: $path"
done
chown root:root "$private_root" "$private_root/backup_tmp" "$secrets_root"
chmod 0711 "$private_root"
chmod 0700 "$private_root/backup_tmp" "$secrets_root"
# Existing application files keep their IDs; on an initial setup this gives
# the non-root API process exclusive access to its persistent key/blob paths.
chown -R 1654:1654 "$private_root/documents" "$private_root/keys"
chmod 0700 "$private_root/documents" "$private_root/keys"

secret_file() { printf '%s/%s' "$secrets_root" "$1"; }
make_secret() {
  local name="$1" value="$2" file
  file="$(secret_file "$name")"
  [[ ! -L "$file" ]] || die "Refusing symlinked secret: $name"
  if [[ -e "$file" ]]; then
    [[ -f "$file" && -s "$file" ]] || die "Existing secret is empty or not a file: $name"
    return
  fi
  printf '%s\n' "$value" > "$file"
}
make_email() {
  local name="$1" label="$2" file address
  file="$(secret_file "$name")"
  if [[ -e "$file" ]]; then
    [[ -f "$file" && -s "$file" && ! -L "$file" ]] || die "Invalid existing email secret: $name"
    return
  fi
  [[ -t 0 ]] || die "Interactive terminal required to enter $label. No default accounts are created."
  read -r -p "$label email: " address
  [[ "$address" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] ||
    die "Invalid email supplied for $label"
  make_secret "$name" "$address"
}

dp_cert="$(secret_file import_dp_certificate.pfx)"
dp_pass="$(secret_file import_dp_password)"
if [[ -e "$dp_cert" && ! -s "$dp_pass" ]]; then
  die 'Existing Data Protection certificate has no password file. Recover the original password.'
fi
if [[ ! -e "$dp_cert" && -n "$(find "$private_root/keys" -maxdepth 1 -type f -name 'key-*.xml' -print -quit)" ]]; then
  die 'Existing encrypted Data Protection keys require the ORIGINAL missing PFX. Restore it; do not generate a replacement.'
fi

make_secret import_db_password "$(openssl rand -hex 32)"
make_secret import_dp_password "$(openssl rand -hex 32)"
make_secret import_restic_password "$(openssl rand -hex 32)"

make_email import_trial_email 'Trial tenant Admin'
make_email import_unlimited_email 'Unlimited tenant Admin'
make_email import_superadmin_email 'Platform SuperAdmin'

trial_email="$(cat "$(secret_file import_trial_email)")"
unlimited_email="$(cat "$(secret_file import_unlimited_email)")"
superadmin_email="$(cat "$(secret_file import_superadmin_email)")"
[[ "$trial_email" != "$unlimited_email" && "$trial_email" != "$superadmin_email" && "$unlimited_email" != "$superadmin_email" ]] ||
  die 'Use three distinct production email addresses.'
unset trial_email unlimited_email superadmin_email

# The fixed prefix satisfies ASP.NET Identity upper/lower/digit/symbol rules;
# the random suffix adds independent entropy and is never logged.
make_secret import_trial_password "Aa1!$(openssl rand -hex 28)"
make_secret import_unlimited_password "Aa1!$(openssl rand -hex 28)"
make_secret import_superadmin_password "Aa1!$(openssl rand -hex 28)"

[[ ! -L "$dp_cert" ]] || die 'Refusing symlinked Data Protection certificate.'
if [[ ! -e "$dp_cert" ]]; then
  temp_dir="$(mktemp -d "$secrets_root/.dp.XXXXXXXX")"
  trap 'rm -rf -- "$temp_dir"' EXIT
  openssl req -x509 -newkey rsa:3072 -sha256 -days 3650 -nodes \
    -subj '/CN=Wathiqa Import Data Protection' \
    -keyout "$temp_dir/private-key.pem" -out "$temp_dir/cert.pem" >/dev/null 2>&1
  openssl pkcs12 -export -inkey "$temp_dir/private-key.pem" \
    -in "$temp_dir/cert.pem" -out "$dp_cert" -passout "file:$dp_pass"
  rm -rf -- "$temp_dir"
  trap - EXIT
fi
openssl pkcs12 -in "$dp_cert" -passin "file:$dp_pass" -nocerts -nodes -out /dev/null >/dev/null 2>&1 ||
  die 'Data Protection PFX cannot be decrypted with the saved password.'

# Docker Compose file-backed secrets preserve their host file permissions.
# The API runs as uid:gid 1654:1654 and needs read access, while the backup
# container runs as root. Use root:1654 0640 only for API-consumed secrets,
# retaining root:root 0600 for backup-only credentials. The parent secrets
# directory remains 0700 root:root on the host.
for name in import_db_password import_dp_certificate.pfx import_dp_password \
  import_trial_email import_trial_password import_unlimited_email \
  import_unlimited_password import_superadmin_email import_superadmin_password; do
  file="$(secret_file "$name")"
  [[ -f "$file" && ! -L "$file" ]] || die "Invalid API secret file: $name"
  chown root:1654 "$file"
  chmod 0640 "$file"
done
for name in import_restic_password import_s3_access_key import_s3_secret_key; do
  file="$(secret_file "$name")"
  [[ -e "$file" ]] || continue
  [[ -f "$file" && ! -L "$file" ]] || die "Invalid backup secret file: $name"
  chown root:root "$file"
  chmod 0600 "$file"
done

printf '\nWATHIQA_VPS_SECRETS_AND_STORAGE=READY\n'
printf 'Credentials and PFX are stored only in %s (never in Git).\n' "$secrets_root"
printf 'No accounts have been inserted into PostgreSQL yet.\n'
printf 'For encrypted off-host backups, additionally supply REAL provider credentials in:\n'
printf '  %s/import_s3_access_key\n' "$secrets_root"
printf '  %s/import_s3_secret_key\n' "$secrets_root"
printf 'Run the guarded one-shot account seeds and release checks from DOKPLOY-GITHUB-AR.md.\n'