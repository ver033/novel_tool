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

$makeAssetFiles = @(
  Get-ChildItem $makeRoot -Recurse -File |
    Where-Object { $_.Extension -in @(".exe", ".nupkg", ".zip") -or $_.Name -eq "RELEASES" } |
    Sort-Object FullName -Unique
)

$duplicateNames = @($makeAssetFiles | Group-Object Name | Where-Object { $_.Count -gt 1 })
if ($duplicateNames.Count -gt 0) {
  $names = ($duplicateNames | ForEach-Object { $_.Name }) -join ", "
  throw "Duplicate Windows artifact file names would collide in staging: $names"
}

foreach ($file in $makeAssetFiles) {
  Copy-Item $file.FullName -Destination (Join-Path $artifactRoot $file.Name) -Force
}

$artifactRootPath = (Resolve-Path $artifactRoot).Path
$artifactFiles = @(Get-ChildItem $artifactRootPath -File | Sort-Object FullName)
$installers = @($artifactFiles | Where-Object { $_.Extension -eq ".exe" })
$packages = @($artifactFiles | Where-Object { $_.Extension -eq ".nupkg" })
$releaseIndexes = @($artifactFiles | Where-Object { $_.Name -eq "RELEASES" })
$zips = @($artifactFiles | Where-Object { $_.Extension -eq ".zip" })
$hasCompleteSquirrelSet = $installers.Count -ge 1 -and $packages.Count -ge 1 -and $releaseIndexes.Count -ge 1

if ($zips.Count -lt 1 -and -not $hasCompleteSquirrelSet) {
  Write-ForgeOutputTree
  throw "Electron Forge make did not produce a Windows distributable under $makeRoot."
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
