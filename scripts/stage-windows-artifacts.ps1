$ErrorActionPreference = "Stop"

$makeRoot = Join-Path $PWD "out\make"
$outRoot = Join-Path $PWD "out"
$artifactRoot = Join-Path $PWD "out\artifacts\windows-package"

function Write-ForgeOutputTree {
  Write-Host "Electron Forge output tree:"
  if (Test-Path $outRoot) {
    Get-ChildItem $outRoot -Recurse -Force |
      Sort-Object FullName |
      ForEach-Object { Write-Host "- $($_.FullName)" }
  } else {
    Write-Host "- out directory was not created"
  }
}

if (-not (Test-Path $makeRoot)) {
  Write-ForgeOutputTree
  throw "Expected Electron Forge make output directory was not created: $makeRoot"
}

if (Test-Path $artifactRoot) {
  Remove-Item $artifactRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null

$packageVersion = (node -p "require('./package.json').version").Trim()
if (-not $packageVersion) {
  throw "Unable to resolve package.json version for Windows artifact names."
}

$installerArtifactName = "Moshu-$packageVersion-Setup.exe"
$portableArtifactName = "Moshu-$packageVersion-win32-x64-portable.zip"
$installerSources = @(Get-ChildItem $makeRoot -Recurse -File -Filter "*.exe" | Sort-Object FullName)
$portableSources = @(Get-ChildItem $makeRoot -Recurse -File -Filter "*.zip" | Sort-Object FullName)

if ($installerSources.Count -ne 1) {
  Write-ForgeOutputTree
  throw "Expected exactly one Windows installer .exe under $makeRoot, found $($installerSources.Count)."
}
if ($portableSources.Count -ne 1) {
  Write-ForgeOutputTree
  throw "Expected exactly one Windows portable .zip under $makeRoot, found $($portableSources.Count)."
}

Copy-Item $installerSources[0].FullName -Destination (Join-Path $artifactRoot $installerArtifactName) -Force
Copy-Item $portableSources[0].FullName -Destination (Join-Path $artifactRoot $portableArtifactName) -Force

$artifactRootPath = (Resolve-Path $artifactRoot).Path
$artifactFiles = @(Get-ChildItem $artifactRootPath -File | Sort-Object FullName)
$installers = @($artifactFiles | Where-Object { $_.Extension -eq ".exe" })
$zips = @($artifactFiles | Where-Object { $_.Extension -eq ".zip" })

if ($installers.Count -ne 1 -or $zips.Count -ne 1) {
  Write-ForgeOutputTree
  throw "Windows release assets must include exactly one installer .exe and one portable .zip."
}

$checksumPath = Join-Path $artifactRootPath "SHA256SUMS.txt"
$checksums = foreach ($file in $artifactFiles) {
  $relativePath = $file.FullName.Substring($artifactRootPath.Length + 1).Replace("\", "/")
  $hash = (Get-FileHash -Algorithm SHA256 $file.FullName).Hash.ToLowerInvariant()
  "$hash  $relativePath"
}
$checksums | Set-Content -Path $checksumPath -Encoding ascii

Write-Host "Windows package artifacts:"
Get-ChildItem $artifactRootPath -File |
  Sort-Object FullName |
  ForEach-Object { Write-Host "- $($_.Name)" }
