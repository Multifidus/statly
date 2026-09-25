# Building Statly

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

## Local dev

```bash
cd app && STATLY_ENGINE_DEV=1 npm run tauri dev
```
