# Copy the built PyInstaller onedir engine into the Tauri app's resources dir
# so it can be bundled as a sidecar resource. Safe to run even if app\ or the
# engine build don't exist yet (e.g. before Phase 0's app scaffold lands).
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Src = Join-Path $RepoRoot "engine\dist\statly-engine"
$DestParent = Join-Path $RepoRoot "app\src-tauri\resources"
$Dest = Join-Path $DestParent "engine"

if (-not (Test-Path $Src)) {
    Write-Error "$Src not found. Build the engine first: engine\build.ps1"
    exit 1
}

New-Item -ItemType Directory -Force -Path $DestParent | Out-Null

if (Test-Path $Dest) {
    Remove-Item -Recurse -Force $Dest
}
New-Item -ItemType Directory -Force -Path $Dest | Out-Null

Copy-Item -Path (Join-Path $Src "*") -Destination $Dest -Recurse -Force

Write-Host "Staged engine: $Src -> $Dest"
