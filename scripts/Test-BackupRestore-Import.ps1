# WP-09 — destructive operations ONLY on a freshly generated wathiqa_restore_qa_* DB.
# Rehearses PostgreSQL custom dump/restore plus private blob and key-ring
# integrity. Uses gitignored .local staging, deletes plaintext QA staging.
# NOT a production backup service. See docs/implementation/WP-09-VERIFICATION.md.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$local=Join-Path $root '.local'
$pg='C:\Program Files\PostgreSQL\18\bin'
$psql=Join-Path $pg 'psql.exe'
$dump=Join-Path $pg 'pg_dump.exe'
$restore=Join-Path $pg 'pg_restore.exe'
$createdb=Join-Path $pg 'createdb.exe'
$dropdb=Join-Path $pg 'dropdb.exe'
$hostName='127.0.0.1'
$port='55432'
$sourceDb='wathiqa_import_dev'
$owner='wathiqa_import_dev'
$admin=([IO.File]::ReadAllText((Join-Path $local 'db-role.txt'))).Trim()
if($admin -notin @('hussam_dev','wathiqa_dev')){throw 'Unexpected local PostgreSQL administrator'}
foreach($f in @($psql,$dump,$restore,$createdb,$dropdb,
 (Join-Path $local 'import-pgpass.conf'),(Join-Path $local 'pgpass.conf'))){
 if(-not(Test-Path $f)){throw ('Required local backup tooling missing: '+$f)}
}
$env:PGCONNECT_TIMEOUT='5'
$env:PGPASSFILE=Join-Path $local 'import-pgpass.conf'
$suffix=[Guid]::NewGuid().ToString('N').Substring(0,10)
$qaDb='wathiqa_restore_qa_'+$suffix
$working=Join-Path $local ('restore-rehearsal-'+$suffix)
$archive=Join-Path $working 'import.dump'
$restorePgPass=Join-Path $working 'restore-pgpass.conf'
$docRoot=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Wathiqa\ImportPrivateFiles'
$keyRoot=Join-Path $local 'import-dp-keys'
$qaCreated=$false
$success=$false
function MustSucceed([string]$what){
 if($LASTEXITCODE -ne 0){throw ($what+' failed with exit '+$LASTEXITCODE)}
}
function GetDatabaseCounts([string]$dbName){
 $query=@'
SELECT 'Tenants='||COUNT(*) FROM "Tenants";
SELECT 'Users='||COUNT(*) FROM "AspNetUsers";
SELECT 'Orders='||COUNT(*) FROM "Orders";
SELECT 'Documents='||COUNT(*) FROM "StoredDocuments";
 SELECT 'DocumentLinks='||COUNT(*) FROM "StoredDocumentLinks";
 SELECT 'PaymentSchedules='||COUNT(*) FROM "PaymentSchedules";
 SELECT 'PaymentTransfers='||COUNT(*) FROM "PaymentTransfers";
 SELECT 'PaymentAllocations='||COUNT(*) FROM "PaymentAllocations";
 SELECT 'PaymentReturns='||COUNT(*) FROM "PaymentReturns";
 SELECT 'OrderExpenses='||COUNT(*) FROM "OrderExpenses";
 SELECT 'PaymentAudits='||COUNT(*) FROM "PaymentAudits";
 SELECT 'Migrations='||COUNT(*) FROM "__EFMigrationsHistory";
'@
 # Use a real SQL file; Windows quoting in -c mangles quoted EF table names.
 $sqlFile=Join-Path $working 'count-qa.sql'
 [IO.File]::WriteAllText($sqlFile,$query,[Text.Encoding]::UTF8)
 try{
  $env:PGPASSFILE=$restorePgPass
  $output=@(& $psql -X -v ON_ERROR_STOP=1 -h $hostName -p $port -U $owner -d $dbName -t -A -f $sqlFile)
  MustSucceed 'Read database counts'
  return ,(@($output | Where-Object {$_ -match '^[A-Za-z]+=\d+$'}))
 }finally{Remove-Item $sqlFile -Force -ErrorAction SilentlyContinue}
}
function BackupFiles([string]$original,[string]$staged,[string]$label){
 if(-not(Test-Path $original)){throw ('Missing '+$label+': '+$original)}
 $source=(Resolve-Path $original).Path.TrimEnd('\')
 New-Item -ItemType Directory -Force -Path $staged | Out-Null
 $files=@(Get-ChildItem $source -File -Recurse -Force|
    Where-Object {$_.Extension -ne '.pending'})
 foreach($file in $files){
  $relative=$file.FullName.Substring($source.Length).TrimStart('\')
  $destination=Join-Path $staged $relative
  New-Item -ItemType Directory -Force -Path (Split-Path $destination -Parent)|Out-Null
  Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
  $before=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
  $after=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
  if($before -ne $after){throw ('Corrupted copied '+$label+' file: '+$relative)}
 }
 Write-Host ('BACKED_UP_'+$label.ToUpperInvariant()+'_FILES='+$files.Count)
 return $files.Count
}
function CompareRestoredFiles([string]$stage,[string]$restoreTarget,[int]$expected){
 New-Item -ItemType Directory -Path $restoreTarget -Force|Out-Null
 $files=@(Get-ChildItem $stage -Recurse -File -Force)
 foreach($file in $files){
  $relative=$file.FullName.Substring($stage.Length).TrimStart('\')
  $destination=Join-Path $restoreTarget $relative
  New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
  Copy-Item -LiteralPath $file.FullName -Destination $destination
  if((Get-FileHash $file.FullName -Algorithm SHA256).Hash -ne
     (Get-FileHash $destination -Algorithm SHA256).Hash){
   throw ('Restored file hash mismatch: '+$relative)
  }
 }
  if($files.Count -ne $expected){throw 'Restored file count changed'}
}
function VerifyReferencedBlobHashes([string]$dbName,[string]$blobRoot){
  # Checking directory-to-directory copies alone can pass even when a DB row
  # refers to a missing original file. Prove all restored DB references too.
  $sqlFile=Join-Path $working 'verify-blob-qa.sql'
  [IO.File]::WriteAllText($sqlFile,
   'SELECT "StorageKey" || ''|'' || "Sha256" FROM "StoredDocuments" ORDER BY "StorageKey";',
   [Text.Encoding]::UTF8)
  try{
    $env:PGPASSFILE=$restorePgPass
    $rows=@(& $psql -X -v ON_ERROR_STOP=1 -h $hostName -p $port -U $owner -d $dbName -t -A -f $sqlFile)
    MustSucceed 'List stored document references'
    $verified=0
    foreach($row in $rows){
      if($row -notmatch '^([0-9a-f]{32}/[0-9a-f]{32})\|([0-9a-f]{64})$'){
        throw 'Invalid private document key/hash recorded in the database'
      }
      $key=$Matches[1];$expected=$Matches[2]
      $file=Join-Path $blobRoot ($key.Replace('/',[IO.Path]::DirectorySeparatorChar))
      if(-not(Test-Path -LiteralPath $file -PathType Leaf)){
        throw 'Database-referenced private document is missing from backup/restore'
      }
      $actual=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
      if($actual -ne $expected){throw 'Database-referenced document SHA256 mismatch'}
      $verified++
    }
    return $verified
  }finally{Remove-Item $sqlFile -Force -ErrorAction SilentlyContinue}
}
New-Item -ItemType Directory -Force -Path $working | Out-Null
try{
 $importPassword=([IO.File]::ReadAllText((Join-Path $local 'import-db-password.txt'))).Trim()
 [IO.File]::WriteAllText($restorePgPass,
  '127.0.0.1:55432:*:wathiqa_import_dev:'+$importPassword,
  [Text.Encoding]::ASCII)
 # Verify exact target and keep the live import DB read-only throughout.
 $env:PGPASSFILE=Join-Path $local 'import-pgpass.conf'
 $actual=@(& $psql -X -h $hostName -p $port -U $owner -d $sourceDb -t -A -c 'SELECT current_database();')
 MustSucceed 'Verify source database'
 if($actual.Count -ne 1 -or $actual[0] -ne $sourceDb){
  throw 'Backup source is not the isolated import development database'
 }
 & $dump -h $hostName -p $port -U $owner -d $sourceDb -Fc --no-owner --no-acl -f $archive
 MustSucceed 'Create consistent PostgreSQL custom dump'
 if(-not(Test-Path $archive) -or (Get-Item $archive).Length -lt 1024){
  throw 'PostgreSQL archive is empty/invalid'
 }
 & $restore --list $archive *> $null
 MustSucceed 'Inspect PostgreSQL archive'
 $dumpHash=(Get-FileHash $archive -Algorithm SHA256).Hash
 Write-Output ('PG_DUMP_SHA256='+$dumpHash)
   $sourceCounts=GetDatabaseCounts $sourceDb
   # A backup of empty finance tables cannot prove financial recovery. Require
   # a temporary, tagged WP-05 fixture before this rehearsal (and clean it
   # afterwards with scripts/Cleanup-ImportDocumentsQa.ps1 -Apply).
   foreach($name in @('PaymentTransfers','PaymentAllocations','PaymentReturns','OrderExpenses','PaymentAudits')){
     $item=@($sourceCounts | Where-Object {$_ -match ('^'+$name+'=(\d+)$')})
     if($item.Count -ne 1 -or [int](($item[0] -split '=')[1]) -lt 1){
       throw ('Restore QA needs a nonempty '+$name+' fixture; run Test-Payments.mjs first')
     }
   }
  $docCount=BackupFiles $docRoot (Join-Path $working 'private-documents') 'Document'
  $keyCount=BackupFiles $keyRoot (Join-Path $working 'data-protection-keys') 'Key'
  if($keyCount -lt 1){throw 'Cannot verify cookie-key recovery: no Data Protection keys were generated'}
  $verifiedSource=VerifyReferencedBlobHashes $sourceDb (Join-Path $working 'private-documents')
  if($verifiedSource -lt 1){
    throw 'Restore QA needs at least one persisted document fixture; an empty document backup cannot prove blob recovery'
  }
 # Restore strictly into a random, non-production database. No --clean and no
 # -C: source and live database must never be overwritten.
 $env:PGPASSFILE=Join-Path $local 'pgpass.conf'
 & $createdb -h $hostName -p $port -U $admin -T template0 -O $owner -E UTF8 $qaDb
 MustSucceed 'Create isolated restore QA database'
 $qaCreated=$true
 $env:PGPASSFILE=$restorePgPass
 & $restore -h $hostName -p $port -U $owner -d $qaDb --no-owner --no-acl --exit-on-error $archive
 MustSucceed 'Restore isolated PostgreSQL archive'
 $restoredCounts=GetDatabaseCounts $qaDb
 if(($sourceCounts -join ',') -ne ($restoredCounts -join ',')){
  throw ('Source/restore count mismatch: '+($sourceCounts -join ',')+' <> '+($restoredCounts -join ','))
 }
 Write-Output ('DB_RESTORE_COUNTS_MATCH='+($restoredCounts -join ','))
  CompareRestoredFiles (Join-Path $working 'private-documents') (Join-Path $working 'restored-documents') $docCount
  CompareRestoredFiles (Join-Path $working 'data-protection-keys') (Join-Path $working 'restored-keys') $keyCount
  $verifiedRestored=VerifyReferencedBlobHashes $qaDb (Join-Path $working 'restored-documents')
  if($verifiedRestored -ne $verifiedSource){throw 'Restored DB blob reference count mismatch'}
  if((Get-FileHash $archive -Algorithm SHA256).Hash -ne $dumpHash){
  throw 'PostgreSQL backup archive hash changed during rehearsal'
 }
 $success=$true
  Write-Output 'WP09_BACKUP_RESTORE_REHEARSAL=PASS'
  Write-Output 'WP09_PAYMENT_LEDGER_DB_RESTORE_COUNTS=VERIFIED'
  Write-Output ('RESTORED_DOCUMENT_BLOBS='+$docCount)
  Write-Output ('RESTORED_DB_REFERENCED_BLOBS_SHA256_VERIFIED='+$verifiedRestored)
 Write-Output ('RESTORED_DATA_PROTECTION_KEY_FILES='+$keyCount)
}finally{
 if($qaCreated){
  if($qaDb -notmatch '^wathiqa_restore_qa_[0-9a-f]{10}$'){
   throw 'Refusing cleanup of any non-rehearsal database'
  }
  $env:PGPASSFILE=Join-Path $local 'pgpass.conf'
  & $dropdb --if-exists -h $hostName -p $port -U $admin $qaDb
  if($LASTEXITCODE -ne 0){Write-Warning 'QA restore DB cleanup failed; remove only the recorded wathiqa_restore_qa_* database.'}
 }
 # Plaintext backups must never be left on disk after QA. Production backups
 # use encrypted off-host restic instead.
 if(Test-Path $working){Remove-Item -LiteralPath $working -Force -Recurse -ErrorAction SilentlyContinue}
}
if(-not $success){exit 1}
