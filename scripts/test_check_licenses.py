"""Pytest coverage for check-licenses.py's version-ignoring diff logic.

check-licenses.py is a standalone script (hyphenated filename, not a
package), so it's loaded via importlib rather than a normal import. Run
with:

    engine/.venv/bin/python -m pytest scripts/test_check_licenses.py -v
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

SCRIPT_PATH = Path(__file__).resolve().parent / "check-licenses.py"


def _load_check_licenses():
    spec = importlib.util.spec_from_file_location("check_licenses", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["check_licenses"] = module
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


check_licenses = _load_check_licenses()


COMMITTED_TABLE = "\n".join(
    [
        "| Ecosystem | Package | Version | License |",
        "|---|---|---|---|",
        "| python | wrapt | 2.4.1 | BSD-2-Clause |",
        "| python | requests | 2.31.0 | Apache-2.0 |",
        "",
    ]
)


def test_version_only_drift_is_ignored():
    current_rows = [
        {"ecosystem": "python", "package": "wrapt", "version": "2.5.0", "license": "BSD-2-Clause"},
        {"ecosystem": "python", "package": "requests", "version": "2.31.0", "license": "Apache-2.0"},
    ]
    added, removed, changed = check_licenses.diff_license_tables(current_rows, COMMITTED_TABLE)
    assert added == []
    assert removed == []
    assert changed == []


def test_added_removed_and_license_change_are_caught():
    current_rows = [
        {"ecosystem": "python", "package": "wrapt", "version": "2.5.0", "license": "GPL-3.0"},
        {"ecosystem": "python", "package": "newpkg", "version": "1.0.0", "license": "MIT"},
    ]
    added, removed, changed = check_licenses.diff_license_tables(current_rows, COMMITTED_TABLE)
    assert added == [("python", "newpkg", "MIT")]
    assert removed == [("python", "requests", "Apache-2.0")]
    assert changed == [("python", "wrapt", "BSD-2-Clause", "GPL-3.0")]


def test_self_test_flag_exits_zero():
    assert check_licenses.run_self_test() == 0
