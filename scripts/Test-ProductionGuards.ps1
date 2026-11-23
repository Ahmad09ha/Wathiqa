# WP-09 — isolated production-configuration negative + positive guard tests.
# Uses ONLY wathiqa_import_dev, loopback port 5097 and gitignored .local
# fake clamscan executable. No production/VPS database or public listener.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$local=Join-Path $root '.local'
$project=Join-Path $root 'backend/Wathiqa.ImportApi'
if(-not(Test-Path (Join-Path $project 'bin/Debug/net10.0/Wathiqa.ImportApi.dll'))){
 throw 'Build Import API first'
}
if(Get-NetTCPConnection -LocalPort 5097 -State Listen -ErrorAction SilentlyContinue){
 throw 'Port 5097 is already used. Refusing to interrupt unrelated process.'
}
$password=([IO.File]::ReadAllText((Join-Path $local 'import-db-password.txt'))).Trim()
$env:ConnectionStrings__ImportDatabase='Host=127.0.0.1;Port=55432;Database=wathiqa_import_dev;Username=wathiqa_import_dev;Password='+$password
$env:ASPNETCORE_URLS='http://127.0.0.1:5097'
$env:ASPNETCORE_ENVIRONMENT='Production'
$env:DOTNET_ENVIRONMENT='Production'
$env:Documents__PrivateRoot=Join-Path $local 'wp09-prod-guard-private'
$qaKeys=Join-Path $local 'wp09-prod-guard-keys'
$certFile=Join-Path $local 'wp09-prod-guard-certificate.pfx'
Remove-Item Env:\Documents__ClamScanExecutable -ErrorAction SilentlyContinue
Remove-Item Env:\DataProtection__KeysPath -ErrorAction SilentlyContinue
Remove-Item Env:\DataProtection__CertificatePath -ErrorAction SilentlyContinue
Remove-Item Env:\DataProtection__CertificatePassword -ErrorAction SilentlyContinue
Remove-Item Env:\ReverseProxy__KnownProxies -ErrorAction SilentlyContinue

function StartQaProcess([string]$name){
 $stdout=Join-Path $local ('wp09-prod-guard-'+$name+'.log')
 $stderr=Join-Path $local ('wp09-prod-guard-'+$name+'-error.log')
 $proc=Start-Process dotnet.exe -ArgumentList 'bin/Debug/net10.0/Wathiqa.ImportApi.dll' -WorkingDirectory $project -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
 return $proc
}
function AssertStartupRejected([string]$name,[string]$matchText){
 $proc=StartQaProcess $name
 try{
  for($i=0;$i -lt 120;$i++){
   Start-Sleep -Milliseconds 250
   $proc.Refresh()
   if($proc.HasExited){break}
  }
  if(-not $proc.HasExited){
   throw ('Production guard '+$name+' incorrectly allowed server startup')
  }
  $logs=(Get-Content (Join-Path $local ('wp09-prod-guard-'+$name+'.log')) -Raw -ErrorAction SilentlyContinue)+
     (Get-Content (Join-Path $local ('wp09-prod-guard-'+$name+'-error.log')) -Raw -ErrorAction SilentlyContinue)
  if($logs -notmatch [regex]::Escape($matchText)){
   throw ('Production startup rejected for unexpected reason: '+$name)
  }
  Write-Output ('WP09_PRODUCTION_GUARD_PASS='+$name)
 }finally{
  $proc.Refresh()
  if(-not $proc.HasExited){Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue}
 }
}
try{
 AssertStartupRejected 'missing-trusted-proxy' 'ReverseProxy:KnownProxies is required'
 $env:ReverseProxy__KnownProxies='127.0.0.1'
 AssertStartupRejected 'missing-keys' 'DataProtection:KeysPath is required'
 $env:DataProtection__KeysPath=$qaKeys
 AssertStartupRejected 'missing-encryption-certificate' 'DataProtection:CertificatePath and DataProtection:CertificatePassword are required'
 $env:DataProtection__CertificatePath=Join-Path $local 'missing-cert-do-not-create.pfx'
 $env:DataProtection__CertificatePassword='QA-NonSecret'
 AssertStartupRejected 'invalid-encryption-certificate' 'DataProtection:CertificatePath must point to an existing absolute PFX file'

 # Export an existing disposable, LOCAL development certificate only. This
 # is not and must never become a production certificate.
 $random=New-Object byte[] 32
 $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
 try{$rng.GetBytes($random)}finally{$rng.Dispose()}
 $testPassword=[Convert]::ToBase64String($random)+'Aa9!'
 & dotnet dev-certs https --export-path $certFile --password $testPassword --quiet
 if($LASTEXITCODE -ne 0 -or -not(Test-Path $certFile)){
  throw 'Cannot create disposable local QA PFX certificate'
 }
 $env:DataProtection__CertificatePath=$certFile
 $env:DataProtection__CertificatePassword=$testPassword
 AssertStartupRejected 'missing-antivirus' 'Documents:ClamScanExecutable must be an absolute path'

 $scanner=@(Get-ChildItem (Join-Path $local 'wp09-scanner-probe/out') -Filter '*.exe' -ErrorAction SilentlyContinue)
 if($scanner.Count -ne 1){throw 'Run scripts/Test-ScannerPipeline.ps1 to build a FAKE scanner first'}
 $env:Documents__ClamScanExecutable=$scanner[0].FullName
 # Guard failures may create an empty key directory before rejecting the
 # missing certificate. Reject key material, not an empty test directory.
 if((Test-Path $qaKeys) -and @(Get-ChildItem $qaKeys -File -Force).Count -gt 0){
  throw 'QA encryption key files unexpectedly exist before the positive test'
 }
 $proc=StartQaProcess 'encrypted-keys'
 try{
  $ready=$false
  for($i=0;$i -lt 110;$i++){
   Start-Sleep -Milliseconds 250
   $proc.Refresh()
   if($proc.HasExited){break}
   try{
    $h=Invoke-RestMethod 'http://127.0.0.1:5097/api/health' -TimeoutSec 2
    if($h.status -eq 'ok' -and $h.database -eq 'connected'){$ready=$true;break}
   }catch{}
  }
  if(-not $ready){
   Get-Content (Join-Path $local 'wp09-prod-guard-encrypted-keys-error.log') -Tail 15 -ErrorAction SilentlyContinue
   throw 'QA Production-mode API did not start with all required safety settings'
  }
  Write-Output 'WP09_PRODUCTION_GUARD_PASS=valid-volumes-av-certificate-start'
   # Both Windows PowerShell 5.1 and PowerShell 7 must run this QA script.
   # HttpResponseException is absent in 5.1; inspect the HTTP status on the
   # response instead, and never mistake an unexpected 200 for a passing test.
   $httpsRejected=$false
   try{
    Invoke-RestMethod 'http://127.0.0.1:5097/api/auth/csrf' -TimeoutSec 5 -ErrorAction Stop | Out-Null
   }catch{
    if($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 400){
     $httpsRejected=$true
    }else{throw}
   }
   if(-not $httpsRejected){
    throw 'Non-HTTPS CSRF token unexpectedly succeeded without trusted proxy headers'
   }
  Write-Output 'WP09_PRODUCTION_GUARD_PASS=unforwarded-csrf-rejected-400'
  $csrf=Invoke-RestMethod 'http://127.0.0.1:5097/api/auth/csrf' -TimeoutSec 5 -Headers @{
   'X-Forwarded-Proto'='https'
   'X-Forwarded-For'='127.0.0.1'
  }
  if([string]::IsNullOrEmpty([string]$csrf.token)){throw 'CSRF issue did not generate a Data Protection token'}
  Write-Output 'WP09_PRODUCTION_GUARD_PASS=trusted-https-proxy-csrf-works'
   $keyFiles=@(Get-ChildItem $qaKeys -File -Filter 'key-*.xml')
   if($keyFiles.Count -lt 1){throw 'Production-mode Data Protection key ring missing'}
   foreach($file in $keyFiles){
    [xml]$xml=Get-Content $file.FullName -Raw
    # CertificateXmlEncryptor persists the decryption TYPE rather than the
    # encryptor name; .NET serializes it as EncryptedXmlDecryptor with XML-Enc.
    $secrets=@($xml.SelectNodes("//*[local-name()='encryptedSecret']"))
    $encrypted=@($xml.SelectNodes("//*[local-name()='EncryptedData']"))
    if($secrets.Count -ne 1 -or $encrypted.Count -lt 1 -or
       $secrets[0].GetAttribute('decryptorType') -notlike '*EncryptedXmlDecryptor*'){
     throw 'Production-mode Data Protection key was not encrypted using the PFX certificate'
    }
   }
  Write-Output 'WP09_PRODUCTION_GUARD_PASS=keyring-xml-encrypted-with-x509'
 }finally{
  $proc.Refresh()
  if(-not $proc.HasExited){Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue}
 }
}finally{
 foreach($name in @('ConnectionStrings__ImportDatabase','ASPNETCORE_URLS',
  'ASPNETCORE_ENVIRONMENT','DOTNET_ENVIRONMENT','DataProtection__KeysPath',
  'Documents__PrivateRoot','Documents__ClamScanExecutable',
  'DataProtection__CertificatePath','DataProtection__CertificatePassword',
  'ReverseProxy__KnownProxies')){
  Remove-Item ('Env:\'+$name) -ErrorAction SilentlyContinue
 }
 foreach($path in @($certFile,$qaKeys,(Join-Path $local 'wp09-prod-guard-private'))){
  if(Test-Path $path){Remove-Item -LiteralPath $path -Force -Recurse -ErrorAction SilentlyContinue}
 }
}
Write-Output 'WP09_PRODUCTION_SECURITY_GUARDS=PASS'
