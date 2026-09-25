# Build the statly-engine PyInstaller onedir binary (Windows).
# Output: engine\dist\statly-engine\statly-engine.exe
$ErrorActionPreference = "Stop"

Set-Location -Path $PSScriptRoot

$pyinstaller = Join-Path $PSScriptRoot ".venv\Scripts\pyinstaller.exe"
if (-not (Test-Path $pyinstaller)) {
    Write-Error "engine\.venv\Scripts\pyinstaller.exe not found. Run:`n  python3.12 -m venv engine\.venv; engine\.venv\Scripts\pip.exe install -e `"engine[dev]`""
    exit 1
}

Remove-Item -Recurse -Force -ErrorAction SilentlyContinue build, dist

& $pyinstaller statly-engine.spec --noconfirm

Write-Host "Built: $PSScriptRoot\dist\statly-engine\statly-engine.exe"
