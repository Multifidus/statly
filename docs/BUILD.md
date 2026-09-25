# Building Statly

## Packaging decisions (owner-approved)

- The Python stats engine ships as a **PyInstaller onedir** build
  (`engine/build.sh` → `engine/dist/statly-engine/`), staged into
  `app/src-tauri/resources/engine/` as a bundled **Tauri resource** (not
  a single-file sidecar binary) — see `scripts/stage-engine.sh` /
  `scripts/stage-engine.ps1`.
- The Tauri bundle identifier is `edu.statly.desktop`
  (`app/src-tauri/tauri.conf.json`).
- `CI=true` is required for headless DMG creation on macOS (see below).

## macOS (arm64/x86_64)

```bash
export PATH="$HOME/.cargo/bin:$PATH"
python3.12 -m venv engine/.venv
engine/.venv/bin/pip install -e "engine[dev]"
bash engine/build.sh              # -> engine/dist/statly-engine/
bash scripts/stage-engine.sh      # -> app/src-tauri/resources/engine/ (gitignored)
cd app && npm ci
CI=true npm run tauri build
```

`CI=true` is required for headless DMG creation — without it, `bundle_dmg.sh`
tries to script Finder via AppleScript, which fails/hangs with no logged-in
GUI session (CI, SSH).

## Windows (x86_64)

```powershell
python -m venv engine\.venv
engine\.venv\Scripts\pip.exe install -e "engine[dev]"
engine\build.ps1                  # -> engine\dist\statly-engine\
scripts\stage-engine.ps1          # -> app\src-tauri\resources\engine\
cd app; npm ci
npm run tauri build
```

## Env vars (see docs/PROTOCOL.md)

- `STATLY_ENGINE_DEV=1` — force the dev fallback launch (`engine/.venv/bin/python -m statly_engine`), skipping any bundled binary.
- `STATLY_ENGINE_CMD` — override the full engine launch command (dev/testing).

## Where bundles land

- macOS: `app/src-tauri/target/release/bundle/macos/Statly.app` and
  `app/src-tauri/target/release/bundle/dmg/*.dmg`
  (per-target CI builds: `app/src-tauri/target/<triple>/release/bundle/...`).
- Windows: `app\src-tauri\target\<triple>\release\bundle\nsis\*-setup.exe`.

## Licensing policy

Statly bans the entire GPL family (GPL, AGPL, LGPL) from shipped runtime
dependencies across all three ecosystems (Python engine, JS app, Rust
Tauri shell). CI enforces this in the `licenses` job of
`.github/workflows/build.yml`, which runs `scripts/check-licenses.py`
against `pip-licenses` (Python), `license-checker-rseidelsohn` (JS), and
`cargo metadata` (Rust) output, and fails the build on any hit.

To check locally:

```bash
python3.12 -m venv /tmp/license-venv
/tmp/license-venv/bin/pip install -e engine pip-licenses
/tmp/license-venv/bin/pip-licenses --format=json > /tmp/pip-licenses.json

cd app && npm ci
npx --yes license-checker-rseidelsohn --production --json > /tmp/js-licenses.json
cd src-tauri && cargo metadata --format-version 1 > /tmp/cargo-metadata.json
cd ../..

python3.12 scripts/check-licenses.py \
  --pip-licenses /tmp/pip-licenses.json \
  --js-licenses /tmp/js-licenses.json \
  --cargo-metadata /tmp/cargo-metadata.json \
  --write THIRD_PARTY_LICENSES.md
```

Verified false positives (e.g. an either-or license like
`MIT OR Apache-2.0 OR LGPL-2.1-or-later`, where the permissive option is
what's actually used) go in `scripts/license-allowlist.txt` with a comment
explaining why — never to silence a genuine copyleft dependency.
`THIRD_PARTY_LICENSES.md` at the repo root is generated output; CI fails
if it drifts from a fresh regeneration, so always commit the regenerated
file alongside a dependency change.

## Local dev

```bash
cd app && STATLY_ENGINE_DEV=1 npm run tauri dev
```
