$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$local = Join-Path $root ".local"
$data = Join-Path $local "pgdata"
$pgBin = "C:\Program Files\PostgreSQL\18\bin"
$initdb = Join-Path $pgBin "initdb.exe"
$pgctl = Join-Path $pgBin "pg_ctl.exe"
$psql = Join-Path $pgBin "psql.exe"
$createdb = Join-Path $pgBin "createdb.exe"
$passfile = Join-Path $local "pg-password.txt"
$pgpass = Join-Path $local "pgpass.conf"
$roleFile = Join-Path $local "db-role.txt"
$dbFile = Join-Path $local "db-name.txt"

New-Item -ItemType Directory -Force $local | Out-Null
$newCluster = -not (Test-Path (Join-Path $data "PG_VERSION"))
if ($newCluster) {
    $dbUser = "wathiqa_dev"
    $bytes = New-Object byte[] 36
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    $randomPassword = [Convert]::ToBase64String($bytes)
    [System.IO.File]::WriteAllText($passfile, $randomPassword + [Environment]::NewLine, [System.Text.Encoding]::ASCII)
    & $initdb -D $data -U $dbUser --encoding=UTF8 --auth=scram-sha-256 "--pwfile=$passfile"
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL initdb failed" }
    Set-Content -Path $roleFile -Value $dbUser -Encoding ASCII
}
elseif (Test-Path $roleFile) {
    $dbUser = (Get-Content -Raw $roleFile).Trim()
}
else {
    # Existing installations are kept compatible; never overwrite or discard their data.
    $dbUser = "hussam_dev"
}
if (-not (Test-Path $passfile)) { throw "Local PostgreSQL password file is missing." }
$password = (Get-Content -Raw $passfile).Trim()
[System.IO.File]::WriteAllText($pgpass, "127.0.0.1:55432:*:$($dbUser):$password" + [Environment]::NewLine, [System.Text.Encoding]::ASCII)
$env:PGPASSFILE = $pgpass

& $pgctl -D $data status *> $null
if ($LASTEXITCODE -ne 0) {
    & $pgctl -D $data -l (Join-Path $local "pg-server.log") -o "-h 127.0.0.1 -p 55432" start
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL startup failed" }
}

$existing = @(& $psql -h 127.0.0.1 -p 55432 -U $dbUser -d postgres -t -A -c "SELECT datname FROM pg_database WHERE datname IN ('wathiqa_docs','hussam_templates')")
if ($LASTEXITCODE -ne 0) { throw "Database authentication failed" }
$names = @($existing | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($dbUser -eq "hussam_dev" -and $names -contains "hussam_templates") {
    $dbName = "hussam_templates"
}
elseif ($names -contains "wathiqa_docs") {
    $dbName = "wathiqa_docs"
}
elseif ($names -contains "hussam_templates") {
    $dbName = "hussam_templates"
}
else {
    $dbName = "wathiqa_docs"
    & $createdb -h 127.0.0.1 -p 55432 -U $dbUser -E UTF8 $dbName
    if ($LASTEXITCODE -ne 0) { throw "Create database failed" }
}
Set-Content -Path $roleFile -Value $dbUser -Encoding ASCII
Set-Content -Path $dbFile -Value $dbName -Encoding ASCII
Write-Output "Wathiqa PostgreSQL ready on 127.0.0.1:55432 (database: $dbName)"
