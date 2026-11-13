param(
  [Parameter(Mandatory=$true)][string]$FixturePath,
  [switch]$Apply
)
# Deletes ONLY port QA records in isolated local PostgreSQL, after validation.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$local=Join-Path $root '.local'
$path=[IO.Path]::GetFullPath((Join-Path $root $FixturePath))
if(-not $path.StartsWith([IO.Path]::GetFullPath($local)+[IO.Path]::DirectorySeparatorChar,
  [StringComparison]::OrdinalIgnoreCase)){throw 'Fixture must be under .local'}
if(-not(Test-Path $path)){throw 'Fixture not found'}
$f=Get-Content -Raw -Encoding UTF8 $path | ConvertFrom-Json
if($f.tag -cnotmatch '^PORT_QA_[a-z0-9]{12}$'){throw 'Invalid QA tag'}
$ids=@($f.ports|ForEach-Object{
  if($_.slug -cnotin @('demo-a','demo-b')){throw 'Unknown tenant'}
  $guid=[guid]::Empty
  if(-not [guid]::TryParse([string]$_.id,[ref]$guid)){throw 'Invalid ID'}
  "'"+$guid.ToString('D')+"'::uuid"
})
if($ids.Count -eq 0 -or $ids.Count -gt 20){throw 'Unexpected fixture size'}
$env:PGPASSFILE=Join-Path $local 'import-pgpass.conf'
$psql='C:\Program Files\PostgreSQL\18\bin\psql.exe'
if(-not(Test-Path $env:PGPASSFILE)){throw 'Local Postgres credentials not configured'}
$sql=@'
BEGIN;
DO $guard$
BEGIN
 IF current_database()<>'wathiqa_import_dev' THEN
   RAISE EXCEPTION 'Only development import database permitted';
 END IF;
 IF EXISTS(
  SELECT 1 FROM "TenantPorts" p JOIN "Tenants" t ON t."Id"=p."TenantId"
  WHERE p."Id" IN (__IDS__)
  AND (t."Slug" NOT IN ('demo-a','demo-b') OR p."Name" NOT LIKE '__TAG__%' OR NOT p."IsDeleted")
 ) THEN RAISE EXCEPTION 'Unsafe port record in QA fixture'; END IF;
 IF EXISTS(
  SELECT 1 FROM "TenantPortAudits" a
  WHERE a."PortId" IN (__IDS__) AND a."NameSnapshot" NOT LIKE '__TAG__%'
 ) THEN RAISE EXCEPTION 'Unexpected audit row'; END IF;
END $guard$;
SELECT 'QA_PORTS',COUNT(*) FROM "TenantPorts" WHERE "Id" IN (__IDS__);
SELECT 'QA_PORT_AUDITS',COUNT(*) FROM "TenantPortAudits" WHERE "PortId" IN (__IDS__);
__DELETE__
COMMIT;
'@
$delete=@'
DELETE FROM "TenantPortAudits" WHERE "PortId" IN (__IDS__);
DELETE FROM "TenantPorts" WHERE "Id" IN (__IDS__) AND "IsDeleted";
'@
$sql=$sql.Replace('__DELETE__',$(if($Apply){$delete}else{''}))
$sql=$sql.Replace('__TAG__',[string]$f.tag)
$sql=$sql.Replace('__IDS__',($ids -join ','))
$temp=Join-Path $local ('cleanup-ports-'+[guid]::NewGuid().ToString('N')+'.sql')
[IO.File]::WriteAllText($temp,$sql,[Text.UTF8Encoding]::new($false))
try {
  $output=& $psql -X -h 127.0.0.1 -p 55432 -U wathiqa_import_dev -d wathiqa_import_dev -v ON_ERROR_STOP=1 -f $temp
  if($LASTEXITCODE -ne 0){throw 'SQL QA cleanup refused or failed'}
  $output|Where-Object {$_ -match 'QA_PORT|^DELETE '}|Write-Output
} finally {
  Remove-Item $temp -Force -ErrorAction SilentlyContinue
}
Write-Output $(if($Apply){'PORT_QA_CLEANUP_APPLIED'}else{'PORT_QA_DRY_RUN'})
