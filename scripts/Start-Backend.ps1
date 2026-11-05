$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
& (Join-Path $PSScriptRoot 'Initialize-LocalPostgres.ps1')
$local = Join-Path $root '.local'
$pwFile = Join-Path $local 'pg-password.txt'
if (-not (Test-Path $pwFile)) { throw 'Local database password file is missing' }
$pw = (Get-Content -Raw $pwFile).Trim()
$dbFile = Join-Path $local 'db-name.txt'
$roleFile = Join-Path $local 'db-role.txt'
if (-not (Test-Path $dbFile) -or -not (Test-Path $roleFile)) {
    throw 'Wathiqa PostgreSQL configuration missing. Re-run Initialize-LocalPostgres.ps1.'
}
$dbName = (Get-Content -Raw $dbFile).Trim()
$dbUser = (Get-Content -Raw $roleFile).Trim()
$env:ConnectionStrings__Database = "Host=127.0.0.1;Port=55432;Database=$dbName;Username=$dbUser;Password=$pw"
$env:ASPNETCORE_URLS = 'http://127.0.0.1:5088'
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$backend = Join-Path $root 'backend\Wathiqa.Api'
$existing = @(Get-NetTCPConnection -LocalPort 5088 -State Listen -ErrorAction SilentlyContinue)
if (-not $existing) {
    $p = Start-Process -FilePath 'dotnet.exe' -ArgumentList 'bin/Debug/net9.0/Wathiqa.Api.dll' -WorkingDirectory $backend -RedirectStandardOutput (Join-Path $local 'api.log') -RedirectStandardError (Join-Path $local 'api-error.log') -PassThru
    Set-Content -Path (Join-Path $local 'api.pid') -Value $p.Id
    Write-Output ("Started backend PID " + $p.Id)
}
else {
    $ownerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($existing[0].OwningProcess)"
    if (-not $ownerProcess -or $ownerProcess.CommandLine -notlike '*Wathiqa.Api.dll*') {
        throw 'Port 5088 is occupied by an unrelated application. Wathiqa API was not started.'
    }
    Write-Output 'Wathiqa API already listening on 5088'
}
