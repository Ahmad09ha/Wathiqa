# Test auto seed on app startup with an alternate local port. No public deployment.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$local = Join-Path $root '.local'
$seeds = @(Get-Content (Join-Path $local 'import-access-accounts.json') -Raw -Encoding UTF8 | ConvertFrom-Json)
if ($seeds.Count -eq 1 -and $seeds[0] -is [array]) {$seeds = $seeds[0]}
if ($seeds.Count -ne 2) {throw 'Missing local seed credentials'}
$pwd = [IO.File]::ReadAllText((Join-Path $local 'import-db-password.txt')).Trim()
$dll = Join-Path $root 'backend/Wathiqa.ImportApi/bin/Debug/net10.0/Wathiqa.ImportApi.dll'
$env:ConnectionStrings__ImportDatabase = "Host=127.0.0.1;Port=55432;Database=wathiqa_import_dev;Username=wathiqa_import_dev;Password=$pwd"
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:ASPNETCORE_URLS = 'http://127.0.0.1:5091'
$env:WATHIQA_SEED_ACCESS_ACCOUNTS = 'true'
$env:WATHIQA_TRIAL_EMAIL = $seeds[0].email
$env:WATHIQA_TRIAL_PASSWORD = $seeds[0].password
$env:WATHIQA_UNLIMITED_EMAIL = $seeds[1].email
$env:WATHIQA_UNLIMITED_PASSWORD = $seeds[1].password
$out = Join-Path $local 'access-auto-startup.log'
$err = Join-Path $local 'access-auto-startup-error.log'
$process = $null
try {
    if (Get-NetTCPConnection -LocalPort 5091 -State Listen -ErrorAction SilentlyContinue) {
        throw 'Port 5091 is already occupied, refusing to interfere.'
    }
    $process = Start-Process -FilePath 'dotnet.exe' -ArgumentList "bin/Debug/net10.0/Wathiqa.ImportApi.dll" -WorkingDirectory (Join-Path $root 'backend/Wathiqa.ImportApi') -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
    $ready = $false
    for ($i=0; $i -lt 50; $i++) {
        Start-Sleep -Milliseconds 400
        try {
            $r = Invoke-RestMethod 'http://127.0.0.1:5091/api/health' -TimeoutSec 2
            if ($r.status -eq 'ok' -and $r.database -eq 'connected') {$ready=$true;break}
        } catch {}
        if ($process.HasExited) {break}
    }
    if (-not $ready) {
        Get-Content $out -Tail 10 -ErrorAction SilentlyContinue
        Get-Content $err -Tail 10 -ErrorAction SilentlyContinue
        throw 'Opt-in auto seed startup did not become healthy.'
    }
    $log = Get-Content $out -Raw
    if ($log -notmatch 'SEED_ACCESS_EXISTS=trial-access' -or
        $log -notmatch 'SEED_ACCESS_EXISTS=unlimited-access' -or
        $log -notmatch 'SEED_ACCESS_COMPLETE=2') {
        throw 'Automatic seed did not verify both accounts before server startup.'
    }
    Write-Output 'AUTO_SEED_STARTUP_PASS=both pre-existing accounts preserved'
    Write-Output 'AUTO_SEED_HEALTH_PASS=Import API listening on isolated test port'
} finally {
    if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    Remove-Item Env:\WATHIQA_SEED_ACCESS_ACCOUNTS -ErrorAction SilentlyContinue
    Remove-Item Env:\WATHIQA_TRIAL_EMAIL -ErrorAction SilentlyContinue
    Remove-Item Env:\WATHIQA_TRIAL_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:\WATHIQA_UNLIMITED_EMAIL -ErrorAction SilentlyContinue
    Remove-Item Env:\WATHIQA_UNLIMITED_PASSWORD -ErrorAction SilentlyContinue
}
