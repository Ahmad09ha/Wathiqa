#!/usr/bin/env bash
# Non-destructive public checks AFTER staging HTTPS deployment.
set -Eeuo pipefail
: "${WATHIQA_PUBLIC_BASE_URL:?Set the real HTTPS Import frontend URL}"
base="${WATHIQA_PUBLIC_BASE_URL%/}"
[[ "$base" == https://* ]] || { echo 'HTTPS required' >&2; exit 1; }
for tool in curl grep; do command -v "$tool" >/dev/null || exit 1; done
status(){ curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "$base$1"; }
[[ "$(status /import/login)" == '200' ]] || { echo 'Import login failed' >&2; exit 1; }
[[ "$(status /platform/login)" == '200' ]] || { echo 'Platform SuperAdmin login failed' >&2; exit 1; }
[[ "$(status /platform/plans)" == '200' ]] || { echo 'Platform manual plans route failed' >&2; exit 1; }
[[ "$(status /platform/subscriptions)" == '200' ]] || { echo 'Platform subscriptions route failed' >&2; exit 1; }
[[ "$(status /editor/template/test)" == '404' ]] || { echo 'Legacy editor leak' >&2; exit 1; }
[[ "$(status /api/templates)" == '404' ]] || { echo 'Legacy API leak' >&2; exit 1; }
[[ "$(status /import-api/api/orders)" == '401' ]] || { echo 'Unauthenticated finance leak' >&2; exit 1; }
[[ "$(status /import-api/api/platform/overview)" == '401' ]] || { echo 'Unauthenticated platform access' >&2; exit 1; }
[[ "$(status /import-api/api/health)" == '200' ]] || { echo 'API health failed' >&2; exit 1; }
headers="$(curl -sS -i --max-time 15 "$base/import-api/api/auth/csrf")"
printf '%s\n' "$headers" | grep -qi 'set-cookie:.*secure' || {
  echo 'CSRF secure cookie missing' >&2; exit 1; }
echo 'WATHIQA_NON_DESTRUCTIVE_PUBLIC_SMOKE=PASS'
