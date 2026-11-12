param(
  [Parameter(Mandatory=$true)][string]$FixturePath,
  [switch]$Apply
)
# Guarded cleanup for ONLY uniquely tagged dashboard company QA rows.
# Fixed loopback PostgreSQL instance and isolated development database.
$ErrorActionPreference="Stop"
$root=Split-Path $PSScriptRoot -Parent
$local=Join-Path $root '.local'
$file=[IO.Path]::GetFullPath((Join-Path $root $FixturePath))
$safe=[IO.Path]::GetFullPath($local)+[IO.Path]::DirectorySeparatorChar
if(-not $file.StartsWith($safe,[StringComparison]::OrdinalIgnoreCase)){
  throw 'Fixture outside .local is not permitted'
}
if(-not(Test-Path $file)){throw 'Dashboard QA fixture missing'}
$f=Get-Content $file -Raw -Encoding UTF8|ConvertFrom-Json
if($f.run -cnotmatch '^DASH_QA_[a-f0-9]{12}$' -or $f.tenantSlug -cne 'demo-a'){
  throw 'Refusing non-dashboard QA fixture'
}
$id=[guid]::Empty
if(-not [guid]::TryParse([string]$f.companyId,[ref]$id)){
  throw 'Dashboard QA fixture missing valid company ID'
}
$env:PGPASSFILE=Join-Path $local 'import-pgpass.conf'
$psql='C:\Program Files\PostgreSQL\18\bin\psql.exe'
if(-not(Test-Path $env:PGPASSFILE)){throw 'Local database password file missing'}
$sql=@'
BEGIN;
DO $guard$
BEGIN
 IF current_database()<>'wathiqa_import_dev' THEN
   RAISE EXCEPTION 'Only development import DB cleanup is permitted';
 END IF;
 IF EXISTS(
   SELECT 1 FROM "Companies" c JOIN "Tenants" t ON t."Id"=c."TenantId"
   WHERE c."Id"='__ID__'::uuid AND
     (t."Slug"<>'demo-a' OR c."Name" NOT LIKE '__TAG__%' OR NOT c."IsDeleted")
 ) THEN RAISE EXCEPTION 'QA company is not tagged and soft-deleted'; END IF;
 IF EXISTS(
   SELECT 1 FROM "Orders"
   WHERE "SupplierId"='__ID__'::uuid OR "CustomerId"='__ID__'::uuid
 ) OR EXISTS(
   SELECT 1 FROM "Shipments" WHERE "ShippingLineId"='__ID__'::uuid
 ) OR EXISTS(
   SELECT 1 FROM "CustomsClearances" WHERE "BrokerId"='__ID__'::uuid
 ) OR EXISTS(
   SELECT 1 FROM "PaymentTransfers" WHERE "BeneficiaryCompanyId"='__ID__'::uuid
 ) OR EXISTS(
   SELECT 1 FROM "OrderExpenses" WHERE "PayeeCompanyId"='__ID__'::uuid
 ) THEN RAISE EXCEPTION 'QA company has live business references'; END IF;
 IF EXISTS(SELECT 1 FROM "CompanyAudits" WHERE "CompanyId"='__ID__'::uuid
   AND "NameSnapshot" NOT LIKE '__TAG__%') THEN
   RAISE EXCEPTION 'Unexpected audit data on QA company'; END IF;
END $guard$;
SELECT 'QA_COMPANY_MATCH',COUNT(*) FROM "Companies" WHERE "Id"='__ID__'::uuid;
SELECT 'QA_AUDITS_MATCH',COUNT(*) FROM "CompanyAudits"
  WHERE "CompanyId"='__ID__'::uuid;
__DELETE__
COMMIT;
'@
$delete=@'
DELETE FROM "CompanyAudits" WHERE "CompanyId"='__ID__'::uuid
 AND "TenantId" IN (SELECT "Id" FROM "Tenants" WHERE "Slug"='demo-a');
DELETE FROM "Companies" WHERE "Id"='__ID__'::uuid
 AND "TenantId" IN (SELECT "Id" FROM "Tenants" WHERE "Slug"='demo-a')
 AND "Name" LIKE '__TAG__%' AND "IsDeleted";
'@
$sql=$sql.Replace('__DELETE__',$(if($Apply){$delete}else{''}))
$sql=$sql.Replace('__ID__',$id.ToString('D')).Replace('__TAG__',[string]$f.run)
$temporary=Join-Path $local ('dashboard-qa-clean-'+$id.ToString('N')+'.sql')
[IO.File]::WriteAllText($temporary,$sql,[Text.UTF8Encoding]::new($false))
try {
  $output=& $psql -X -h 127.0.0.1 -p 55432 -U wathiqa_import_dev -d wathiqa_import_dev -v ON_ERROR_STOP=1 -f $temporary
  if($LASTEXITCODE -ne 0){throw 'Guarded dashboard QA cleanup failed'}
  $output | Where-Object {$_ -match 'QA_COMPANY_MATCH|QA_AUDITS_MATCH|^DELETE '} | Write-Output
} finally {
  Remove-Item $temporary -Force -ErrorAction SilentlyContinue
}
Write-Output $(if($Apply){'DASHBOARD_COMPANY_QA_CLEANED'}else{'DASHBOARD_COMPANY_QA_DRY_RUN'})
