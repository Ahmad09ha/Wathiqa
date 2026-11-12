param(
 [Parameter(Mandatory=$true)][string]$FixturePath,
 [switch]$Apply
)
# Delete business records ONLY for a unique disposable ShipsGo QA merchant.
# No provider calls. Always dry-run before Apply; never target production.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$local=Join-Path $root '.local'
$full=[IO.Path]::GetFullPath((Join-Path $root $FixturePath))
$safe=[IO.Path]::GetFullPath($local)+[IO.Path]::DirectorySeparatorChar
if(-not $full.StartsWith($safe,[StringComparison]::OrdinalIgnoreCase)){
 throw 'QA fixture must reside in .local'
}
$f=Get-Content $full -Raw -Encoding UTF8|ConvertFrom-Json
if($f.run -notmatch '^PA_QA_[a-f0-9]{12}$' -or -not $f.tenantId){
 throw 'Not a tagged platform QA merchant'
}
$id=([guid]$f.tenantId).ToString('D')
$orderId=([guid]$f.orderId).ToString('D')
$supplierId=([guid]$f.supplierId).ToString('D')
$slug='pa-qa-'+([string]$f.run).Substring(6)
$name=[string]$f.run+' merchant'
if(@($f.shipmentIds).Count -ne 2){throw 'Expected exactly two QA shipments'}
$env:PGPASSFILE=Join-Path $local 'import-pgpass.conf'
$psql='C:\Program Files\PostgreSQL\18\bin\psql.exe'
$sql=@'
BEGIN;
DO $guard$
BEGIN
  IF current_database()<>'wathiqa_import_dev' THEN
    RAISE EXCEPTION 'Not isolated local QA database';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM "Tenants"
    WHERE "Id"='__TENANT__'::uuid AND "Slug"='__SLUG__' AND "Name"='__NAME__') THEN
    RAISE EXCEPTION 'Tenant tag and ID do not match';
  END IF;
  IF EXISTS(SELECT 1 FROM "Orders" WHERE "TenantId"='__TENANT__'::uuid
    AND "Id"<>'__ORDER__'::uuid) THEN RAISE EXCEPTION 'Unexpected other Orders';END IF;
  IF EXISTS(SELECT 1 FROM "Companies" WHERE "TenantId"='__TENANT__'::uuid
    AND "Id"<>'__SUPPLIER__'::uuid) THEN RAISE EXCEPTION 'Unexpected other Companies';END IF;
  IF EXISTS(SELECT 1 FROM "StoredDocuments" WHERE "TenantId"='__TENANT__'::uuid)
    OR EXISTS(SELECT 1 FROM "PaymentTransfers" WHERE "TenantId"='__TENANT__'::uuid)
    OR EXISTS(SELECT 1 FROM "OrderExpenses" WHERE "TenantId"='__TENANT__'::uuid)
    OR EXISTS(SELECT 1 FROM "PaymentSchedules" WHERE "TenantId"='__TENANT__'::uuid)
    OR EXISTS(SELECT 1 FROM "PaymentAllocations" WHERE "TenantId"='__TENANT__'::uuid)
    OR EXISTS(SELECT 1 FROM "Shipments" WHERE "TenantId"='__TENANT__'::uuid
      AND "Id" NOT IN ('__SHIP1__'::uuid,'__SHIP2__'::uuid))
  THEN RAISE EXCEPTION 'Unexpected business records; refusing cleanup';END IF;
END $guard$;
SELECT 'QA_BILLS' AS label,COUNT(*) FROM "Shipments" WHERE "TenantId"='__TENANT__'::uuid;
SELECT 'QA_TRACKING' AS label,COUNT(*) FROM "SubscriptionTrackingUsages" WHERE "TenantId"='__TENANT__'::uuid;
__DELETIONS__
COMMIT;
'@
$del=@'
DELETE FROM "ShipmentTrackingReferences" WHERE "TenantId"='__TENANT__'::uuid;
DELETE FROM "SubscriptionTrackingUsages" WHERE "TenantId"='__TENANT__'::uuid;
DELETE FROM "LogisticsAudits" WHERE "TenantId"='__TENANT__'::uuid;
DELETE FROM "Containers" WHERE "TenantId"='__TENANT__'::uuid;
DELETE FROM "CustomsClearances" WHERE "TenantId"='__TENANT__'::uuid;
DELETE FROM "Shipments" WHERE "TenantId"='__TENANT__'::uuid;
DELETE FROM "OrderItems" WHERE "TenantId"='__TENANT__'::uuid;
DELETE FROM "OrderAudits" WHERE "TenantId"='__TENANT__'::uuid;
DELETE FROM "Orders" WHERE "TenantId"='__TENANT__'::uuid;
DELETE FROM "OrderNumberSequences" WHERE "TenantId"='__TENANT__'::uuid;
DELETE FROM "Companies" WHERE "TenantId"='__TENANT__'::uuid;
'@
$sql=$sql.Replace('__DELETIONS__',$(if($Apply){$del}else{''}))
$sql=$sql.Replace('__TENANT__',$id).Replace('__SLUG__',$slug).Replace('__NAME__',$name)
$sql=$sql.Replace('__ORDER__',$orderId).Replace('__SUPPLIER__',$supplierId)
$sql=$sql.Replace('__SHIP1__',([guid]$f.shipmentIds[0]).ToString('D'))
$sql=$sql.Replace('__SHIP2__',([guid]$f.shipmentIds[1]).ToString('D'))
if($sql -match '__[A-Z0-9]+__'){throw 'Unresolved QA placeholder'}
$tmp=Join-Path $local ('shipsgo-qa-clean-'+$id+'.sql')
[IO.File]::WriteAllText($tmp,$sql,[Text.UTF8Encoding]::new($false))
try {
 $result=& $psql -X -h 127.0.0.1 -p 55432 -U wathiqa_import_dev -d wathiqa_import_dev -v ON_ERROR_STOP=1 -f $tmp
 if($LASTEXITCODE -ne 0){throw 'ShipsGo QA cleanup transaction failed'}
 $result|Where-Object {$_ -match 'QA_BILLS|QA_TRACKING|DELETE '}|Write-Output
} finally {Remove-Item $tmp -Force -ErrorAction SilentlyContinue}
Write-Output $(if($Apply){'SHIPS_GO_QA_BUSINESS_CLEANED'}else{'SHIPS_GO_QA_DRY_RUN'})
if($Apply){
 & (Join-Path $PSScriptRoot 'Cleanup-PlatformSuperAdminQa.ps1') -FixturePath $FixturePath -Apply
 if($LASTEXITCODE -ne 0){throw 'Platform merchant QA cleanup failed'}
}
