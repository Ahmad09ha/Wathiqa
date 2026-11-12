# WP-07 targeted test cleanup, local isolated import DB only.
# Dry-run default. -Apply removes only generated WP07_QA fixtures and their private blobs.
param([switch]$Apply,[string]$Run)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$local=Join-Path $root '.local'
$files=@(Get-ChildItem $local -Filter 'documents-qa-fixtures-WP07_QA_*.json' -File -ErrorAction SilentlyContinue |
  Where-Object { -not $Run -or $_.Name -eq ('documents-qa-fixtures-'+$Run+'.json') })
if($files.Count -eq 0){Write-Output 'NO_WP07_QA_FIXTURES';exit 0}
$psql='C:\Program Files\PostgreSQL\18\bin\psql.exe'
$env:PGPASSFILE=Join-Path $local 'import-pgpass.conf'
$storageRoot=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Wathiqa\ImportPrivateFiles'
$sqlFile=Join-Path $local 'wp07-qa-guarded-cleanup.sql'
foreach($file in $files){
    $entry=Get-Content $file.FullName -Raw -Encoding UTF8|ConvertFrom-Json
    $tag=[string]$entry.run
    if($tag -cnotmatch '^WP07_QA_[a-f0-9]{9}$'){throw "Unrecognized QA tag, refusing cleanup: $($file.Name)"}
    $docIds=@($entry.documents|ForEach-Object {([guid]$_.id).ToString()})
    $ruleIds=@($entry.requirements|ForEach-Object {([guid]$_.id).ToString()})
    $docIn=if($docIds.Count){"'"+($docIds -join "','")+"'"}else{"'00000000-0000-0000-0000-000000000000'"}
    $ruleIn=if($ruleIds.Count){"'"+($ruleIds -join "','")+"'"}else{"'00000000-0000-0000-0000-000000000000'"}
    $qaDocSql=@'
SELECT d."StorageKey" FROM "StoredDocuments" d
JOIN "Tenants" t ON t."Id"=d."TenantId"
WHERE d."Id" IN (__DOC_IDS__) AND t."Slug" IN ('demo-a','demo-b')
AND EXISTS(
  SELECT 1 FROM "StoredDocumentLinks" l
  WHERE l."DocumentId"=d."Id" AND
  (l."OrderId" IN(SELECT "Id" FROM "Orders" WHERE "SupplierRef"='__TAG__')
  OR l."ShipmentId" IN(SELECT s."Id" FROM "Shipments" s JOIN "Orders" o ON o."Id"=s."OrderId" WHERE o."SupplierRef"='__TAG__')
  OR l."ContainerId" IN(SELECT c."Id" FROM "Containers" c JOIN "Shipments" s ON s."Id"=c."ShipmentId" JOIN "Orders" o ON o."Id"=s."OrderId" WHERE o."SupplierRef"='__TAG__'))
);
'@
    $qaDocSql=$qaDocSql.Replace('__DOC_IDS__',$docIn).Replace('__TAG__',$tag)
    [IO.File]::WriteAllText($sqlFile,$qaDocSql,[Text.Encoding]::ASCII)
    try{
      $fileKeys=@(& $psql -h 127.0.0.1 -p 55432 -U wathiqa_import_dev -d wathiqa_import_dev -v ON_ERROR_STOP=1 -t -A -f $sqlFile |
        Where-Object {$_ -match '^[0-9a-f]{32}/[0-9a-f]{32}$'})
      if($LASTEXITCODE -ne 0){throw "Could not inspect QA files; no changes made."}
    }finally{Remove-Item $sqlFile -Force -ErrorAction SilentlyContinue}
    # A completed fixture is idempotent: the matching DB rows and keys are
    # already gone. A partial nonzero mismatch still requires manual review.
    if($fileKeys.Count -ne $docIds.Count -and $fileKeys.Count -gt 0){
      throw "QA document ownership mismatch for $tag; expected $($docIds.Count), got $($fileKeys.Count). Manual review required."
    }
    $sql=@'
BEGIN;
DO $guard$
BEGIN
 IF current_database()<>'wathiqa_import_dev' THEN
  RAISE EXCEPTION 'Refusing cleanup outside isolated import DB';
 END IF;
END $guard$;
CREATE TEMP TABLE qa_orders ON COMMIT DROP AS
 SELECT o."Id" FROM "Orders" o JOIN "Tenants" t ON t."Id"=o."TenantId"
 WHERE o."SupplierRef"='__TAG__' AND t."Slug" IN('demo-a','demo-b');
CREATE TEMP TABLE qa_shipments ON COMMIT DROP AS
 SELECT s."Id" FROM "Shipments" s WHERE s."OrderId" IN(SELECT "Id" FROM qa_orders);
CREATE TEMP TABLE qa_containers ON COMMIT DROP AS
 SELECT c."Id" FROM "Containers" c WHERE c."ShipmentId" IN(SELECT "Id" FROM qa_shipments);
CREATE TEMP TABLE qa_docs ON COMMIT DROP AS
 SELECT d."Id" FROM "StoredDocuments" d WHERE d."Id" IN(__DOC_IDS__) AND
 EXISTS(SELECT 1 FROM "StoredDocumentLinks" l WHERE l."DocumentId"=d."Id" AND
 (l."OrderId" IN(SELECT "Id" FROM qa_orders) OR
  l."ShipmentId" IN(SELECT "Id" FROM qa_shipments) OR
  l."ContainerId" IN(SELECT "Id" FROM qa_containers)));
CREATE TEMP TABLE qa_rules ON COMMIT DROP AS
 SELECT r."Id" FROM "DocumentRequirementRules" r JOIN "Tenants" t ON t."Id"=r."TenantId"
 WHERE r."Id" IN(__RULE_IDS__) AND t."Slug" IN('demo-a','demo-b');
DO $check$
BEGIN
 IF EXISTS(
  SELECT 1 FROM "StoredDocumentLinks" l
  WHERE (l."OrderId" IN(SELECT "Id" FROM qa_orders) OR
    l."ShipmentId" IN(SELECT "Id" FROM qa_shipments) OR
    l."ContainerId" IN(SELECT "Id" FROM qa_containers))
  AND l."DocumentId" NOT IN(SELECT "Id" FROM qa_docs)
 ) THEN RAISE EXCEPTION 'Non-QA document linked to QA target, refusing deletion'; END IF;
END $check$;
SELECT 'QA_MATCH' AS kind,'__TAG__' AS run,
 (SELECT COUNT(*) FROM qa_orders) AS orders,
 (SELECT COUNT(*) FROM qa_docs) AS documents,
 (SELECT COUNT(*) FROM qa_shipments) AS shipments,
 (SELECT COUNT(*) FROM qa_containers) AS containers,
 (SELECT COUNT(*) FROM qa_rules) AS rules;
__DELETIONS__
COMMIT;
'@
    $deletions=@'
DELETE FROM "DocumentRequirementWaivers" WHERE "RequirementId" IN(SELECT "Id" FROM qa_rules)
  OR "OrderId" IN(SELECT "Id" FROM qa_orders)
  OR "ShipmentId" IN(SELECT "Id" FROM qa_shipments)
  OR "ContainerId" IN(SELECT "Id" FROM qa_containers);
DELETE FROM "DocumentRequirementRules" WHERE "Id" IN(SELECT "Id" FROM qa_rules);
-- WP-05 tests create financial facts in the SAME guarded, uniquely tagged
-- QA Orders. Remove dependent rows before the proof documents and orders.
-- Never use this deletion pattern for a real merchant purchase order.
DELETE FROM "PaymentReturns" WHERE "OrderId" IN(SELECT "Id" FROM qa_orders);
DELETE FROM "PaymentAllocations" WHERE "OrderId" IN(SELECT "Id" FROM qa_orders);
DELETE FROM "PaymentAudits" WHERE "OrderId" IN(SELECT "Id" FROM qa_orders);
DELETE FROM "OrderExpenses" WHERE "OrderId" IN(SELECT "Id" FROM qa_orders);
DELETE FROM "PaymentTransfers" WHERE "OrderId" IN(SELECT "Id" FROM qa_orders);
DELETE FROM "PaymentSchedules" WHERE "OrderId" IN(SELECT "Id" FROM qa_orders);
DELETE FROM "StoredDocumentAudits" WHERE "DocumentId" IN(SELECT "Id" FROM qa_docs);
DELETE FROM "StoredDocumentLinks" WHERE "DocumentId" IN(SELECT "Id" FROM qa_docs);
DELETE FROM "StoredDocuments" WHERE "Id" IN(SELECT "Id" FROM qa_docs);
DELETE FROM "LogisticsAudits" WHERE "ShipmentId" IN(SELECT "Id" FROM qa_shipments);
DELETE FROM "CustomsClearances" WHERE "ShipmentId" IN(SELECT "Id" FROM qa_shipments);
DELETE FROM "Containers" WHERE "Id" IN(SELECT "Id" FROM qa_containers);
DELETE FROM "Shipments" WHERE "Id" IN(SELECT "Id" FROM qa_shipments);
DELETE FROM "OrderAudits" WHERE "OrderId" IN(SELECT "Id" FROM qa_orders);
DELETE FROM "OrderItems" WHERE "OrderId" IN(SELECT "Id" FROM qa_orders);
DELETE FROM "Orders" WHERE "Id" IN(SELECT "Id" FROM qa_orders);
DELETE FROM "CompanyAudits" WHERE "CompanyId" IN(
 SELECT c."Id" FROM "Companies" c WHERE c."Name" LIKE '__TAG__%'
 AND c."TenantId" IN(SELECT t."Id" FROM "Tenants" t WHERE t."Slug" IN('demo-a','demo-b')));
DELETE FROM "Companies" WHERE "Name" LIKE '__TAG__%' AND
 "TenantId" IN(SELECT "Id" FROM "Tenants" WHERE "Slug" IN('demo-a','demo-b'));
'@
    $sql=$sql.Replace('__TAG__',$tag).Replace('__DOC_IDS__',$docIn).Replace('__RULE_IDS__',$ruleIn).
      Replace('__DELETIONS__',$(if($Apply){$deletions.Replace('__TAG__',$tag)}else{''}))
    [IO.File]::WriteAllText($sqlFile,$sql,[Text.Encoding]::ASCII)
    try{
      $out=@(& $psql -h 127.0.0.1 -p 55432 -U wathiqa_import_dev -d wathiqa_import_dev -v ON_ERROR_STOP=1 -f $sqlFile)
      if($LASTEXITCODE -ne 0){throw "SQL fixture cleanup failed for $tag"}
      $out | Where-Object {$_ -match 'QA_MATCH|WP07_QA_|^DELETE '}|Write-Output
    } finally {Remove-Item $sqlFile -Force -ErrorAction SilentlyContinue}
    if($Apply){
      foreach($key in $fileKeys){
        if($key -cnotmatch '^[0-9a-f]{32}/[0-9a-f]{32}$'){throw "Unsafe generated storage key"}
        $parts=$key.Split('/')
        $full=Join-Path (Join-Path $storageRoot $parts[0]) $parts[1]
        if(Test-Path -LiteralPath $full -PathType Leaf){
          Remove-Item -LiteralPath $full -Force
          Write-Output 'QA_PRIVATE_BLOB_DELETED'
        }
      }
    }
}
Write-Output $(if($Apply){'WP07_QA_TARGETED_CLEANUP_APPLIED'}else{'WP07_QA_DRY_RUN_ONLY'})
