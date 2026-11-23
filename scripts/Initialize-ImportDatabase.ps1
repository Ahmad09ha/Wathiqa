# WP-00: create isolated import-management DB with its own restricted user.
# Existing template-editor database is never modified.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$local = Join-Path $root '.local'
$bin = 'C:\Program Files\PostgreSQL\18\bin'
$psql = Join-Path $bin 'psql.exe'
$createdb = Join-Path $bin 'createdb.exe'
$adminUser = (Get-Content (Join-Path $local 'db-role.txt') -Raw).Trim()
$env:PGPASSFILE = Join-Path $local 'pgpass.conf'
$user = 'wathiqa_import_dev'
$database = 'wathiqa_import_dev'
$passFile = Join-Path $local 'import-db-password.txt'
$passEntry = Join-Path $local 'import-pgpass.conf'
$roleScript = Join-Path $local 'import-role-private.sql'
$hostName = '127.0.0.1'
$port = '55432'
if (-not (Test-Path $passFile)) {
    $buffer = New-Object byte[] 36
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    [IO.File]::WriteAllText($passFile, [Convert]::ToBase64String($buffer), [Text.Encoding]::ASCII)
}
$password = ([IO.File]::ReadAllText($passFile)).Trim()
$exists = @(& $psql -h $hostName -p $port -U $adminUser -d postgres -t -A -c "SELECT 1 FROM pg_roles WHERE rolname='$user'")
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect database roles' }
if (-not ($exists -contains '1')) {
    # SQL containing the local password is created only in the gitignored .local directory and removed.
    [IO.File]::WriteAllText($roleScript, "CREATE ROLE $user LOGIN PASSWORD '$password';", [Text.Encoding]::ASCII)
    try {
        & $psql -h $hostName -p $port -U $adminUser -d postgres -v ON_ERROR_STOP=1 -f $roleScript | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Create database user failed' }
    } finally { Remove-Item $roleScript -Force -ErrorAction SilentlyContinue }
}
$existingDb = @(& $psql -h $hostName -p $port -U $adminUser -d postgres -t -A -c "SELECT 1 FROM pg_database WHERE datname='$database'")
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect databases' }
if (-not ($existingDb -contains '1')) {
    & $createdb -h $hostName -p $port -U $adminUser -O $user -E UTF8 $database
    if ($LASTEXITCODE -ne 0) { throw 'Create isolated database failed' }
}
[IO.File]::WriteAllText($passEntry, "$($hostName):$($port):$($database):$($user):$($password)", [Text.Encoding]::ASCII)
$env:PGPASSFILE = $passEntry
$who = @(& $psql -h $hostName -p $port -U $user -d $database -t -A -c "SELECT current_database() || ':' || current_user")
if ($LASTEXITCODE -ne 0 -or ($who -notcontains "$($database):$($user)")) { throw 'Restricted import database login failed' }
# Fail if the isolated DB already contains legacy schema.
$legacy = @(& $psql -h $hostName -p $port -U $user -d $database -t -A -c "SELECT COUNT(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('Templates','Documents')")
if ($LASTEXITCODE -ne 0 -or ($legacy -notcontains '0')) { throw 'New import database contains legacy product tables' }
Write-Output "IMPORT_DATABASE_READY=$database"
Write-Output "IMPORT_DATABASE_ROLE=$user"
