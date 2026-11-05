$ErrorActionPreference = 'Stop'
$api = 'http://127.0.0.1:5088/api'
$root = Split-Path $PSScriptRoot -Parent
$local = Join-Path $root '.local'
New-Item -ItemType Directory -Force $local | Out-Null
$created = New-Object System.Collections.Generic.List[string]
function WriteEntry($zip, [string]$name, [string]$body) {
    $entry = $zip.CreateEntry($name)
    $stream = $entry.Open()
    try {
        $writer = New-Object System.IO.StreamWriter($stream, (New-Object System.Text.UTF8Encoding($false)))
        try { $writer.Write($body); $writer.Flush() } finally { $writer.Dispose() }
    } finally { $stream.Dispose() }
}
function GenerateDocx([string]$path) {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (Test-Path $path) { Remove-Item $path -Force }
    $zip = [System.IO.Compression.ZipFile]::Open($path, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        WriteEntry $zip '[Content_Types].xml' '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
        WriteEntry $zip '_rels/.rels' '<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
        WriteEntry $zip 'word/document.xml' '<?xml version="1.0" encoding="utf-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>PRICE TERM: CIF ISTANBUL</w:t></w:r></w:p><w:p><w:r><w:t>PAYMENT TERM: 20% TT</w:t></w:r></w:p><w:sectPr/></w:body></w:document>'
    } finally { $zip.Dispose() }
}
function GeneratePdf([string]$path) {
    $ascii = [System.Text.Encoding]::ASCII
    $streamText = "BT /F1 12 Tf 72 730 Td (PRICE TERM: CIF ISTANBUL) Tj 0 -25 Td (PAYMENT TERM: 20 PERCENT TT) Tj ET"
    $objects = @(
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        ("<< /Length " + $ascii.GetByteCount($streamText) + " >>`nstream`n" + $streamText + "`nendstream")
    )
    $content = "%PDF-1.4`n"
    $offsets = @(0)
    for ($i=0; $i -lt $objects.Length; $i++) {
        $offsets += $ascii.GetByteCount($content)
        $content += ($i+1).ToString() + " 0 obj`n" + $objects[$i] + "`nendobj`n"
    }
    $start = $ascii.GetByteCount($content)
    $content += "xref`n0 6`n0000000000 65535 f `n"
    for ($i=1; $i -le 5; $i++) { $content += $offsets[$i].ToString('D10') + " 00000 n `n" }
    $content += "trailer`n<< /Size 6 /Root 1 0 R >>`nstartxref`n" + $start + "`n%%EOF`n"
    [System.IO.File]::WriteAllBytes($path, $ascii.GetBytes($content))
}
try {
    $pdf = Join-Path $local 'smoke-contract.pdf'
    $docx = Join-Path $local 'smoke-contract.docx'
    GeneratePdf $pdf
    GenerateDocx $docx
    foreach ($fixture in @($pdf,$docx)) {
        $answer = & curl.exe -sS -X POST -F "file=@$fixture" "$api/templates/import" | ConvertFrom-Json
        if ($LASTEXITCODE -ne 0 -or !$answer.id) { throw "Import failed for $fixture : $(ConvertTo-Json $answer)" }
        $created.Add($answer.id)
        $template = Invoke-RestMethod "$api/templates/$($answer.id)"
        if (-not ($template.contentJson.Contains('PRICE TERM') -and $template.contentJson.Contains('[VALUE]'))) { throw "Header extraction missing for $fixture" }
        Write-Output ("PASS " + [IO.Path]::GetExtension($fixture).ToUpper() + " import, header detection and persisted content")
    }
    Write-Output "PASS COUNT: 2"
}
finally {
    foreach ($id in $created) { try { Invoke-RestMethod "$api/templates/$id" -Method DELETE | Out-Null } catch {} }
}
