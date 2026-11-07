# WP-09 — isolated scanner process integration (Windows development only).
# Simulated exit codes 0/1/2 are NOT real antivirus detection.
# Runs fake clamscan-compatible apphost on port 5096, not the normal API 5089.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$local=Join-Path $root '.local'
$probe=Join-Path $local 'wp09-scanner-probe'
$published=Join-Path $probe 'out'
$private=Join-Path $local 'wp09-scanner-private'
$apiRoot=Join-Path $root 'backend/Wathiqa.ImportApi'
$apiDll=Join-Path $apiRoot 'bin/Debug/net10.0/Wathiqa.ImportApi.dll'
if(-not(Test-Path $apiDll)){throw 'Import API must be built first'}
if(Test-Path $private){throw 'QA scanner private directory already exists; inspect before rerunning'}
if(Get-NetTCPConnection -State Listen -LocalPort 5096 -ErrorAction SilentlyContinue){
 throw 'QA scanner port 5096 is occupied; refusing to stop another process'
}
if(-not(Test-Path $probe)){
 & dotnet new console -n 'wp09-scanner-probe' -o $probe -f net10.0
 if($LASTEXITCODE -ne 0){throw 'Cannot create fake scanner QA fixture'}
}
$program=@'
using System;
using System.IO;
public static class ScannerProbe
{
    // This test fixture only simulates ClamAV's DOCUMENTED exit codes.
    public static int Main(string[] arguments)
    {
        if(arguments.Length < 1 || !File.Exists(arguments[^1])) return 2;
        try
        {
            var content = File.ReadAllText(arguments[^1]);
            if(content.Contains("QA_MALWARE_MARKER",StringComparison.Ordinal)) return 1;
            if(content.Contains("QA_SCAN_FAILURE",StringComparison.Ordinal)) return 2;
            return 0;
        }
        catch(Exception) { return 2; }
    }
}
'@
[IO.File]::WriteAllText((Join-Path $probe 'Program.cs'),$program,[Text.Encoding]::UTF8)
& dotnet publish (Join-Path $probe 'wp09-scanner-probe.csproj') -c Release -r win-x64 --self-contained false -o $published -v q
if($LASTEXITCODE -ne 0){throw 'Fake QA scanner publish failed'}
$probeExe=@(Get-ChildItem $published -Filter '*.exe')
if($probeExe.Count -ne 1){throw 'QA probe must publish exactly one executable'}
New-Item -ItemType Directory -Force $private|Out-Null
$pw=([IO.File]::ReadAllText((Join-Path $local 'import-db-password.txt'))).Trim()
$env:ConnectionStrings__ImportDatabase='Host=127.0.0.1;Port=55432;Database=wathiqa_import_dev;Username=wathiqa_import_dev;Password='+$pw
$env:ASPNETCORE_URLS='http://127.0.0.1:5096'
$env:ASPNETCORE_ENVIRONMENT='Development'
$env:Documents__ClamScanExecutable=$probeExe[0].FullName
$env:Documents__PrivateRoot=$private
$env:DataProtection__KeysPath=Join-Path $local 'import-dp-keys'
Remove-Item Env:\WATHIQA_SEED_ACCESS_ACCOUNTS -ErrorAction SilentlyContinue
$stdout=Join-Path $local 'wp09-scanner-api.log'
$stderr=Join-Path $local 'wp09-scanner-api-error.log'
$process=$null
$testsPassed=$false
try{
 $process=Start-Process -FilePath dotnet.exe -ArgumentList 'bin/Debug/net10.0/Wathiqa.ImportApi.dll' -WorkingDirectory $apiRoot -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
 $ready=$false
 for($i=0;$i -lt 70;$i++){
  Start-Sleep -Milliseconds 350
  if($process.HasExited){break}
  try{
   $result=Invoke-RestMethod 'http://127.0.0.1:5096/api/health' -TimeoutSec 2
   if($result.status -eq 'ok' -and $result.database -eq 'connected'){
    $ready=$true;break
   }
  }catch{}
 }
 if(-not $ready){
  Get-Content $stdout -Tail 16 -ErrorAction SilentlyContinue
  Get-Content $stderr -Tail 16 -ErrorAction SilentlyContinue
  throw 'Scanner QA API failed to start'
 }
 Write-Output 'SCANNER_QA_API_ISOLATED_PORT=5096'
 & node (Join-Path $root 'scripts/Test-UploadThreatScan.mjs')
 if($LASTEXITCODE -ne 0){throw 'Scanner integration test failed'}
 $testsPassed=$true
}finally{
 if($process -and -not $process.HasExited){
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
 }
 foreach($name in @('ConnectionStrings__ImportDatabase','ASPNETCORE_URLS',
   'ASPNETCORE_ENVIRONMENT','Documents__ClamScanExecutable','Documents__PrivateRoot',
   'DataProtection__KeysPath')) {
  Remove-Item ('Env:\'+$name) -ErrorAction SilentlyContinue
 }
}
if(-not $testsPassed){exit 1}
# Only QA-tagged records; script checks the DB and dedicated fixtures before deletion.
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts/Cleanup-ImportDocumentsQa.ps1') -Apply *> (Join-Path $local 'wp09-scanner-cleanup.log')
if($LASTEXITCODE -ne 0){Get-Content (Join-Path $local 'wp09-scanner-cleanup.log') -Tail 25;throw 'QA fixture cleanup did not complete'}
Remove-Item -LiteralPath $private -Force -Recurse
Write-Output 'WP09_SCANNER_EXIT_CONTRACT=PASS'
Write-Output 'WP09_SCAN_QA_CLEANUP=PASS'
