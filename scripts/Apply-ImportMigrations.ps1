# Only the isolated Wathiqa import database, never the legacy editor DB.
# Operates with a dedicated local DB role and does not print secrets.
$ErrorActionPreference="Stop"
$root=Split-Path $PSScriptRoot -Parent
Set-Location $root
& (Join-Path $PSScriptRoot 'Initialize-ImportDatabase.ps1') | Out-Null
if($LASTEXITCODE -ne 0){throw 'Import DB initialization failed'}
$local=Join-Path $root '.local'
$dbCredential=([IO.File]::ReadAllText((Join-Path $local 'import-db-password.txt'))).Trim()
$env:ConnectionStrings__ImportDatabase="Host=127.0.0.1;Port=55432;Database=wathiqa_import_dev;Username=wathiqa_import_dev;Password=$dbCredential"
try {
    dotnet tool run dotnet-ef database update --project backend/Wathiqa.ImportApi/Wathiqa.ImportApi.csproj --startup-project backend/Wathiqa.ImportApi/Wathiqa.ImportApi.csproj --no-build
    if($LASTEXITCODE -ne 0){throw 'EF Core database migration failed'}
    Write-Output 'IMPORT_MIGRATIONS_APPLIED_ONLY_TO=wathiqa_import_dev'
}
finally {
    Remove-Item Env:\ConnectionStrings__ImportDatabase -ErrorAction SilentlyContinue
    $dbCredential=$null
}
