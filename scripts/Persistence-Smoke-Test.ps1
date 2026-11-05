$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$api = 'http://127.0.0.1:5088/api'
$id = $null
try {
    $template = (Invoke-RestMethod "$api/templates")[0]
    $created = Invoke-RestMethod "$api/documents" -Method POST -ContentType 'application/json' -Body (ConvertTo-Json @{templateId=$template.id;name='Persistence smoke copy'} -Compress)
    $id = $created.id
    $content = @{type='doc';content=@(@{type='paragraph';content=@(@{type='text';text='PERSISTENCE VERIFIED'})})}
    $body = ConvertTo-Json @{name='Persistence smoke copy';content=$content;expectedRevision=1} -Depth 15 -Compress
    $saved = Invoke-RestMethod "$api/documents/$id" -Method PUT -ContentType 'application/json' -Body $body
    if ($saved.revision -ne 2) { throw 'Initial save failed' }
    $pidPath = Join-Path $root '.local/api.pid'
    $pidValue = [int](Get-Content $pidPath -Raw)
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $pidValue"
    if (-not $process -or $process.CommandLine -notlike '*Wathiqa.Api.dll*') { throw 'Unexpected process; refusing restart' }
    Stop-Process -Id $pidValue -Force
    for($i=0; $i -lt 30; $i++) {
        if (-not (Get-NetTCPConnection -LocalPort 5088 -State Listen -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 250
    }
    & (Join-Path $PSScriptRoot 'Start-Backend.ps1')
    $ready = $false
    for($i=0; $i -lt 80; $i++) {
        try { if ((Invoke-RestMethod "$api/health" -TimeoutSec 2).status -eq 'ok') {$ready=$true;break} }catch{}
        Start-Sleep -Milliseconds 250
    }
    if(-not $ready){throw 'Backend did not return after restart'}
    $after = Invoke-RestMethod "$api/documents/$id"
    if($after.revision -ne 2 -or -not $after.contentJson.Contains('PERSISTENCE VERIFIED')){throw 'Persistence failed across backend restart'}
    Write-Output 'PASS Database content survives API process restart and remains editable'
    Write-Output 'PASS COUNT: 1'
}
finally {
    if($id){try{Invoke-RestMethod "$api/documents/$id" -Method DELETE | Out-Null}catch{}}
}
