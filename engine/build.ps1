# Build the statly-engine PyInstaller onedir binary (Windows).
# Output: engine\dist\statly-engine\statly-engine.exe
# The caller's working directory is restored on exit (Push-Location/Pop-Location), so
# scripts can run this and then call other repo-relative scripts.
$ErrorActionPreference = "Stop"

Push-Location -Path $PSScriptRoot
try {
    $pyinstaller = Join-Path $PSScriptRoot ".venv\Scripts\pyinstaller.exe"
    if (-not (Test-Path $pyinstaller)) {
        throw "engine\.venv\Scripts\pyinstaller.exe not found. Run:`n  python3.12 -m venv engine\.venv; engine\.venv\Scripts\pip.exe install -e `"engine[dev]`""
    }

    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue build, dist

    & $pyinstaller statly-engine.spec --noconfirm
    if ($LASTEXITCODE -ne 0) { throw "pyinstaller failed with exit code $LASTEXITCODE" }

    Write-Host "Built: $PSScriptRoot\dist\statly-engine\statly-engine.exe"
}
finally {
    Pop-Location
}
