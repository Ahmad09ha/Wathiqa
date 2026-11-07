$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$local = Join-Path $root '.local'
$pidFile = Join-Path $local 'import-api.pid'
$ports = @(Get-NetTCPConnection -LocalPort 5089 -State Listen -ErrorAction SilentlyContinue)
foreach ($port in $ports) {
    $id = [int]$port.OwningProcess
    $info = Get-CimInstance Win32_Process -Filter "ProcessId = $id"
    if (-not $info -or $info.CommandLine -notlike '*Wathiqa.ImportApi.dll*') {
        throw 'Refusing to stop unrelated process on port 5089'
    }
    Stop-Process -Id $id -Force -ErrorAction Stop
    Write-Output "STOPPED_IMPORT_API=$id"
}
if (Test-Path $pidFile) { Remove-Item $pidFile -Force }
