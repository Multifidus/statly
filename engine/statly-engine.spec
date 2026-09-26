# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller onedir spec for the Statly stats-engine sidecar.

Build with `engine/build.sh` (mac) or `engine/build.ps1` (Windows), which run
this via the project venv's pyinstaller. Output: engine/dist/statly-engine/
containing the `statly-engine` (mac) / `statly-engine.exe` (win) executable.

Onedir (not onefile) per docs/PROTOCOL.md: fast startup (no temp extraction
of numpy/scipy) and codesign-friendly on Apple Silicon.
"""

from PyInstaller.utils.hooks import collect_all, collect_submodules

datas = []
binaries = []
hiddenimports = []

# Modules the engine never imports (verified with grep over engine/statly_engine): GUI/notebook
# stacks, dev/test tooling, and stdlib debugging helpers we don't ship. Also strips the test
# subpackages that collect_all() below would otherwise pull in from numpy/pandas/scipy/statsmodels
# (their own bundled unit tests, which are pure dead weight in a shipped sidecar).
EXCLUDES = [
    "tkinter", "_tkinter",
    "matplotlib",
    "IPython", "jupyter", "notebook",
    "pytest", "_pytest",
    "doctest",
    "setuptools", "pip", "wheel",
    "numpy.tests", "numpy.array_api.tests", "numpy.distutils.tests", "numpy.f2py.tests",
    "numpy.linalg.tests", "numpy.ma.tests", "numpy.matrixlib.tests", "numpy.polynomial.tests",
    "numpy.random.tests", "numpy.testing.tests",
    "pandas.tests",
    "scipy.conftest",
    "sqlite3", "_sqlite3",
]


def _is_test_path(name: str) -> bool:
    parts = name.split(".") if "." in name or "/" not in name else name.replace("/", ".").split(".")
    return any(p in ("tests", "test") for p in parts)


# reportlab (PDF export) loads font metrics / modules lazily; python-docx needs its default.docx
# template and XML part templates (Phase 8 exports).
for pkg in ("numpy", "pandas", "scipy", "statsmodels", "reportlab", "docx"):
    pkg_datas, pkg_binaries, pkg_hiddenimports = collect_all(pkg)
    # collect_all() sweeps in each package's own bundled test suite (numpy.tests,
    # pandas.tests, scipy.*.tests, statsmodels.*.tests) as both data files and hidden
    # imports; drop those explicitly since `excludes=` on Analysis only blocks new
    # imports from being followed, it doesn't prune data already collected here.
    datas += [d for d in pkg_datas if not _is_test_path(d[0])]
    binaries += pkg_binaries
    hiddenimports += [h for h in pkg_hiddenimports if not _is_test_path(h)]

# stats/registry.py imports analysis modules by name (importlib), which static analysis can't
# follow; collect every engine submodule so new families (charts KDE, export, tags/qualitative,
# planner) are always in the bundle.
hiddenimports += collect_submodules("statly_engine")

# The Test Advisor reads the decision tree (plus its schema and the canonical analysis ids) at
# runtime; advisor/loader.py resolves them under sys._MEIPASS with this same layout when frozen.
datas += [
    ("../content/decision_tree.yaml", "content"),
    ("../content/decision_tree.schema.json", "content"),
    ("../contracts/analysis_ids.json", "contracts"),
]

a = Analysis(
    ["statly_engine/__main__.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=EXCLUDES,
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
