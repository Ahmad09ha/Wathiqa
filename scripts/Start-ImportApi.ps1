$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$local = Join-Path $root '.local'
& (Join-Path $PSScriptRoot 'Initialize-ImportDatabase.ps1') | Out-Null
$database = 'wathiqa_import_dev'
$user = 'wathiqa_import_dev'
$password = ([IO.File]::ReadAllText((Join-Path $local 'import-db-password.txt'))).Trim()
$env:ConnectionStrings__ImportDatabase = "Host=127.0.0.1;Port=55432;Database=$database;Username=$user;Password=$password"
$env:ASPNETCORE_URLS = 'http://127.0.0.1:5089'
$env:ASPNETCORE_ENVIRONMENT = 'Development'
# Use one dedicated gitignored, persistent local key ring for the Import API.
# This is also the source included in local backup/restore rehearsals.
$keyRing = Join-Path $local 'import-dp-keys'
New-Item -ItemType Directory -Force $keyRing | Out-Null
$env:DataProtection__KeysPath = $keyRing
# ShipsGo is configured ONLY on the server side. Developers may store their
# credential in this gitignored local file or supply an environment variable.
# An existing environment variable takes priority (e.g. for mock-provider tests).
$shipsGoKeyFile = Join-Path $local 'shipsgo-api-key.txt'
if ([string]::IsNullOrWhiteSpace($env:OceanTracking__ShipsGoApiKey) -and
    (Test-Path -LiteralPath $shipsGoKeyFile -PathType Leaf)) {
    $shipsGoKey = [IO.File]::ReadAllText($shipsGoKeyFile).Trim()
    if ([string]::IsNullOrWhiteSpace($shipsGoKey)) { throw 'ShipsGo local credential file is empty.' }
    $env:OceanTracking__ShipsGoApiKey = $shipsGoKey
    Remove-Variable shipsGoKey
}
$shipsGoV2File = Join-Path $local 'shipsgo-v2-token.txt'
if ([string]::IsNullOrWhiteSpace($env:OceanTracking__ShipsGoV2Token) -and
    (Test-Path -LiteralPath $shipsGoV2File -PathType Leaf)) {
    $shipsGoV2Token = [IO.File]::ReadAllText($shipsGoV2File).Trim()
    if ([string]::IsNullOrWhiteSpace($shipsGoV2Token)) { throw 'ShipsGo V2 local credential file is empty.' }
    $env:OceanTracking__ShipsGoV2Token = $shipsGoV2Token
    Remove-Variable shipsGoV2Token
}
$shipsGoWebhookFile = Join-Path $local 'shipsgo-webhook-secret.txt'
if ([string]::IsNullOrWhiteSpace($env:OceanTracking__ShipsGoWebhookSecret) -and
    (Test-Path -LiteralPath $shipsGoWebhookFile -PathType Leaf)) {
    $shipsGoWebhookSecret = [IO.File]::ReadAllText($shipsGoWebhookFile).Trim()
    if ([string]::IsNullOrWhiteSpace($shipsGoWebhookSecret)) { throw 'ShipsGo webhook secret is empty.' }
    $env:OceanTracking__ShipsGoWebhookSecret = $shipsGoWebhookSecret
    Remove-Variable shipsGoWebhookSecret
}
$project = Join-Path $root 'backend/Wathiqa.ImportApi'
$dll = Join-Path $project 'bin/Debug/net10.0/Wathiqa.ImportApi.dll'
if (-not (Test-Path $dll)) { throw 'New .NET 10 API is not built. Run dotnet build backend/Wathiqa.ImportApi' }
$existing = @(Get-NetTCPConnection -LocalPort 5089 -State Listen -ErrorAction SilentlyContinue)
if ($existing.Count -gt 0) {
    $ownerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($existing[0].OwningProcess)"
    if (-not $ownerProcess -or $ownerProcess.CommandLine -notlike '*Wathiqa.ImportApi.dll*')
        { throw 'Port 5089 is used by another process.' }
    Write-Output 'Import API already listening on 5089'
} else {
    $process = Start-Process -FilePath 'dotnet.exe' -ArgumentList 'bin/Debug/net10.0/Wathiqa.ImportApi.dll' -WorkingDirectory $project -RedirectStandardOutput (Join-Path $local 'import-api.log') -RedirectStandardError (Join-Path $local 'import-api-error.log') -PassThru
    Set-Content (Join-Path $local 'import-api.pid') -Value $process.Id
    Write-Output "Import API process started (PID $($process.Id))."
}
$healthy = $false
foreach ($i in 1..28) {
    try {
        $response = Invoke-RestMethod 'http://127.0.0.1:5089/api/health' -TimeoutSec 3
        if ($response.status -eq 'ok' -and $response.database -eq 'connected') {
            $healthy = $true
            break
        }
    } catch {
        Start-Sleep -Milliseconds 500
    }
}
if (-not $healthy) {
    $errorLog = Join-Path $local 'import-api-error.log'
    if (Test-Path $errorLog) { Get-Content $errorLog -Tail 15 | Write-Output }
    throw 'Import API failed its health check.'
}
Write-Output 'WATHIQA_IMPORT_API_READY=http://127.0.0.1:5089'
