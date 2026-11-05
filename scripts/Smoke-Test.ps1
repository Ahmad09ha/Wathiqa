$ErrorActionPreference = "Stop"
$api = "http://127.0.0.1:5088/api"
$root = Split-Path $PSScriptRoot -Parent
$local = Join-Path $root ".local"
$results = New-Object System.Collections.Generic.List[string]
$createdTemplate = $null
$createdDocument = $null
$importedTemplate = $null
function Check($condition, [string]$description) {
    if (-not $condition) { throw "FAIL: $description" }
    $script:results.Add("PASS $description")
}
function ToJson($obj) { return ConvertTo-Json -InputObject $obj -Depth 30 -Compress }
try {
    $health = Invoke-RestMethod "$api/health"
    Check ($health.status -eq "ok") "API health"
    $templates = Invoke-RestMethod "$api/templates"
    Check (@($templates).Count -ge 2) "Seed templates available"
    $createdTemplate = Invoke-RestMethod "$api/templates" -Method POST -ContentType "application/json" -Body (ToJson @{name="Smoke Test Template";description="Temporary end-to-end fixture"})
    Check (![string]::IsNullOrWhiteSpace($createdTemplate.id)) "Create blank template"
    $sourceDoc = @{
        type = "doc"
        content = @(
            @{type="paragraph";content=@(@{type="text";text="PRICE TERM: CIF ISTANBUL"})},
            @{type="table";content=@(
                @{type="tableRow";content=@(
                    @{type="tableHeader";content=@(@{type="paragraph";content=@(@{type="text";text="NO."})})},
                    @{type="tableHeader";content=@(@{type="paragraph";content=@(@{type="text";text="AMOUNT"})})}
                )},
                @{type="tableRow";content=@(
                    @{type="tableCell";content=@(@{type="paragraph";content=@(@{type="text";text="1"})})},
                    @{type="tableCell";content=@(@{type="paragraph";content=@(@{type="text";text="1000 USD"})})}
                )}
            )}
        )
    }
    Invoke-RestMethod "$api/templates/$($createdTemplate.id)" -Method PUT -ContentType "application/json" -Body (ToJson @{name="Smoke Test Template";content=$sourceDoc}) | Out-Null
    $template = Invoke-RestMethod "$api/templates/$($createdTemplate.id)"
    Check ($template.contentJson.Contains("CIF ISTANBUL")) "Edit and reload template"
    $createdDocument = Invoke-RestMethod "$api/documents" -Method POST -ContentType "application/json" -Body (ToJson @{templateId=$createdTemplate.id;name="Independent Copy"})
    $copy = Invoke-RestMethod "$api/documents/$($createdDocument.id)"
    Check (($copy.revision -eq 1) -and $copy.contentJson.Contains("CIF ISTANBUL")) "Create independent document from template"
    $changed = @{
        type="doc"
        content=@(
            @{type="paragraph";content=@(@{type="text";text="PRICE TERM: FOB MERSIN"})},
            $sourceDoc.content[1]
        )
    }
    $saved = Invoke-RestMethod "$api/documents/$($createdDocument.id)" -Method PUT -ContentType "application/json" -Body (ToJson @{name="Independent Copy Updated";content=$changed;expectedRevision=1})
    Check ($saved.revision -eq 2) "Save document and increment revision"
    $docRead = Invoke-RestMethod "$api/documents/$($createdDocument.id)"
    $templateAfter = Invoke-RestMethod "$api/templates/$($createdTemplate.id)"
    Check ($docRead.contentJson.Contains("FOB MERSIN") -and $templateAfter.contentJson.Contains("CIF ISTANBUL")) "Document edits do not alter template"
    $conflict = $false
    try { Invoke-RestMethod "$api/documents/$($createdDocument.id)" -Method PUT -ContentType "application/json" -Body (ToJson @{name="Stale save";content=$changed;expectedRevision=1}) | Out-Null }
    catch { if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 409) { $conflict = $true } else { throw } }
    Check $conflict "Stale save rejected with HTTP 409"
    $xlsx = Join-Path $local "smoke-export.xlsx"
    Invoke-WebRequest "$api/documents/$($createdDocument.id)/export/xlsx" -UseBasicParsing -OutFile $xlsx
    $bytes = [System.IO.File]::ReadAllBytes($xlsx)
    Check (($bytes.Length -gt 2000) -and $bytes[0] -eq 80 -and $bytes[1] -eq 75) "Export valid XLSX ZIP envelope"
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($xlsx)
    try { Check ($null -ne $zip.GetEntry("xl/worksheets/sheet1.xml")) "XLSX contains worksheet data" }
    finally { $zip.Dispose() }
    $upload = & curl.exe -sS -X POST -F "file=@$xlsx" "$api/templates/import" | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw "File upload failed" }
    $importedTemplate = $upload
    Check (![string]::IsNullOrWhiteSpace($upload.id)) "Reimport exported XLSX as template"
    $imported = Invoke-RestMethod "$api/templates/$($upload.id)"
    Check ($imported.contentJson.Length -gt 50) "Imported template is editable JSON"
    Invoke-RestMethod "$api/documents/$($createdDocument.id)" -Method DELETE | Out-Null
    $createdDocument = $null
    Invoke-RestMethod "$api/templates/$($createdTemplate.id)" -Method DELETE | Out-Null
    $createdTemplate = $null
    Invoke-RestMethod "$api/templates/$($importedTemplate.id)" -Method DELETE | Out-Null
    $importedTemplate = $null
    Check $true "Cleanup test records"
    Write-Output $results
    Write-Output ("PASS COUNT: " + $results.Count)
}
finally {
    if ($createdDocument) { try { Invoke-RestMethod "$api/documents/$($createdDocument.id)" -Method DELETE | Out-Null } catch {} }
    if ($createdTemplate) { try { Invoke-RestMethod "$api/templates/$($createdTemplate.id)" -Method DELETE | Out-Null } catch {} }
    if ($importedTemplate) { try { Invoke-RestMethod "$api/templates/$($importedTemplate.id)" -Method DELETE | Out-Null } catch {} }
}
