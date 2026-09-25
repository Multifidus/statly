# Sidecar IPC protocol (Phase 0 contract)

Transport: the app spawns the engine binary once per session and talks JSON-RPC 2.0
over the engine's stdin/stdout. One JSON object per line (NDJSON), UTF-8, `\n` terminated.
stdout carries ONLY protocol frames. All logging goes to stderr. Binary must never
print anything else to stdout (e.g. warnings from libraries must be routed to stderr).

Engine reads stdin until EOF, then exits 0. Requests may be answered out of order;
the app correlates by `id`. Notifications (no `id`) are ignored in Phase 0.

## Methods
- `ping` params `{}` → `{"pong": true, "engine_version": "0.1.0", "python_version": "3.12.x", "platform": "..."}`
- `engine.info` params `{}` → `{"engine_version", "python_version", "platform", "libraries": {"numpy": "...", "pandas": "...", "scipy": "..."}}`
- `shutdown` params `{}` → `{"ok": true}`, then engine exits 0.
- Unknown method → JSON-RPC error `-32601`. Malformed JSON line → `-32700` with `id: null`.
- Any uncaught exception in a handler → `-32000`, `data: {"type": ExceptionClassName, "traceback": "..."}`.

## Binary locations
- Dev: the engine runs from source: `engine/.venv/bin/python -m statly_engine` (Windows: `engine\.venv\Scripts\python.exe`).
  The app uses this when env `STATLY_ENGINE_DEV=1` or when no bundled binary exists.
- Packaged: PyInstaller **onedir** output `engine/dist/statly-engine/` is staged by
  `scripts/stage-engine.(sh|ps1)` into `app/src-tauri/resources/engine/` (gitignored) and
  bundled as a Tauri resource. Executable inside: `statly-engine` (mac) / `statly-engine.exe` (win).
  Rationale for onedir over onefile: fast startup (no temp extraction of numpy/scipy) and
  codesign-friendly on Apple Silicon.

## Startup UX
The app shows a "Warming up the statistics engine…" state until the first `ping` succeeds
(timeout 30 s, then a plain-language error with a Retry button).
