$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$local=Join-Path $root '.local'
$chrome='C:\Program Files\Google\Chrome\Application\chrome.exe'
$source=Join-Path $PSScriptRoot 'fixtures\Bilingual-Contract.html'
$pdf=Join-Path $local 'bilingual-contract.pdf'
$profile=Join-Path $local 'print-fixture-profile'
if(Test-Path $pdf){Remove-Item $pdf -Force}
$url=([System.Uri]$source).AbsoluteUri
$printed=Start-Process -FilePath $chrome -ArgumentList @('--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',"--user-data-dir=$profile","--print-to-pdf=$pdf",'--no-pdf-header-footer',$url) -Wait -PassThru -RedirectStandardError (Join-Path $local 'pdf-print-error.log') -RedirectStandardOutput (Join-Path $local 'pdf-print-out.log')
if(-not (Test-Path $pdf)){throw 'Failed to generate bilingual PDF fixture'}
$info=Get-Item $pdf
if($info.Length -lt 1000){throw 'Generated bilingual PDF empty'}
$id=$null
try {
    $r = (& curl.exe -sS -X POST -F "file=@$pdf" 'http://127.0.0.1:5088/api/templates/import') | ConvertFrom-Json
    if($LASTEXITCODE -ne 0 -or !$r.id){throw ('Unable to import bilingual PDF: '+($r|ConvertTo-Json))}
    $id=$r.id
    $template=Invoke-RestMethod "http://127.0.0.1:5088/api/templates/$id"
    if(-not $template.contentJson.Contains('PRICE TERM')){throw 'English price term missing'}
    Write-Output 'PASS Bilingual PDF preserves English field label'
    if(-not $template.contentJson.Contains('付款方式')){throw 'Chinese payment label missing'}
    Write-Output 'PASS Bilingual PDF preserves Chinese field label'
    if($template.contentJson.Contains('CIF ISKENDERUN')){throw 'Filled price value leaked into field-only template'}
    Write-Output 'PASS PDF import strips sample field values'
    Write-Output 'BILINGUAL CONTENT TESTS: 3/3'
}finally {
    if($id){try{Invoke-RestMethod "http://127.0.0.1:5088/api/templates/$id" -Method DELETE | Out-Null}catch{}}
}
