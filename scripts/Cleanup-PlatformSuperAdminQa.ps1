param(
  [Parameter(Mandatory=$true)][string]$FixturePath,
  [switch]$Apply
)
# Delete only a tagged, dedicated Platform QA merchant that has NO business
# facts. Default DRY RUN. Never target arbitrary merchant IDs or external DB.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$local=Join-Path $root '.local'
$path=[IO.Path]::GetFullPath((Join-Path $root $FixturePath))
$safeLocal=[IO.Path]::GetFullPath($local)+[IO.Path]::DirectorySeparatorChar
if(-not $path.StartsWith($safeLocal,[StringComparison]::OrdinalIgnoreCase)){
  throw 'QA fixture must be under gitignored .local directory.'
}
if(-not (Test-Path $path)){throw 'QA fixture missing'}
$fixture=Get-Content $path -Raw -Encoding UTF8|ConvertFrom-Json
if([string]$fixture.run -notmatch '^PA_QA_[a-f0-9]{12}$'){
  throw 'Refusing to clean an untagged Platform merchant.'
}
$parsed=[guid]::Empty
if(-not [guid]::TryParse([string]$fixture.tenantId,[ref]$parsed)){
  throw 'No valid tenant ID in QA fixture.'
}
$tenantId=([guid]$fixture.tenantId).ToString('D')
$slug='pa-qa-'+([string]$fixture.run).Substring(6)
$name=([string]$fixture.run)+' merchant'
$planGuards=''
$planDeletes=''
$planPrefix='pa-qa-'+([string]$fixture.run).Substring(6)
foreach($p in @($fixture.planIds)){
  if($null -eq $p){continue}
  $parsedPlan=[guid]::Empty
  if(-not [guid]::TryParse([string]$p.id,[ref]$parsedPlan)){
    throw 'Invalid QA plan ID; refusing cleanup'
  }
  $planId=$parsedPlan.ToString('D')
  $planCode=[string]$p.code
  if($planCode -ne ($planPrefix+'-3m') -and
     $planCode -ne ($planPrefix+'-unlimited')){
    throw 'QA plan code is not in the expected local-only namespace'
  }
  $planGuards+=@"
  IF NOT EXISTS (SELECT 1 FROM "PlatformSubscriptionPlans" WHERE "Id"='$planId'::uuid AND "Code"='$planCode') THEN
    RAISE EXCEPTION 'QA plan ID/code mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM "TenantSubscriptions" WHERE "PlanId"='$planId'::uuid AND "TenantId"<>'$tenantId'::uuid) THEN
    RAISE EXCEPTION 'QA plan has subscriptions for other tenants; refusing cleanup';
  END IF;
"@
  $planDeletes+=@"
DELETE FROM "PlatformAudits" WHERE "TenantId" IS NULL AND "Action" IN ('ManualPlanCreated','ManualPlanActiveChanged')
  AND "AfterJson" LIKE '%$planId%';
DELETE FROM "PlatformSubscriptionPlans" WHERE "Id"='$planId'::uuid AND "Code"='$planCode';
"@
}
$env:PGPASSFILE=Join-Path $local 'import-pgpass.conf'
$psql='C:\Program Files\PostgreSQL\18\bin\psql.exe'
if(-not(Test-Path $psql) -or -not(Test-Path $env:PGPASSFILE)){
  throw 'Local PostgreSQL connection setup missing'
}
$target=@(& $psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55432 -U wathiqa_import_dev -d wathiqa_import_dev -A -t -c 'SELECT current_database();')
if($LASTEXITCODE -ne 0 -or ($target -join '').Trim() -ne 'wathiqa_import_dev'){
  throw 'Cleanup cannot touch any database except wathiqa_import_dev'
}
$sql=@'
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM "Tenants" WHERE "Id"='__ID__'::uuid AND "Slug"='__SLUG__' AND "Name"='__NAME__') THEN
    RAISE EXCEPTION 'QA tenant identity mismatch';
  END IF;
  IF EXISTS(SELECT 1 FROM "Orders" WHERE "TenantId"='__ID__'::uuid)
     OR EXISTS(SELECT 1 FROM "Companies" WHERE "TenantId"='__ID__'::uuid)
     OR EXISTS(SELECT 1 FROM "Shipments" WHERE "TenantId"='__ID__'::uuid)
     OR EXISTS(SELECT 1 FROM "StoredDocuments" WHERE "TenantId"='__ID__'::uuid)
     OR EXISTS(SELECT 1 FROM "TenantPorts" WHERE "TenantId"='__ID__'::uuid)
     OR EXISTS(SELECT 1 FROM "PaymentTransfers" WHERE "TenantId"='__ID__'::uuid) THEN
    RAISE EXCEPTION 'QA tenant has real business records; refusing cleanup';
  END IF;
__PLAN_GUARDS__
END $$;
DELETE FROM "TenantSubscriptions" WHERE "TenantId"='__ID__'::uuid;
DELETE FROM "PlatformAudits" WHERE "TenantId"='__ID__'::uuid;
__PLAN_DELETES__
DELETE FROM "SecurityAudits" WHERE "TenantId"='__ID__'::uuid;
DELETE FROM "TenantInvitations" WHERE "TenantId"='__ID__'::uuid;
DELETE FROM "AspNetUserTokens" WHERE "UserId" IN (SELECT "Id" FROM "AspNetUsers" WHERE "TenantId"='__ID__'::uuid);
DELETE FROM "AspNetUserClaims" WHERE "UserId" IN (SELECT "Id" FROM "AspNetUsers" WHERE "TenantId"='__ID__'::uuid);
DELETE FROM "AspNetUserLogins" WHERE "UserId" IN (SELECT "Id" FROM "AspNetUsers" WHERE "TenantId"='__ID__'::uuid);
DELETE FROM "AspNetUserRoles" WHERE "UserId" IN (SELECT "Id" FROM "AspNetUsers" WHERE "TenantId"='__ID__'::uuid);
DELETE FROM "AspNetUsers" WHERE "TenantId"='__ID__'::uuid;
DELETE FROM "Tenants" WHERE "Id"='__ID__'::uuid AND "Slug"='__SLUG__' AND "Name"='__NAME__';
COMMIT;
'@
$sql=$sql.Replace('__ID__',$tenantId).Replace('__SLUG__',$slug).Replace('__NAME__',$name)
$sql=$sql.Replace('__PLAN_GUARDS__',$planGuards).Replace('__PLAN_DELETES__',$planDeletes)
if(-not $Apply){
  Write-Output ('PLATFORM_QA_CLEANUP_DRY_RUN='+$tenantId)
  Write-Output ('PLATFORM_QA_SLUG='+$slug)
  Write-Output 'No rows deleted. Pass -Apply for this exact QA fixture only.'
  exit 0
}
$sql | & $psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55432 -U wathiqa_import_dev -d wathiqa_import_dev | Out-Null
if($LASTEXITCODE -ne 0){throw 'Platform QA cleanup failed; transaction rolled back.'}
Write-Output ('PLATFORM_QA_CLEANUP_APPLIED='+$tenantId)
