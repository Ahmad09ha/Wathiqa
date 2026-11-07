# Local-only demo bootstrap, no customer data and no public signup.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$local = Join-Path $root '.local'
& (Join-Path $PSScriptRoot 'Initialize-ImportDatabase.ps1') | Out-Null
$env:ConnectionStrings__ImportDatabase = 'Host=127.0.0.1;Port=55432;Database=wathiqa_import_dev;Username=wathiqa_import_dev;Password=' + ([IO.File]::ReadAllText((Join-Path $local 'import-db-password.txt'))).Trim()
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$secretsFile = Join-Path $local 'import-demo-accounts.json'
function NewRandomPassword {
    $bytes = New-Object byte[] 42
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return ([Convert]::ToBase64String($bytes) + 'Aa9!')
}
if (Test-Path $secretsFile) {
    $parsed = Get-Content $secretsFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $accounts = @($parsed)
    if ($accounts.Count -eq 1 -and $accounts[0] -is [array]) { $accounts = $accounts[0] }
} else {
    $accounts = @(
        [pscustomobject]@{ slug='demo-a'; name='Demo Merchant A'; email='owner-a@wathiqa.invalid'; password=(NewRandomPassword) },
        [pscustomobject]@{ slug='demo-b'; name='Demo Merchant B'; email='owner-b@wathiqa.invalid'; password=(NewRandomPassword) }
    )
    [IO.File]::WriteAllText($secretsFile, ($accounts | ConvertTo-Json -Depth 6), [Text.Encoding]::UTF8)
}
$env:PGPASSFILE = Join-Path $local 'import-pgpass.conf'
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
$dll = Join-Path $root 'backend/Wathiqa.ImportApi/bin/Debug/net10.0/Wathiqa.ImportApi.dll'
if (-not (Test-Path $dll)) { throw 'Build import API before bootstrapping.' }
foreach ($account in $accounts) {
    if ($account.slug -notin @('demo-a','demo-b')) { throw 'Unrecognized demo tenant' }
    $q = 'SELECT COUNT(*) FROM public.' + [char]34 + 'Tenants' + [char]34 + ' WHERE ' + [char]34 + 'Slug' + [char]34 + " = '$($account.slug)'"
    $sqlFile = Join-Path $local 'demo-tenant-exists.sql'
    [IO.File]::WriteAllText($sqlFile, $q, [Text.Encoding]::ASCII)
    $existing = & $psql -h 127.0.0.1 -p 55432 -U wathiqa_import_dev -d wathiqa_import_dev -t -A -v ON_ERROR_STOP=1 -f $sqlFile
    if ($LASTEXITCODE -ne 0) { throw 'Unable to query tenant table. Check migrations.' }
    if (($existing | Out-String).Trim() -eq '1') {
        Write-Output "EXISTING_DEMO_TENANT=$($account.slug)"
        continue
    }
    $env:WATHIQA_TENANT_SLUG = $account.slug
    $env:WATHIQA_TENANT_NAME = $account.name
    $env:WATHIQA_ADMIN_EMAIL = $account.email
    $env:WATHIQA_ADMIN_PASSWORD = $account.password
    & dotnet $dll --bootstrap
    if ($LASTEXITCODE -ne 0) { throw "Bootstrap failed for $($account.slug)" }
    Write-Output "BOOTSTRAPPED_DEMO_TENANT=$($account.slug)"
}
Remove-Item Env:\WATHIQA_ADMIN_PASSWORD -ErrorAction SilentlyContinue
Write-Output ('LOCAL_DEMO_CREDENTIALS_FILE=' + $secretsFile)
