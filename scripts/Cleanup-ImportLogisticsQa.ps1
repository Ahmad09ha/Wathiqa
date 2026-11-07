# Clean ONLY disposable WP06 QA fixtures from the isolated local import DB.
# Does not touch legacy editor, real merchants, or any unrelated order.
param([switch]$Apply)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$local=Join-Path $root '.local'
$psql='C:\Program Files\PostgreSQL\18\bin\psql.exe'
$files=@(Get-ChildItem -Path $local -Filter 'logistics-qa-fixtures*.json' -File -ErrorAction SilentlyContinue)
if($files.Count -eq 0){Write-Output 'NO_WP06_FIXTURES_FOUND';exit 0}
$env:PGPASSFILE=Join-Path $local 'import-pgpass.conf'
$sqlFile=Join-Path $local 'logistics-qa-cleanup.sql'
foreach($file in $files){
    $fixture=Get-Content $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    $tag=[string]$fixture.run
    if($tag -cnotmatch '^WP06_QA_[a-f0-9]{8,9}-?$'){
        throw ('Refusing to clean unrecognized fixture tag: '+$file.Name)
    }
    $sql=@'
BEGIN;
DO $guard$
BEGIN
 IF current_database() <> 'wathiqa_import_dev' THEN
   RAISE EXCEPTION 'Refusing cleanup outside isolated import development DB';
 END IF;
END $guard$;
CREATE TEMP TABLE qa_orders ON COMMIT DROP AS
 SELECT o."Id" FROM "Orders" o JOIN "Tenants" t ON t."Id"=o."TenantId"
 WHERE o."SupplierRef"='__RUN__' AND t."Slug" IN ('demo-a','demo-b');
CREATE TEMP TABLE qa_shipments ON COMMIT DROP AS
 SELECT s."Id" FROM "Shipments" s WHERE s."OrderId" IN (SELECT "Id" FROM qa_orders);
CREATE TEMP TABLE qa_companies ON COMMIT DROP AS
 SELECT c."Id" FROM "Companies" c JOIN "Tenants" t ON t."Id"=c."TenantId"
 WHERE c."Name" LIKE '__RUN__%' AND t."Slug" IN ('demo-a','demo-b');
SELECT 'QA_MATCH' AS kind, '__RUN__' AS run,
       (SELECT COUNT(*) FROM qa_orders) AS orders,
       (SELECT COUNT(*) FROM qa_shipments) AS shipments,
       (SELECT COUNT(*) FROM "Containers" WHERE "ShipmentId" IN (SELECT "Id" FROM qa_shipments)) AS containers,
       (SELECT COUNT(*) FROM qa_companies) AS companies;
__DELETE__
COMMIT;
'@
    $deletion=@'
DELETE FROM "LogisticsAudits" WHERE "ShipmentId" IN (SELECT "Id" FROM qa_shipments);
DELETE FROM "CustomsClearances" WHERE "ShipmentId" IN (SELECT "Id" FROM qa_shipments);
DELETE FROM "Containers" WHERE "ShipmentId" IN (SELECT "Id" FROM qa_shipments);
DELETE FROM "Shipments" WHERE "Id" IN (SELECT "Id" FROM qa_shipments);
DELETE FROM "OrderAudits" WHERE "OrderId" IN (SELECT "Id" FROM qa_orders);
DELETE FROM "OrderItems" WHERE "OrderId" IN (SELECT "Id" FROM qa_orders);
DELETE FROM "Orders" WHERE "Id" IN (SELECT "Id" FROM qa_orders);
DELETE FROM "Companies" WHERE "Id" IN (SELECT "Id" FROM qa_companies);
'@
    $sql=$sql.Replace('__RUN__',$tag).Replace('__DELETE__',$(if($Apply){$deletion}else{''}))
    [IO.File]::WriteAllText($sqlFile,$sql,[Text.Encoding]::ASCII)
    try {
        $output=& $psql -h 127.0.0.1 -p 55432 -U wathiqa_import_dev -d wathiqa_import_dev -v ON_ERROR_STOP=1 -f $sqlFile
        if($LASTEXITCODE -ne 0){throw ('Cleanup failed for '+$tag)}
        $output | Where-Object {$_ -match 'QA_MATCH|WP06_QA_|^[0-9]+\s*\|' -or $_ -match '^DELETE [0-9]+'} | Write-Output
    }
    finally {Remove-Item $sqlFile -Force -ErrorAction SilentlyContinue}
}
Write-Output ($(if($Apply){'WP06_QA_TARGETED_CLEANUP_APPLIED'}else{'WP06_QA_DRY_RUN_ONLY'}))
