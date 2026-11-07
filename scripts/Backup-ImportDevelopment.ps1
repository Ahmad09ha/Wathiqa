# Non-destructive checkpoint before altering the local Import development DB.
# Never connects to / overwrites the legacy editor or a remote database.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$local=Join-Path $root '.local'
$archiveDir=Join-Path $local 'backups'
$dump='C:\Program Files\PostgreSQL\18\bin\pg_dump.exe'
$restore='C:\Program Files\PostgreSQL\18\bin\pg_restore.exe'
$psql='C:\Program Files\PostgreSQL\18\bin\psql.exe'
if(-not(Test-Path (Join-Path $local 'import-pgpass.conf'))){throw 'Local import DB credentials not initialized'}
foreach($tool in @($dump,$restore,$psql)){if(-not(Test-Path $tool)){throw 'Local PostgreSQL 18 tool missing'}}
$env:PGPASSFILE=Join-Path $local 'import-pgpass.conf'
$database='wathiqa_import_dev'
$account='wathiqa_import_dev'
$actual=@(& $psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55432 -U $account -d $database -t -A -c 'SELECT current_database();')
if($LASTEXITCODE -ne 0 -or $actual.Count -ne 1 -or $actual[0] -ne $database){
 throw 'Refusing backup because the connected database is not the local Import development DB'
}
New-Item -ItemType Directory -Force $archiveDir|Out-Null
$filename='import-dev-'+(Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')+'.dump'
$path=Join-Path $archiveDir $filename
& $dump -h 127.0.0.1 -p 55432 -U $account -d $database -Fc --no-owner --no-acl -f $path
if($LASTEXITCODE -ne 0 -or -not(Test-Path $path) -or (Get-Item $path).Length -lt 1024){
 throw 'Local import checkpoint creation failed'
}
$tableList=@(& $restore --list $path)
if($LASTEXITCODE -ne 0 -or ($tableList -join "`n") -notmatch 'TABLE DATA.*Companies'){
 throw 'Import checkpoint could not verify the Companies table'
}
Write-Output ('LOCAL_IMPORT_CHECKPOINT='+$path)
Write-Output ('SHA256='+(Get-FileHash $path -Algorithm SHA256).Hash)
