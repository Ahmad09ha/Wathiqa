# Local-only seed of TWO isolated tenant Admin accounts:
# trial-access expires exactly 3 calendar months after initial creation;
# unlimited-access has no automatic expiry. Passwords stay in gitignored .local.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$local = Join-Path $root '.local'
& (Join-Path $PSScriptRoot 'Initialize-ImportDatabase.ps1') | Out-Null
$secretFile = Join-Path $local 'import-access-accounts.json'
function NewStrongPassword {
    $random = New-Object byte[] 42
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {$rng.GetBytes($random)} finally {$rng.Dispose()}
    return ([Convert]::ToBase64String($random) + 'Aa9!')
}
if (-not (Test-Path $secretFile)) {
    $seeds = @(
        [pscustomobject]@{
            slug = 'trial-access'
            email = 'trial-admin@wathiqa.invalid'
            password = (NewStrongPassword)
            type = 'trial'
        },
        [pscustomobject]@{
            slug = 'unlimited-access'
            email = 'unlimited-admin@wathiqa.invalid'
            password = (NewStrongPassword)
            type = 'unlimited'
        }
    )
    # Generate once. Reusing the same credentials is necessary to safely
    # re-run the provisioning without accidentally rotating passwords.
    [IO.File]::WriteAllText($secretFile, ($seeds | ConvertTo-Json -Depth 5), [Text.Encoding]::UTF8)
}
$seeds = @(Get-Content $secretFile -Raw -Encoding UTF8 | ConvertFrom-Json)
if ($seeds.Count -eq 1 -and $seeds[0] -is [array]) {$seeds = $seeds[0]}
if ($seeds.Count -ne 2 -or
    $seeds[0].slug -ne 'trial-access' -or
    $seeds[1].slug -ne 'unlimited-access') {
    throw 'Seed secrets file is malformed; refusing to proceed.'
}

$dll = Join-Path $root 'backend/Wathiqa.ImportApi/bin/Debug/net10.0/Wathiqa.ImportApi.dll'
if (-not (Test-Path $dll)) {throw 'Build Wathiqa.ImportApi before seeding.'}
$dbPassword = [IO.File]::ReadAllText((Join-Path $local 'import-db-password.txt')).Trim()
$env:ConnectionStrings__ImportDatabase = "Host=127.0.0.1;Port=55432;Database=wathiqa_import_dev;Username=wathiqa_import_dev;Password=$dbPassword"
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:WATHIQA_TRIAL_EMAIL = [string]$seeds[0].email
$env:WATHIQA_TRIAL_PASSWORD = [string]$seeds[0].password
$env:WATHIQA_UNLIMITED_EMAIL = [string]$seeds[1].email
$env:WATHIQA_UNLIMITED_PASSWORD = [string]$seeds[1].password
try {
    & dotnet $dll --seed-access-accounts
    if ($LASTEXITCODE -ne 0) {throw 'Import Access Account seeding failed.'}
    Write-Output 'TRIAL_ACCOUNT_EMAIL=trial-admin@wathiqa.invalid'
    Write-Output 'UNLIMITED_ACCOUNT_EMAIL=unlimited-admin@wathiqa.invalid'
    Write-Output ('ACCESS_SEED_LOCAL_CREDENTIALS=' + $secretFile)
} finally {
    Remove-Item Env:\WATHIQA_TRIAL_EMAIL -ErrorAction SilentlyContinue
    Remove-Item Env:\WATHIQA_TRIAL_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:\WATHIQA_UNLIMITED_EMAIL -ErrorAction SilentlyContinue
    Remove-Item Env:\WATHIQA_UNLIMITED_PASSWORD -ErrorAction SilentlyContinue
}
