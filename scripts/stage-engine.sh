#!/usr/bin/env bash
# Copy the built PyInstaller onedir engine into the Tauri app's resources dir
# so it can be bundled as a sidecar resource. Safe to run even if app/ or the
# engine build don't exist yet (e.g. before Phase 0's app scaffold lands).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO_ROOT/engine/dist/statly-engine"
DEST_PARENT="$REPO_ROOT/app/src-tauri/resources"
DEST="$DEST_PARENT/engine"

if [ ! -d "$SRC" ]; then
    echo "error: $SRC not found. Build the engine first: engine/build.sh" >&2
    exit 1
fi

mkdir -p "$DEST_PARENT"

rm -rf "$DEST"
mkdir -p "$DEST"

cp -R "$SRC/." "$DEST/"

echo "Staged engine: $SRC -> $DEST"
