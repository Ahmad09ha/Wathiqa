# Repeatable local production frontend build with durable exit-code evidence.
# Writes logs and status to gitignored .local/; never touches the database.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$local=Join-Path $root '.local'
New-Item -ItemType Directory -Force -Path $local | Out-Null
$log=Join-Path $local 'import-frontend-build.log'
$marker=Join-Path $local 'import-frontend-build-exit.txt'
if(Test-Path $marker){Remove-Item $marker -Force}
Set-Location (Join-Path $root 'frontend')
$env:NEXT_TELEMETRY_DISABLED='1'
$ErrorActionPreference='Continue'
& npm.cmd run build *> $log
$code=$LASTEXITCODE
[IO.File]::WriteAllText($marker,[string]$code,[Text.Encoding]::ASCII)
Write-Output ('NEXT_BUILD_EXIT='+$code)
exit $code
