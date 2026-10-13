$ErrorActionPreference='Stop'
$version='v24.18.0'
$asset="node-$version-win-x64.zip"
$base="https://nodejs.org/dist/$version"
$cacheDir=Join-Path ([IO.Path]::GetTempPath()) ('harmony-runtime-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $cacheDir | Out-Null
$archivePath=Join-Path $cacheDir $asset
Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile $archivePath
$checks=(Invoke-WebRequest -UseBasicParsing -Uri "$base/SHASUMS256.txt").Content
$expected=($checks -split '\r?\n' | Where-Object { $_.EndsWith("  $asset") }).Split(' ')[0]
$actual=(Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
if (!$expected -or $actual -ne $expected) { throw 'SHA256 mismatch.' }
Expand-Archive -LiteralPath $archivePath -DestinationPath $cacheDir
$runtimeDir=Join-Path $PSScriptRoot 'runtime'
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $cacheDir "node-$version-win-x64\node.exe") -Destination (Join-Path $runtimeDir 'node.exe') -Force
Write-Output 'Node runtime is ready.'
