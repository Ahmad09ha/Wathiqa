# Apply only Wathiqa Import migrations to the isolated local PostgreSQL database.
# Not for production: fixed loopback host, fixed development DB and role.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$local=Join-Path $root '.local'
$passFile=Join-Path $local 'import-db-password.txt'
if(-not(Test-Path $passFile)){throw 'Run Initialize-ImportDatabase.ps1 first'}
$env:ConnectionStrings__ImportDatabase='Host=127.0.0.1;Port=55432;Database=wathiqa_import_dev;Username=wathiqa_import_dev;Password='+[IO.File]::ReadAllText($passFile).Trim()
try{
  Push-Location $root
  & dotnet ef database update --no-build --project backend/Wathiqa.ImportApi/Wathiqa.ImportApi.csproj --startup-project backend/Wathiqa.ImportApi/Wathiqa.ImportApi.csproj
  if($LASTEXITCODE -ne 0){throw 'Import DB migration failed'}
  & dotnet ef migrations has-pending-model-changes --no-build --project backend/Wathiqa.ImportApi/Wathiqa.ImportApi.csproj --startup-project backend/Wathiqa.ImportApi/Wathiqa.ImportApi.csproj
  if($LASTEXITCODE -ne 0){throw 'EF Model drift remains'}
  Write-Output 'LOCAL_IMPORT_MIGRATIONS_AND_MODEL_PASS'
}finally{
  Pop-Location
  Remove-Item Env:ConnectionStrings__ImportDatabase -ErrorAction SilentlyContinue
}
