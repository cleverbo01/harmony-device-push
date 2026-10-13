param([switch]$Test)
$ErrorActionPreference = 'Stop'
$projectDir = $PSScriptRoot
$sourceName = [string]::Concat([char]0x684c,[char]0x9762,[char]0x7a0b,[char]0x5e8f,'.cs')
$outputName = [string]::Concat([char]0x9e3f,[char]0x8499,[char]0x8bbe,[char]0x5907,[char]0x4fe1,[char]0x606f,[char]0x63a8,[char]0x9001,[char]0x5de5,[char]0x5177,'.exe')
$compilerPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $compilerPath)) { throw 'Install .NET Framework 4.x build tools.' }
$buildDir = Join-Path ([IO.Path]::GetTempPath()) ('harmony-build-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $buildDir | Out-Null
Copy-Item -LiteralPath (Join-Path $projectDir $sourceName) -Destination (Join-Path $buildDir 'desktop.cs')
Push-Location $buildDir
try {
    & $compilerPath /nologo /target:winexe /optimize+ /out:desktop.exe /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Management.dll /reference:System.Web.Extensions.dll desktop.cs
    if ($LASTEXITCODE -ne 0) { throw 'Compilation failed.' }
} finally { Pop-Location }
$outputPath = Join-Path $projectDir $outputName
if (Test-Path -LiteralPath $outputPath) { Copy-Item -LiteralPath $outputPath -Destination ($outputPath + '.bak-' + (Get-Date -Format 'yyyyMMddHHmmssfff')) }
Copy-Item -LiteralPath (Join-Path $buildDir 'desktop.exe') -Destination $outputPath -Force
Write-Output ('Built: ' + $outputPath)
if ($Test) {
    $nodeFile = Join-Path $projectDir 'runtime\node.exe'
    if (!(Test-Path -LiteralPath $nodeFile)) { $nodeFile = (Get-Command node.exe -ErrorAction Stop).Source }
    & $nodeFile --test (Join-Path $projectDir 'tests.mjs') (Join-Path $projectDir 'integration.test.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
}
Write-Output ('Temporary compiler files: ' + $buildDir)
