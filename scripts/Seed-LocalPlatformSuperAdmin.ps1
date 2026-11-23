# Local development only: provision ONE independent platform SuperAdmin.
# No default password or registered production HTTP endpoint; secrets live in
# gitignored .local and are never printed to shell output.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$local=Join-Path $root '.local'
& (Join-Path $PSScriptRoot 'Initialize-ImportDatabase.ps1') | Out-Null
$file=Join-Path $local 'platform-superadmin-account.json'
if(-not(Test-Path $file)){
  $raw=New-Object byte[] 40
  $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
  try{$rng.GetBytes($raw)}finally{$rng.Dispose()}
  $record=[pscustomobject]@{
    email='local-superadmin@wathiqa.invalid'
    password=([Convert]::ToBase64String($raw)+'Aa9!')
    displayName='Wathiqa Local SuperAdmin'
  }
  [IO.File]::WriteAllText($file,($record|ConvertTo-Json),[Text.Encoding]::UTF8)
}
$record=Get-Content $file -Raw -Encoding UTF8|ConvertFrom-Json
if($record.email -ne 'local-superadmin@wathiqa.invalid'){
  throw 'Local platform secret file has an unexpected account. Refusing auto-reset.'
}
$dll=Join-Path $root 'backend/Wathiqa.ImportApi/bin/Debug/net10.0/Wathiqa.ImportApi.dll'
if(-not(Test-Path $dll)){throw 'Build the new Import API first.'}
$dbPassword=[IO.File]::ReadAllText((Join-Path $local 'import-db-password.txt')).Trim()
$env:ConnectionStrings__ImportDatabase="Host=127.0.0.1;Port=55432;Database=wathiqa_import_dev;Username=wathiqa_import_dev;Password=$dbPassword"
$env:ASPNETCORE_ENVIRONMENT='Development'
$env:WATHIQA_SUPERADMIN_EMAIL=[string]$record.email
$env:WATHIQA_SUPERADMIN_PASSWORD=[string]$record.password
$env:WATHIQA_SUPERADMIN_DISPLAY_NAME=[string]$record.displayName
try{
  & dotnet $dll --seed-superadmin
  if($LASTEXITCODE -ne 0){throw 'Local SuperAdmin seed failed.'}
  Write-Output 'PLATFORM_SUPERADMIN_LOCAL_READY=true'
  Write-Output ('PLATFORM_SUPERADMIN_LOGIN_EMAIL='+$record.email)
  Write-Output ('PLATFORM_SUPERADMIN_CREDENTIALS_FILE='+$file)
}finally{
  Remove-Item Env:\WATHIQA_SUPERADMIN_EMAIL -ErrorAction SilentlyContinue
  Remove-Item Env:\WATHIQA_SUPERADMIN_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:\WATHIQA_SUPERADMIN_DISPLAY_NAME -ErrorAction SilentlyContinue
  Remove-Item Env:\ConnectionStrings__ImportDatabase -ErrorAction SilentlyContinue
}
