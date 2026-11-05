param([switch]$StopDatabase)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$local = Join-Path $root '.local'
foreach ($service in @('api','web')) {
    $pidFile = Join-Path $local ($service + '.pid')
    if (-not (Test-Path $pidFile)) { continue }
    $processId = [int](Get-Content $pidFile -Raw)
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
    if ($process -and (($service -eq 'api' -and $process.CommandLine -like '*Wathiqa.Api.dll*') -or ($service -eq 'web' -and $process.CommandLine -like '*next start*'))) {
        Stop-Process -Id $processId -Force
        Write-Host "Stopped $service ($processId)"
    }
}
if ($StopDatabase) {
    $data = Join-Path $local 'pgdata'
    if (Test-Path (Join-Path $data 'PG_VERSION')) {
        & 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' -D $data -m fast stop
    }
}
