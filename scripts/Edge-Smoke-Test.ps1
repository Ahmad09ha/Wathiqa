$ErrorActionPreference = "Stop"
$api = 'http://127.0.0.1:5088/api'
$local = Join-Path (Split-Path $PSScriptRoot -Parent) '.local'
$createdTemplate = $null; $createdDoc = $null
$passed = 0
function Assert($value, [string]$label) {
    if (-not $value) { throw "FAIL: $label" }
    $script:passed++
    Write-Output "PASS: $label"
}
function Status([scriptblock]$call) {
    try { & $call | Out-Null; return 200 }
    catch { if($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }; throw }
}
function Json($value) { ConvertTo-Json -InputObject $value -Depth 30 -Compress }
try {
    $badExtension = Join-Path $local 'invalid.txt'
    [IO.File]::WriteAllText($badExtension,'Not a document')
    $response = & curl.exe -sS -w '%{http_code}' -o NUL -F "file=@$badExtension" "$api/templates/import"
    Assert ($response -eq '400') 'Unsupported extension rejected'
    $badPdf = Join-Path $local 'corrupt.pdf'
    [IO.File]::WriteAllText($badPdf,'This is not a PDF')
    $response = & curl.exe -sS -w '%{http_code}' -o NUL -F "file=@$badPdf" "$api/templates/import"
    Assert ($response -eq '400') 'Corrupt PDF rejected'
    $emptyDocx = Join-Path $local 'empty.docx'
    [IO.File]::WriteAllBytes($emptyDocx, [byte[]]@())
    $response = & curl.exe -sS -w '%{http_code}' -o NUL -F "file=@$emptyDocx" "$api/templates/import"
    Assert ($response -eq '400') 'Empty document rejected'
    $tooLarge = Join-Path $local 'oversized.pdf'
    $stream=[IO.File]::OpenWrite($tooLarge)
    try {$stream.SetLength(10010000)} finally {$stream.Dispose()}
    $response = & curl.exe -sS -w '%{http_code}' -o NUL -F "file=@$tooLarge" "$api/templates/import"
    Assert ($response -eq '400') 'Oversized document rejected'
    $status = Status { Invoke-RestMethod "$api/templates" -Method POST -ContentType 'application/json' -Body (Json @{name='   '}) }
    Assert ($status -eq 400) 'Blank template name rejected'
    $badJson = @{name='Bad data';content=@{type='not-a-doc';content=@()}}
    $status = Status { Invoke-RestMethod "$api/templates" -Method POST -ContentType 'application/json' -Body (Json $badJson) }
    Assert ($status -eq 400) 'Invalid document schema rejected'
    $createdTemplate = Invoke-RestMethod "$api/templates" -Method POST -ContentType 'application/json' -Body (Json @{name='Deletion test'})
    $createdDoc = Invoke-RestMethod "$api/documents" -Method POST -ContentType 'application/json' -Body (Json @{templateId=$createdTemplate.id;name='Retained copy'})
    Invoke-RestMethod "$api/templates/$($createdTemplate.id)" -Method DELETE | Out-Null
    $createdTemplate = $null
    $retained = Invoke-RestMethod "$api/documents/$($createdDoc.id)"
    Assert ($null -eq $retained.templateId -and $retained.name -eq 'Retained copy') 'Deleting a template retains independent documents'
    $file = Join-Path $local 'retained-copy.xlsx'
    Invoke-WebRequest "$api/documents/$($createdDoc.id)/export/xlsx" -UseBasicParsing -OutFile $file
    Assert ((Test-Path $file) -and (Get-Item $file).Length -gt 1800) 'Document still exports after template deletion'
    Invoke-RestMethod "$api/documents/$($createdDoc.id)" -Method DELETE | Out-Null
    $createdDoc=$null
    Write-Output "EDGE TESTS: $passed/8"
}
finally {
    if($createdDoc){try{Invoke-RestMethod "$api/documents/$($createdDoc.id)" -Method DELETE | Out-Null}catch{}}
    if($createdTemplate){try{Invoke-RestMethod "$api/templates/$($createdTemplate.id)" -Method DELETE | Out-Null}catch{}}
    Remove-Item (Join-Path $local 'oversized.pdf') -ErrorAction SilentlyContinue
}
