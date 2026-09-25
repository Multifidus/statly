#!/usr/bin/env bash
# Build the statly-engine PyInstaller onedir binary (macOS/Linux).
# Output: engine/dist/statly-engine/statly-engine
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

if [ ! -x ".venv/bin/pyinstaller" ]; then
    echo "error: engine/.venv/bin/pyinstaller not found. Run:" >&2
    echo "  python3.12 -m venv engine/.venv && engine/.venv/bin/pip install -e \"engine[dev]\"" >&2
    exit 1
fi

rm -rf build dist

.venv/bin/pyinstaller statly-engine.spec --noconfirm

echo "Built: $(pwd)/dist/statly-engine/statly-engine"
