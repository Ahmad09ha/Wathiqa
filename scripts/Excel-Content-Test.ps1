$ErrorActionPreference = 'Stop'
$api='http://127.0.0.1:5088/api'
$local=Join-Path (Split-Path $PSScriptRoot -Parent) '.local'
$all = Invoke-RestMethod "$api/templates"
$t = $all | Where-Object { $_.sourceFormat -eq 'starter' } | Select-Object -First 1
if (-not $t) { throw 'No starter template available for workbook content verification' }
$target=Join-Path $local 'template-content-qa.xlsx'
Invoke-WebRequest "$api/templates/$($t.id)/export/xlsx" -UseBasicParsing -OutFile $target
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[System.IO.Compression.ZipFile]::OpenRead($target)
try {
    $shared=$zip.GetEntry('xl/sharedStrings.xml')
    $sheet=$zip.GetEntry('xl/worksheets/sheet1.xml')
    if (-not $shared -or -not $sheet) { throw 'Workbook missing required XML parts' }
    $reader=New-Object IO.StreamReader($shared.Open())
    try {$text=$reader.ReadToEnd()} finally {$reader.Dispose()}
    $reader=New-Object IO.StreamReader($sheet.Open())
    try {$xml=$reader.ReadToEnd()} finally {$reader.Dispose()}
    if (-not $text.Contains('PRICE TERM')) { throw 'Price Term label missing from Excel content' }
    Write-Output 'PASS Excel export retains contract term text'
    if (-not $text.Contains('销售合同') -and -not $text.Contains('付款方式')) {throw 'Chinese contract labels missing'}
    Write-Output 'PASS Excel export retains Chinese Unicode text'
    if ($xml -notmatch '<(?:\w+:)?c\s+r="F\d+"') {throw 'Sixth table column not exported as spreadsheet column F'}
    Write-Output 'PASS Excel export retains table columns'
    Write-Output 'CONTENT TESTS: 3/3'
}finally {$zip.Dispose()}
