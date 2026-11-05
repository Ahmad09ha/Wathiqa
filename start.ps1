$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not (Test-Path (Join-Path $root 'backend/Wathiqa.Api/bin/Debug/net9.0/Wathiqa.Api.dll'))) {
    throw 'Backend not built. Run: dotnet build backend/Wathiqa.Api/Wathiqa.Api.csproj'
}
if (-not (Test-Path (Join-Path $root 'frontend/.next/BUILD_ID'))) {
    throw 'Frontend not built. Run: cd frontend; npm install; npm run build'
}
& (Join-Path $root 'scripts/Start-Backend.ps1')
& (Join-Path $root 'scripts/Start-Web.ps1')
foreach ($endpoint in @('http://127.0.0.1:5088/api/health','http://127.0.0.1:3000/')) {
    $ready = $false
    for ($attempt=0; $attempt -lt 40; $attempt++) {
        try {
            $response = Invoke-WebRequest $endpoint -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) { $ready = $true; break }
        }
        catch { }
        Start-Sleep -Milliseconds 350
    }
    if (-not $ready) { throw "Service did not become healthy: $endpoint. Check .local logs." }
}
Write-Host 'Wathiqa is available at http://localhost:3000' -ForegroundColor Green
Write-Host 'API health: http://127.0.0.1:5088/api/health' -ForegroundColor Cyan
