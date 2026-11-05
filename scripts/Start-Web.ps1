$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$local = Join-Path $root '.local'
$frontend = Join-Path $root 'frontend'
New-Item -ItemType Directory -Force $local | Out-Null
$existing = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if (-not $existing) {
    $env:NEXT_TELEMETRY_DISABLED = '1'
    $p = Start-Process -FilePath 'node.exe' -WorkingDirectory $frontend -ArgumentList 'node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000' -RedirectStandardOutput (Join-Path $local 'web.log') -RedirectStandardError (Join-Path $local 'web-error.log') -PassThru
    Set-Content (Join-Path $local 'web.pid') -Value $p.Id
    Write-Output ('Started frontend PID ' + $p.Id)
}
else {
    $ownerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($existing[0].OwningProcess)"
    if (-not $ownerProcess -or $ownerProcess.CommandLine -notlike '*next start*') {
        throw 'Port 3000 is occupied by an unrelated application. Wathiqa Web was not started.'
    }
    Write-Output 'Wathiqa Web already listening on 3000'
}
