# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller onedir spec for the Statly stats-engine sidecar.

Build with `engine/build.sh` (mac) or `engine/build.ps1` (Windows), which run
this via the project venv's pyinstaller. Output: engine/dist/statly-engine/
containing the `statly-engine` (mac) / `statly-engine.exe` (win) executable.

Onedir (not onefile) per docs/PROTOCOL.md: fast startup (no temp extraction
of numpy/scipy) and codesign-friendly on Apple Silicon.
"""

from PyInstaller.utils.hooks import collect_all

datas = []
binaries = []
hiddenimports = []

# reportlab (PDF export) loads font metrics / modules lazily; python-docx needs its default.docx
# template and XML part templates (Phase 8 exports).
for pkg in ("numpy", "pandas", "scipy", "statsmodels", "reportlab", "docx"):
    pkg_datas, pkg_binaries, pkg_hiddenimports = collect_all(pkg)
    datas += pkg_datas
    binaries += pkg_binaries
    hiddenimports += pkg_hiddenimports

a = Analysis(
    ["statly_engine/__main__.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="statly-engine",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="statly-engine",
)
