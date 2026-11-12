# Targeted invitation journey QA cleanup. Does NOT affect real tenants.
# Default: dry-run. Run with -Apply only after reviewing counts.
param([switch]$Apply)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$local=Join-Path $root '.local'
$marker=Join-Path $local 'invitation-qa-current.txt'
if(-not (Test-Path $marker)){throw 'No local invitation QA marker found'}
$email=[IO.File]::ReadAllText($marker).Trim()
if($email -cnotmatch '^invite-qa-[0-9a-f]{12}@wathiqa\.invalid$'){
    throw 'Refusing non-QA invitation email'
}
$psql='C:\Program Files\PostgreSQL\18\bin\psql.exe'
$env:PGPASSFILE=Join-Path $local 'import-pgpass.conf'
$sqlFile=Join-Path $local 'invitation-qa-cleanup.sql'
$sql=@'
BEGIN;
DO $guard$
BEGIN
  IF current_database()<>'wathiqa_import_dev' THEN
    RAISE EXCEPTION 'QA cleanup only allowed in isolated import dev DB';
  END IF;
END $guard$;
CREATE TEMP TABLE qa_invite_users ON COMMIT DROP AS
 SELECT u."Id" FROM "AspNetUsers" u JOIN "Tenants" t ON t."Id"=u."TenantId"
 WHERE u."Email"='__EMAIL__' AND t."Slug"='demo-a';
DO $check$
BEGIN
  IF EXISTS(
    SELECT 1 FROM "AspNetUserRoles" ur JOIN "AspNetRoles" role ON role."Id"=ur."RoleId"
    WHERE ur."UserId" IN(SELECT "Id" FROM qa_invite_users)
      AND role."NormalizedName"='ADMIN'
  ) THEN RAISE EXCEPTION 'Refusing deletion of admin'; END IF;
END $check$;
SELECT 'QA_USER_MATCH', (SELECT count(*) FROM qa_invite_users);
SELECT 'QA_INVITE_MATCH', count(*) FROM "TenantInvitations" i
 WHERE i."Email"='__EMAIL__' AND i."TenantId" IN
 (SELECT "Id" FROM "Tenants" WHERE "Slug"='demo-a');
__DELETIONS__
COMMIT;
'@
$deletions=@'
DELETE FROM "AspNetUserTokens" WHERE "UserId" IN(SELECT "Id" FROM qa_invite_users);
DELETE FROM "AspNetUserLogins" WHERE "UserId" IN(SELECT "Id" FROM qa_invite_users);
DELETE FROM "AspNetUserClaims" WHERE "UserId" IN(SELECT "Id" FROM qa_invite_users);
DELETE FROM "AspNetUserRoles" WHERE "UserId" IN(SELECT "Id" FROM qa_invite_users);
DELETE FROM "AspNetUsers" WHERE "Id" IN(SELECT "Id" FROM qa_invite_users);
DELETE FROM "TenantInvitations" WHERE "Email"='__EMAIL__'
 AND "TenantId" IN(SELECT "Id" FROM "Tenants" WHERE "Slug"='demo-a');
'@
$sql=$sql.Replace('__DELETIONS__', $(if($Apply){$deletions}else{''})).Replace('__EMAIL__',$email)
[IO.File]::WriteAllText($sqlFile,$sql,[Text.Encoding]::ASCII)
try {
 $out=& $psql -h 127.0.0.1 -p 55432 -U wathiqa_import_dev -d wathiqa_import_dev -v ON_ERROR_STOP=1 -f $sqlFile
 if($LASTEXITCODE -ne 0){throw 'QA cleanup failed'}
 $out | Where-Object {$_ -match 'QA_USER_MATCH|QA_INVITE_MATCH|DELETE '} | Write-Output
}
finally {Remove-Item -LiteralPath $sqlFile -Force -ErrorAction SilentlyContinue}
Write-Output $(if($Apply){'INVITATION_QA_CLEANUP_APPLIED'}else{'INVITATION_QA_DRY_RUN'})
