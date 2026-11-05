$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location $root
$cases=@(
    @{ Name='API lifecycle'; File='Smoke-Test.ps1'; Count=13; Runtime='powershell' },
    @{ Name='PDF and Word imports'; File='Import-Smoke-Test.ps1'; Count=2; Runtime='powershell' },
    @{ Name='Negative/edge cases'; File='Edge-Smoke-Test.ps1'; Count=8; Runtime='powershell' },
    @{ Name='Excel content and Chinese text'; File='Excel-Content-Test.ps1'; Count=3; Runtime='powershell' },
    @{ Name='Bilingual PDF'; File='Bilingual-Pdf-Test.ps1'; Count=3; Runtime='powershell' },
    @{ Name='Chrome editor workflow'; File='Browser-Smoke-Test.mjs'; Count=9; Runtime='node' },
    @{ Name='Chrome advanced workflow'; File='Browser-Advanced-Test.mjs'; Count=8; Runtime='node' },
    @{ Name='Arabic RTL and Wathiqa branding browser UX'; File='Browser-Arabic-UX-Test.mjs'; Count=16; Runtime='node' },
    @{ Name='Saved data survives API restart'; File='Persistence-Smoke-Test.ps1'; Count=1; Runtime='powershell' }
)
Write-Output 'Running Wathiqa local smoke suite. Temporary records are cleaned after each test.'
Write-Output 'Note: The persistence check intentionally restarts the local API.'
$passed=0
foreach($case in $cases){
    Write-Output ('--- '+$case.Name+' ---')
    $script=Join-Path $PSScriptRoot $case.File
    if($case.Runtime -eq 'node'){ & node.exe $script }
    else { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script }
    if($LASTEXITCODE -ne 0){ throw ('FAILED '+$case.Name+' (exit code '+$LASTEXITCODE+')') }
    $passed += $case.Count
}
Write-Output ('WATHIQA PASSED '+$passed+'/'+$passed+' LOCAL SMOKE CHECKS')
