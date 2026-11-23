$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$raw = Get-Content (Join-Path $root '.local/import-demo-accounts.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$accounts = @($raw)
if ($accounts.Count -eq 1 -and $accounts[0] -is [array]) {$accounts = $accounts[0]}
$account = $accounts | Where-Object {$_.slug -eq 'demo-a'} | Select-Object -First 1
if(-not $account){throw 'Missing demo account'}
$base='http://localhost:3000/import-api'
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$csrf = (Invoke-RestMethod "$base/api/auth/csrf" -WebSession $session -UseBasicParsing -TimeoutSec 8).token
$null=Invoke-RestMethod "$base/api/auth/login" -Method Post -WebSession $session -UseBasicParsing -ContentType 'application/json' -Headers @{'X-Wathiqa-CSRF'=$csrf} -Body (@{email=$account.email;password=$account.password}|ConvertTo-Json -Compress) -TimeoutSec 10
$csrf = (Invoke-RestMethod "$base/api/auth/csrf" -WebSession $session -UseBasicParsing -TimeoutSec 8).token
$me = Invoke-RestMethod "$base/api/auth/me" -WebSession $session -UseBasicParsing -TimeoutSec 8
if($me.slug -ne 'demo-a' -or $me.role -ne 'Admin'){throw 'Same-origin session was not authenticated'}
Write-Output 'PASS Browser-origin Next.js rewrite forwards authenticated cookie'
$data = Invoke-RestMethod "$base/api/companies" -WebSession $session -UseBasicParsing -TimeoutSec 8
Write-Output ('PASS Browser-origin merchant-scoped company request (count='+@($data).Count+')')
$null = Invoke-RestMethod "$base/api/auth/logout" -Method Post -WebSession $session -UseBasicParsing -Headers @{'X-Wathiqa-CSRF'=$csrf} -TimeoutSec 8
try {
    $null=Invoke-RestMethod "$base/api/auth/me" -WebSession $session -UseBasicParsing -TimeoutSec 8
    throw 'Logout did not invalidate cookie'
} catch {
    if(-not $_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 401) {throw}
    Write-Output 'PASS Logout invalidates session cookie'
}
Write-Output 'WEB_PROXY_AUTH_PASS_COUNT=3'
