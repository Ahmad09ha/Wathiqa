# Local-only isolated PostgreSQL cluster for validating API startup migration.
# No production access, no existing database mutation, no credentials stored in git.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$local = Join-Path $root '.local'
$pgDir = 'C:\Program Files\PostgreSQL\18\bin'
$initdb = Join-Path $pgDir 'initdb.exe'
$pgctl = Join-Path $pgDir 'pg_ctl.exe'
$createdb = Join-Path $pgDir 'createdb.exe'
$psql = Join-Path $pgDir 'psql.exe'
$port = 55441
$apiPort = 5097
$database = 'wathiqa_import_dev'
$role = 'wathiqa_startup_qa'
$tag = [guid]::NewGuid().ToString('N')
$work = Join-Path $local ('auto-migration-qa-' + $tag)
$data = Join-Path $work 'postgres'
$api = Join-Path $root 'backend/Wathiqa.ImportApi'
$dll = Join-Path $api 'bin/Debug/net10.0/Wathiqa.ImportApi.dll'
$runningPg = $false
$runningApi = $null
$saved = @{}
$pass = 0
function Pass([string]$name) { $script:pass++; Write-Output ('PASS ' + $name) }
function Psql([string]$sql) {
    # PowerShell-to-native executable quoting may strip the PostgreSQL
    # double-quoted identifiers. Use a temporary UTF-8 .sql file instead.
    $queryFile = Join-Path $work 'query.sql'
    [IO.File]::WriteAllText($queryFile,$sql,[Text.UTF8Encoding]::new($false))
    $result = & $psql -X -h 127.0.0.1 -p $port -U $role -d $database -A -t -v ON_ERROR_STOP=1 -f $queryFile
    if ($LASTEXITCODE -ne 0) { throw 'QA SQL assertion failed' }
    return ($result | Out-String).Trim()
}
function StopQaApi {
    if ($script:runningApi) {
        $proc = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $script:runningApi.Id) -ErrorAction SilentlyContinue
        if ($proc -and $proc.CommandLine -like '*Wathiqa.ImportApi.dll*') {
            Stop-Process -Id $script:runningApi.Id -Force -ErrorAction SilentlyContinue
        }
        $script:runningApi = $null
    }
}
function StartQaApi([string]$label) {
    $script:runningApi = Start-Process dotnet -ArgumentList $dll -WorkingDirectory $api -PassThru -RedirectStandardOutput (Join-Path $work ($label + '.out')) -RedirectStandardError (Join-Path $work ($label + '.err'))
    for ($i=0; $i -lt 100; $i++) {
        Start-Sleep -Milliseconds 400
        try {
            $health = Invoke-RestMethod ('http://127.0.0.1:' + $apiPort + '/api/health') -TimeoutSec 2
            if ($health.status -eq 'ok') { return }
        } catch {}
        if (-not (Get-Process -Id $script:runningApi.Id -ErrorAction SilentlyContinue)) {
            $logs = (Get-Content (Join-Path $work ($label + '.err')) -Tail 15 -ErrorAction SilentlyContinue) -join [Environment]::NewLine
            throw ('Startup failed ' + $label + ': ' + $logs)
        }
    }
    throw ('QA startup health timeout: ' + $label)
}
try {
    if (-not(Test-Path $dll)) { throw 'Build the Import API before running this QA' }
    foreach ($tool in @($initdb, $pgctl, $createdb, $psql)) {
        if (-not(Test-Path $tool)){throw ('PostgreSQL 18 tool missing: '+$tool)}
    }
    foreach ($listenPort in @($port, $apiPort)) {
        if (Get-NetTCPConnection -LocalPort $listenPort -State Listen -ErrorAction SilentlyContinue) {
            throw ('QA port already occupied: '+$listenPort)
        }
    }
    New-Item -ItemType Directory -Path $work -Force | Out-Null
    & $initdb -D $data -U $role --encoding=UTF8 --auth-host=trust --auth-local=trust --no-instructions *> (Join-Path $work 'initdb.log')
    if ($LASTEXITCODE -ne 0) { throw 'Isolated PostgreSQL initdb failed' }
    & $pgctl -D $data -l (Join-Path $work 'postgres.log') -o "-h 127.0.0.1 -p $port" start
    if ($LASTEXITCODE -ne 0) { throw 'Isolated PostgreSQL failed to start' }
    $runningPg = $true
    & $createdb -h 127.0.0.1 -p $port -U $role -E UTF8 $database
    if ($LASTEXITCODE -ne 0) { throw 'QA database initialization failed' }

    foreach($key in @('ConnectionStrings__ImportDatabase','ASPNETCORE_ENVIRONMENT',
        'ASPNETCORE_URLS','WATHIQA_IMPORT_AUTO_MIGRATE','DataProtection__KeysPath')) {
        $saved[$key] = [Environment]::GetEnvironmentVariable($key)
    }
    $env:ConnectionStrings__ImportDatabase="Host=127.0.0.1;Port=$port;Database=$database;Username=$role;Pooling=false"
    $env:ASPNETCORE_ENVIRONMENT='Development'
    $env:ASPNETCORE_URLS="http://127.0.0.1:$apiPort"
    $env:WATHIQA_IMPORT_AUTO_MIGRATE='true'
    $env:DataProtection__KeysPath=Join-Path $work 'keys'
    New-Item -ItemType Directory -Path $env:DataProtection__KeysPath -Force | Out-Null

    StartQaApi 'first-start'
    $count = [int](Psql 'SELECT COUNT(*) FROM "__EFMigrationsHistory";')
    if ($count -lt 3) { throw "Expected multiple EF migrations, found $count" }
    if ((Psql "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='TenantPorts';") -ne '1') {
        throw 'Newest TenantPorts migration missing'
    }
    if ((Psql 'SELECT COUNT(*) FROM "Tenants";') -ne '0') {
        throw 'Startup migration must not seed tenant accounts'
    }
    if ((Psql 'SELECT COUNT(*) FROM "AspNetUsers";') -ne '0') {
        throw 'Startup migration must not create user accounts'
    }
    Pass "Fresh isolated Import database automatically receives $count EF migrations, without seeding users"

    StopQaApi
    Start-Sleep -Milliseconds 400
    StartQaApi 'second-start'
    $after = [int](Psql 'SELECT COUNT(*) FROM "__EFMigrationsHistory";')
    if ($after -ne $count) { throw 'Second start changed migration history' }
    $log = Get-Content (Join-Path $work 'second-start.out') -Raw
    if ($log -notmatch 'Pending at startup: 0') {
        throw 'Second startup must report zero pending migrations'
    }
    Pass 'Repeated startup is idempotent (zero pending migrations)'
    StopQaApi

    Write-Output ('AUTO_MIGRATE_STARTUP_PASS_COUNT='+$pass)
}
finally {
    StopQaApi
    if ($runningPg) {
        & $pgctl -D $data -m immediate stop *> $null
    }
    foreach ($key in $saved.Keys) {
        [Environment]::SetEnvironmentVariable($key, $saved[$key])
    }
    if ($work.StartsWith([IO.Path]::GetFullPath($local)+[IO.Path]::DirectorySeparatorChar,
        [StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path $work -Leaf) -eq ('auto-migration-qa-' + $tag)) {
        try { Remove-Item -Recurse -Force $work -ErrorAction Stop }
        catch { Write-Warning 'Isolated QA files could not be removed (no existing DB was touched)' }
    }
}
