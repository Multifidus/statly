#!/usr/bin/env python3
"""Bump Statly's version across all four version-bearing files (plus Cargo.lock).

Usage:
    python3 scripts/bump-version.py [--dry-run] <new-version>

Updates:
    app/package.json                 "version"
    app/src-tauri/tauri.conf.json     "version"
    app/src-tauri/Cargo.toml          [package] version
    engine/pyproject.toml             [project] version
    app/src-tauri/Cargo.lock          the `statly` package entry's version
        (kept in sync with Cargo.toml via `cargo update -p statly --precise
        <new-version>` if cargo is on PATH; otherwise edited in place and a
        warning is printed)

Refuses to run on a dirty git working tree (staged or unstaged changes to
tracked files; untracked files are ignored). Exits non-zero on a dirty tree
or a malformed semantic version.

--dry-run prints the files it would change (and their old -> new version)
without writing anything.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Basic semver: MAJOR.MINOR.PATCH with optional -prerelease and +build metadata.
SEMVER_RE = re.compile(
    r"^(?P<major>0|[1-9]\d*)\.(?P<minor>0|[1-9]\d*)\.(?P<patch>0|[1-9]\d*)"
    r"(?:-(?P<prerelease>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
    r"(?:\+(?P<build>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$"
)


def is_valid_semver(version: str) -> bool:
    return bool(SEMVER_RE.match(version))


def check_clean_tree() -> None:
    """Exit non-zero if the git working tree has staged or unstaged changes
    to tracked files. Untracked files are allowed."""
    result = subprocess.run(
        ["git", "status", "--porcelain=v1"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    dirty_lines = [
        line for line in result.stdout.splitlines() if not line.startswith("??")
    ]
    if dirty_lines:
        print("error: working tree is dirty (staged or unstaged changes to tracked files):",
              file=sys.stderr)
        for line in dirty_lines:
            print(f"  {line}", file=sys.stderr)
        print("Commit or stash your changes before bumping the version.", file=sys.stderr)
        sys.exit(1)


def bump_package_json(path: Path, new_version: str, dry_run: bool) -> tuple[str, str]:
    text = path.read_text()
    m = re.search(r'"version"\s*:\s*"([^"]+)"', text)
    if not m:
        print(f"error: could not find \"version\" field in {path}", file=sys.stderr)
        sys.exit(1)
    old_version = m.group(1)
    if not dry_run:
        new_text = text[: m.start(1)] + new_version + text[m.end(1):]
        path.write_text(new_text)
    return old_version, new_version


def bump_tauri_conf_json(path: Path, new_version: str, dry_run: bool) -> tuple[str, str]:
    text = path.read_text()
    m = re.search(r'"version"\s*:\s*"([^"]+)"', text)
    if not m:
        print(f"error: could not find \"version\" field in {path}", file=sys.stderr)
        sys.exit(1)
    old_version = m.group(1)
    if not dry_run:
        new_text = text[: m.start(1)] + new_version + text[m.end(1):]
        path.write_text(new_text)
    return old_version, new_version


def bump_cargo_toml(path: Path, new_version: str, dry_run: bool) -> tuple[str, str]:
    text = path.read_text()
    m = re.search(r'^\[package\]\s*$(.*?)^\[', text, re.MULTILINE | re.DOTALL)
    section = m.group(1) if m else text
    vm = re.search(r'^version\s*=\s*"([^"]+)"', section, re.MULTILINE)
    if not vm:
        print(f"error: could not find [package] version in {path}", file=sys.stderr)
        sys.exit(1)
    old_version = vm.group(1)
    if not dry_run:
        start = text.index(section) + vm.start(1)
        end = text.index(section) + vm.end(1)
        new_text = text[:start] + new_version + text[end:]
        path.write_text(new_text)
    return old_version, new_version


def bump_pyproject_toml(path: Path, new_version: str, dry_run: bool) -> tuple[str, str]:
    text = path.read_text()
    m = re.search(r'^\[project\]\s*$(.*?)^\[', text, re.MULTILINE | re.DOTALL)
    section = m.group(1) if m else text
    vm = re.search(r'^version\s*=\s*"([^"]+)"', section, re.MULTILINE)
    if not vm:
        print(f"error: could not find [project] version in {path}", file=sys.stderr)
        sys.exit(1)
    old_version = vm.group(1)
    if not dry_run:
        start = text.index(section) + vm.start(1)
        end = text.index(section) + vm.end(1)
        new_text = text[:start] + new_version + text[end:]
        path.write_text(new_text)
    return old_version, new_version


def bump_cargo_lock(path: Path, new_version: str, dry_run: bool) -> tuple[str, str] | None:
    """Update the `statly` package entry in Cargo.lock. Prefer `cargo update
    -p statly --precise <new-version>` (keeps the lockfile's checksums/format
    correct); fall back to a direct text edit if cargo isn't on PATH."""
    text = path.read_text()
    m = re.search(r'^name = "statly"\nversion = "([^"]+)"', text, re.MULTILINE)
    if not m:
        print(f"warning: could not find `statly` package entry in {path}; skipping", file=sys.stderr)
        return None
    old_version = m.group(1)
    if dry_run:
        return old_version, new_version

    cargo_toml_dir = path.parent
    cargo = subprocess.run(["which", "cargo"], capture_output=True, text=True)
    if cargo.returncode == 0:
        result = subprocess.run(
            ["cargo", "update", "-p", "statly", "--precise", new_version],
            cwd=cargo_toml_dir,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            return old_version, new_version
        print(
            f"warning: `cargo update -p statly --precise {new_version}` failed "
            f"({result.stderr.strip()}); editing Cargo.lock directly instead",
            file=sys.stderr,
        )

    new_text = text[: m.start(1)] + new_version + text[m.end(1):]
    path.write_text(new_text)
    return old_version, new_version


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("new_version", help="New semantic version, e.g. 0.1.1")
    parser.add_argument("--dry-run", action="store_true", help="Print planned changes without writing")
    args = parser.parse_args()

    new_version = args.new_version
    if not is_valid_semver(new_version):
        print(f"error: '{new_version}' is not a valid semantic version (MAJOR.MINOR.PATCH)", file=sys.stderr)
        sys.exit(1)

    if not args.dry_run:
        check_clean_tree()

    targets = [
        ("app/package.json", bump_package_json),
        ("app/src-tauri/tauri.conf.json", bump_tauri_conf_json),
        ("app/src-tauri/Cargo.toml", bump_cargo_toml),
        ("engine/pyproject.toml", bump_pyproject_toml),
    ]

    changes: list[tuple[str, str, str]] = []
    for rel_path, fn in targets:
        path = REPO_ROOT / rel_path
        if not path.exists():
            print(f"error: {path} not found", file=sys.stderr)
            sys.exit(1)
        old_version, new_ver = fn(path, new_version, args.dry_run)
        changes.append((rel_path, old_version, new_ver))

    cargo_lock_path = REPO_ROOT / "app/src-tauri/Cargo.lock"
    if cargo_lock_path.exists():
        result = bump_cargo_lock(cargo_lock_path, new_version, args.dry_run)
        if result is not None:
            old_version, new_ver = result
            changes.append(("app/src-tauri/Cargo.lock", old_version, new_ver))
    else:
        print(f"warning: {cargo_lock_path} not found; skipping", file=sys.stderr)

    action = "Would update" if args.dry_run else "Updated"
    print(f"{action} {len(changes)} file(s) to version {new_version}:")
    for rel_path, old_version, new_ver in changes:
        print(f"  {rel_path}: {old_version} -> {new_ver}")

    if args.dry_run:
        print("\n(dry run — no files were written)")


if __name__ == "__main__":
    main()
