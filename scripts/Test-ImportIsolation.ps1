$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:5089'
$root = Split-Path $PSScriptRoot -Parent
$creds = @((Get-Content (Join-Path $root '.local/import-demo-accounts.json') -Raw -Encoding UTF8 | ConvertFrom-Json))
if ($creds.Count -eq 1 -and $creds[0] -is [array]) { $creds = $creds[0] }
if ($creds.Count -ne 2) { throw 'Expected two local demo admin accounts' }
$script:passed = 0
function Pass([string]$text) { $script:passed++; Write-Output ("PASS "+$text) }
function Json([object]$value) { return ($value | ConvertTo-Json -Compress -Depth 7) }
function Session { return New-Object Microsoft.PowerShell.Commands.WebRequestSession }
function Csrf($session) {
    $result = Invoke-RestMethod -Uri "$base/api/auth/csrf" -WebSession $session -UseBasicParsing -TimeoutSec 10
    return $result.token
}
function Post($path, $session, $csrf, $body) {
    return Invoke-RestMethod -Uri "$base$path" -Method Post -WebSession $session -ContentType 'application/json' -Headers @{'X-Wathiqa-CSRF'=$csrf} -Body (Json $body) -UseBasicParsing -TimeoutSec 15
}
function Put($path, $session, $csrf, $body) {
    return Invoke-RestMethod -Uri "$base$path" -Method Put -WebSession $session -ContentType 'application/json' -Headers @{'X-Wathiqa-CSRF'=$csrf} -Body (Json $body) -UseBasicParsing -TimeoutSec 15
}
function Get($path,$session) {
    return Invoke-RestMethod -Uri "$base$path" -WebSession $session -UseBasicParsing -TimeoutSec 15
}
function ExpectStatus([scriptblock]$operation,[int]$status,[string]$message) {
    $actual = 200
    try { $null = & $operation } catch {
        if ($_.Exception.Response) { $actual = [int]$_.Exception.Response.StatusCode }
        else { throw ("Unexpected transport error in "+$message+": "+$_.Exception.Message) }
    }
    if ($actual -ne $status) { throw ("Expected "+$status+" got "+$actual+" for "+$message) }
    Pass $message
}
$health = Get '/api/health' (Session)
if ($health.status -ne 'ok' -or $health.database -ne 'connected') { throw 'API unavailable' }
Pass 'New import API and database healthy'
ExpectStatus { Get '/api/companies' (Session) } 401 'Anonymous users cannot list companies'
$sessionA=Session
$csrfA=Csrf $sessionA
ExpectStatus {
    Invoke-RestMethod -Uri "$base/api/auth/login" -Method Post -WebSession $sessionA -ContentType 'application/json' -Body (Json @{ email=$creds[0].email; password=$creds[0].password }) -UseBasicParsing -TimeoutSec 12
} 400 'Login without CSRF token rejected'
$null=Post '/api/auth/login' $sessionA $csrfA @{email=$creds[0].email;password=$creds[0].password}
$csrfA=Csrf $sessionA
$meA=Get '/api/auth/me' $sessionA
if ($meA.slug -ne 'demo-a' -or $meA.role -ne 'Admin' -or !$meA.canManagePayments) { throw 'Tenant A identity incorrect' }
Pass 'Tenant A login identifies role and permissions'
$sessionB=Session
$csrfB=Csrf $sessionB
$null=Post '/api/auth/login' $sessionB $csrfB @{email=$creds[1].email;password=$creds[1].password}
$csrfB=Csrf $sessionB
$meB=Get '/api/auth/me' $sessionB
if ($meB.slug -ne 'demo-b' -or $meB.role -ne 'Admin' -or $meA.tenantId -eq $meB.tenantId) {throw 'Tenant B identity incorrect'}
Pass 'Tenant B has distinct authenticated tenant'
$companyA=Post '/api/companies' $sessionA $csrfA @{name='Tenant A Supplier QA';type='Supplier'}
if (-not $companyA.id) {throw 'Company A creation failed'}
Pass 'Tenant A creates own supplier'
$listA=@(Get '/api/companies' $sessionA)
if ($listA.Count -eq 0 -or !$(@($listA | Where-Object {$_.id -eq $companyA.id}).Count -eq 1)) {throw 'Tenant A does not see supplier'}
Pass 'Tenant A reads own company'
$listB=@(Get '/api/companies' $sessionB)
if (@($listB | Where-Object {$_.id -eq $companyA.id}).Count -ne 0) {throw 'Tenant B sees Tenant A data'}
Pass 'Tenant B list excludes Tenant A supplier'
ExpectStatus { Get ("/api/companies/"+$companyA.id) $sessionB } 404 'Cross-tenant company GET returns 404'
ExpectStatus { Put ("/api/companies/"+$companyA.id) $sessionB $csrfB @{name='Intrusion';type='Supplier'} } 404 'Cross-tenant company UPDATE returns 404'
ExpectStatus {
    Invoke-RestMethod -Uri "$base/api/companies/$($companyA.id)" -Method Delete -WebSession $sessionB -Headers @{'X-Wathiqa-CSRF'=$csrfB} -UseBasicParsing -TimeoutSec 12
} 404 'Cross-tenant company DELETE returns 404'
$companyB=Post '/api/companies' $sessionB $csrfB @{name='Tenant B Supplier QA';type='Supplier'}
ExpectStatus { Get ("/api/companies/"+$companyB.id) $sessionA } 404 'Tenant A cannot see Tenant B supplier'
$staffEmail = 'staff-qa-'+([Guid]::NewGuid().ToString('N').Substring(0,12))+'@wathiqa.invalid'
$staffPassword = 'Secure-Staff-Password-' + ([Guid]::NewGuid().ToString('N')) + 'Aa9!'
$invite=Post '/api/users/invitations' $sessionA $csrfA @{email=$staffEmail}
if (-not $invite.token) {throw 'Missing invitation token'}
Pass 'Admin creates time-bound invitation'
$acceptSession=Session
$acceptCsrf=Csrf $acceptSession
$created=Post '/api/auth/invitations/accept' $acceptSession $acceptCsrf @{token=$invite.token;displayName='Test Staff';password=$staffPassword}
if (-not $created.id) {throw 'Invite acceptance failed'}
Pass 'Staff accepts invitation with one-time token'
ExpectStatus { Post '/api/auth/invitations/accept' $acceptSession $acceptCsrf @{token=$invite.token;displayName='Test Staff';password=$staffPassword} } 400 'Invitation token cannot be reused'
$staffSession=Session
$staffCsrf=Csrf $staffSession
$null=Post '/api/auth/login' $staffSession $staffCsrf @{email=$staffEmail;password=$staffPassword}
$staffCsrf=Csrf $staffSession
$meStaff=Get '/api/auth/me' $staffSession
if($meStaff.role -ne 'Staff' -or $meStaff.canManagePayments -or $meStaff.tenantId -ne $meA.tenantId) {throw 'Staff rights wrong'}
Pass 'Staff can log in, but starts without payment permission'
$staffCompanies=@(Get '/api/companies' $staffSession)
if(@($staffCompanies | Where-Object {$_.id -eq $companyA.id}).Count -ne 1) {throw 'Staff cannot read own company'}
Pass 'Staff can read tenant company'
$staffOrders=Get '/api/orders' $staffSession
if($null -eq $staffOrders.items) {throw 'Staff cannot list purchase orders'}
Pass 'Ordinary Staff can read purchase order prices'
 $null=Get '/api/document-requirements' $staffSession
 Pass 'Ordinary Staff can read tenant document requirement rules'
 ExpectStatus {
     Put '/api/document-requirements' $staffSession $staffCsrf @{
         targetType='Container';stage='Any';documentType='BillOfLading';isRequired=$true
     }
 } 403 'Ordinary Staff cannot configure required document policy'
 ExpectStatus {
     Post ("/api/document-requirements/"+$companyA.id+"/waivers") $staffSession $staffCsrf @{
         orderId=$companyA.id;reason='This is a test-only waiver explanation.'
     }
 } 403 'Ordinary Staff cannot approve document waivers'
 ExpectStatus {
     Invoke-RestMethod -Uri "$base/api/document-waivers/$($companyA.id)" -Method Delete -WebSession $staffSession -Headers @{'X-Wathiqa-CSRF'=$staffCsrf} -UseBasicParsing -TimeoutSec 12
 } 403 'Ordinary Staff cannot revoke document waivers'
ExpectStatus { Post '/api/orders' $staffSession $staffCsrf @{} } 403 'Ordinary Staff cannot create a priced purchase order'
ExpectStatus { Put ("/api/orders/"+$companyA.id) $staffSession $staffCsrf @{} } 403 'Ordinary Staff cannot change order prices'
ExpectStatus {
    Invoke-RestMethod -Uri "$base/api/orders/$($companyA.id)?revision=1" -Method Delete -WebSession $staffSession -Headers @{'X-Wathiqa-CSRF'=$staffCsrf} -UseBasicParsing -TimeoutSec 12
} 403 'Ordinary Staff cannot delete a priced order'
ExpectStatus { Post '/api/_diagnostics/verify-payment-permission' $staffSession $staffCsrf @{} } 403 'Ordinary Staff cannot perform payment-authorized write'
ExpectStatus { Post '/api/_diagnostics/verify-payment-permission' $sessionA $csrfA @{} } 200 'Admin passes payment-write authorization' # 204 returns no content but Invoke-RestMethod returns null
$null=Put ("/api/users/"+$created.id+"/payment-permission") $sessionA $csrfA @{canManagePayments=$true}
$canNow=Get '/api/auth/me' $staffSession
if(-not $canNow.canManagePayments) {throw 'Grant not visible live'}
Pass 'Payment permission grant takes effect in existing session'
ExpectStatus { Post '/api/orders' $staffSession $staffCsrf @{} } 400 'Authorized Staff reaches order validation instead of permission denial'
ExpectStatus { Post '/api/_diagnostics/verify-payment-permission' $staffSession $staffCsrf @{} } 200 'Authorized Staff passes payment-write policy'
$null=Put ("/api/users/"+$created.id+"/payment-permission") $sessionA $csrfA @{canManagePayments=$false}
ExpectStatus { Post '/api/orders' $staffSession $staffCsrf @{} } 403 'Revoked Staff immediately loses order-price editing'
ExpectStatus { Post '/api/_diagnostics/verify-payment-permission' $staffSession $staffCsrf @{} } 403 'Revoking permission immediately blocks existing session'
ExpectStatus { Put ("/api/users/"+$created.id+"/payment-permission") $sessionB $csrfB @{canManagePayments=$true} } 404 'Other tenant cannot grant permissions'
$null=Put ("/api/users/"+$created.id+"/active") $sessionA $csrfA @{isActive=$false}
ExpectStatus { Get '/api/auth/me' $staffSession } 403 'Disabled Staff denied even with existing cookie'
ExpectStatus { Get '/api/users' $staffSession } 403 'Disabled Staff cannot enumerate users'
Write-Output ("TENANT_ISOLATION_PASS_COUNT="+$script:passed)
