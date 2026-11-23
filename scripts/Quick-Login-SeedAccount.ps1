# Local developer convenience only. Never exposes the seed password in logs,
# URLs, Git, or frontend source. Copies the selected secret to Windows clipboard.
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('Trial','Unlimited')]
  [string]$Account
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$local = Join-Path $root '.local'
$secretsPath = Join-Path $local 'import-access-accounts.json'
if (-not (Test-Path -LiteralPath $secretsPath)) {
  throw 'Local seed account file missing. Run scripts/Seed-ImportAccessAccounts.ps1 once.'
}
$accounts = @(Get-Content -LiteralPath $secretsPath -Raw -Encoding UTF8 | ConvertFrom-Json)
if ($accounts.Count -eq 1 -and $accounts[0] -is [array]) {
  $accounts = $accounts[0]
}
$slug = if($Account -eq 'Trial'){'trial-access'}else{'unlimited-access'}
$selected = @($accounts | Where-Object { $_.slug -eq $slug })
if($selected.Count -ne 1 -or [string]::IsNullOrWhiteSpace([string]$selected[0].password)) {
  throw 'Seed account not present in local secret file.'
}
if ([string]$selected[0].slug -ne $slug -or
    $selected[0].password -is [array] -or
    $selected[0].email -is [array]) {
  throw 'Seed secrets are malformed, refusing to copy a password.'
}
$loginUrl = 'http://localhost:3000/import/login'
$health = 'http://127.0.0.1:3000/import-api/api/health'
try {
  $response = Invoke-WebRequest $health -UseBasicParsing -TimeoutSec 4
  if($response.StatusCode -ne 200){throw 'Proxy unhealthy'}
} catch {
  Write-Output 'Starting local Wathiqa services...'
  & (Join-Path $root 'start.ps1')
  if($LASTEXITCODE -ne 0){throw 'Wathiqa local start failed'}
}
Set-Clipboard -Value ([string]$selected[0].password)
Write-Output ('ACCOUNT_EMAIL='+[string]$selected[0].email)
Write-Output 'PASSWORD_COPIED_TO_WINDOWS_CLIPBOARD'
Write-Output 'Open the login page, enter the email above and paste the password with Ctrl+V.'
Write-Output 'Security tip: replace clipboard contents after signing in.'
Start-Process $loginUrl
