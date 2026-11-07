# WP-00: verified snapshot of the PREVIOUS template/document product.
# Does NOT migrate, overwrite or drop the original database.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$local = Join-Path $root '.local'
$bin = 'C:\Program Files\PostgreSQL\18\bin'
$sourceDatabase = (Get-Content (Join-Path $local 'db-name.txt') -Raw).Trim()
$sourceUser = (Get-Content (Join-Path $local 'db-role.txt') -Raw).Trim()
if ($sourceDatabase -notin @('hussam_templates','wathiqa_docs')) { throw 'Unexpected source database: refusing archive' }
$env:PGPASSFILE = Join-Path $local 'pgpass.conf'
$archiveDir = Join-Path $local 'backups'
New-Item -ItemType Directory -Force -Path $archiveDir | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$archive = Join-Path $archiveDir "legacy-editor-$stamp.dump"
$pgDump = Join-Path $bin 'pg_dump.exe'
$pgRestore = Join-Path $bin 'pg_restore.exe'
$psql = Join-Path $bin 'psql.exe'
$createdb = Join-Path $bin 'createdb.exe'
$dropdb = Join-Path $bin 'dropdb.exe'
$hostName = '127.0.0.1'
$port = '55432'
function RunChecked([string]$executable, [string[]]$arguments, [string]$errorMessage) {
    & $executable @arguments
    if ($LASTEXITCODE -ne 0) { throw $errorMessage }
}
$sourceTables = @(& $psql -h $hostName -p $port -U $sourceUser -d $sourceDatabase -t -A -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('Templates','Documents')")
if ($LASTEXITCODE -ne 0 -or @($sourceTables).Count -lt 2) { throw 'Legacy tables missing; refusing to make an invalid archive' }
$countsSql = Join-Path $local 'legacy-counts.sql'
[IO.File]::WriteAllText($countsSql, 'SELECT (SELECT COUNT(*) FROM "Templates"), (SELECT COUNT(*) FROM "Documents");', [Text.Encoding]::ASCII)
$originalCounts = @(& $psql -h $hostName -p $port -U $sourceUser -d $sourceDatabase -t -A -f $countsSql)
if ($LASTEXITCODE -ne 0) { throw 'Cannot read original row counts' }
RunChecked $pgDump @('-h',$hostName,'-p',$port,'-U',$sourceUser,'-d',$sourceDatabase,'-Fc','-f',$archive) 'pg_dump failed'
$contents = @(& $pgRestore -l $archive)
$archiveListing = $contents -join [Environment]::NewLine
if ($LASTEXITCODE -ne 0 -or $archiveListing -notmatch 'TABLE DATA.*Templates' -or $archiveListing -notmatch 'TABLE DATA.*Documents') {
    throw 'pg_restore list validation failed; DO NOT delete original data'
}
# Test RESTORE into a disposable DB, not the original database.
$verifyDatabase = "wathiqa_legacy_verify_$stamp"
try {
    RunChecked $createdb @('-h',$hostName,'-p',$port,'-U',$sourceUser,$verifyDatabase) 'Temporary verification database creation failed'
    RunChecked $pgRestore @('-h',$hostName,'-p',$port,'-U',$sourceUser,'-d',$verifyDatabase,'--no-owner','--no-acl',$archive) 'Legacy restore rehearsal failed'
    $restoredCounts = @(& $psql -h $hostName -p $port -U $sourceUser -d $verifyDatabase -t -A -f $countsSql)
    if ($LASTEXITCODE -ne 0 -or (($originalCounts | Out-String).Trim() -ne ($restoredCounts | Out-String).Trim())) {
        throw 'Restored row counts differ from original'
    }
} finally {
    & $dropdb -h $hostName -p $port -U $sourceUser --if-exists $verifyDatabase
    if ($LASTEXITCODE -ne 0) { Write-Warning "Manual cleanup needed: $verifyDatabase" }
}
$hash = (Get-FileHash $archive -Algorithm SHA256).Hash
$metadata = [ordered]@{
    Product = 'Previous Wathiqa Template/Document Editor'
    Database = $sourceDatabase
    CreatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    FileName = (Split-Path $archive -Leaf)
    Bytes = (Get-Item $archive).Length
    SHA256 = $hash
    VerifiedRestore = $true
    TemplatesAndDocuments = ($originalCounts | Out-String).Trim()
}
$manifest = $archive + '.manifest.json'
$metadata | ConvertTo-Json | Set-Content -Path $manifest -Encoding UTF8
Write-Output ('LEGACY_ARCHIVE_VERIFIED='+$archive)
Write-Output ('SHA256='+$hash)
Write-Output ('RESTORED_COUNTS='+$metadata.TemplatesAndDocuments)
