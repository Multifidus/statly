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

## Phase 1 methods (data layer)
Params/results are `contracts/Rpc.json#/$defs/<Name>`; the engine validates both with the
generated pydantic models. The engine holds one `DatasetStore` per session (datasets, the
latest import preview, autosave paths); every other function is pure.

| Method | Params | Result |
|---|---|---|
| `dataset.import_preview` | `DatasetImportPreviewParams` | `DatasetImportPreviewResult` |
| `dataset.import` | `DatasetImportParams` | `DatasetResult` |
| `dataset.stack` | `DatasetStackParams` | `DatasetResult` |
| `dataset.link` | `DatasetLinkParams` | `DatasetLinkResult` |
| `dataset.rows` | `DatasetRowsParams` | `DatasetRowsResult` |
| `dataset.missing_summary` | `DatasetIdParams` | `DatasetMissingSummaryResult` |
| `project.save` | `ProjectSaveParams` | `ProjectSaveResult` |
| `project.load` | `ProjectLoadParams` | `ProjectLoadResult` |
| `project.autosave` | `ProjectAutosaveParams` | `ProjectAutosaveResult` |
| `project.recoverable` | `ProjectRecoverableParams` | `ProjectRecoverableResult` |
| `project.discard_autosave` | `ProjectDiscardAutosaveParams` | `OkResult` |

Semantics (see `contracts/README.md` for the table notes):
- `dataset.import_preview` stages a parse under `preview_id`; only the latest preview is kept.
- `file_id` is deterministic: `f_` + first 12 hex of sha256(normalized absolute path). It is the
  same across re-previews of the same path (e.g. after choosing another xlsx sheet), so the app
  can key its decisions on it. The same path twice in one preview, or a path whose id is already
  used by the dataset being stacked onto, gets a `_2`, `_3`, ... suffix.
- `dataset.import` `variables`: empty = accept proposals. Entries override proposals matched by
  `name`, else by `sources[0]` (`file_id`, `original_column_name`); unmentioned columns keep their
  proposal. The app sends only the variables the user changed. Choice-text answers are recoded
  through `value_labels` when the variable's dtype is numeric. A conversion that would lose a
  non-empty value is rejected with `-32003`.
- Choice text (answers exported as words): the preview proposes `dtype: integer` with
  `value_labels` coding the known response set 1..k low-to-high and a `choice_text_detected`
  issue on the column. The app confirms order and codes (default 1..k; the user may enter the
  survey's own recode values, e.g. 1, 2, 4, 5, 7) and sends them back in `value_labels`, with
  `response_range` = min/max code. Matrix items (same `scale_id`) share one confirmation.
- Numeric exports whose codes skip values get a `noncontiguous_codes` issue and `value_labels`
  listing the observed codes (label = the number, since the answer text is unknown).
- Multi-select split: add one indicator variable per option with `sources[0]` pointing at the
  multi-select column and `label` = the option text (the proposed multi-select variable lists its
  options in `value_labels`). Indicators are 1 = selected, 0 = not selected, null = question blank.
  Cells are split by matching the known options greedily (longest first, spacing around commas
  ignored), so an option that contains a comma ("Other, please specify") counts as one choice;
  detection merges a lowercase token that always follows the same token into one option.
- Suggested scales are kept when at least two final variables still carry their `scale_id`.
- Row filters apply in the given order; `rows_removed` is recomputed per filter.
- Stacking: `ColumnMatch` columns not referenced by any match are dropped (logged as `user`).
  For `dataset.stack`, existing data is referenced by `file_id` = the `dataset_id`.
- `dataset.link` in linked mode needs a stacked dataset; IDs are trimmed and upper-cased by default.
- `project.save` deletes the autosave this session wrote for the same `project_id`.
- `project.discard_autosave` only deletes files that contain `autosave.json`.

Application errors (`error.data.type` is the short name):

| Code | `data.type` | Meaning |
|---|---|---|
| `-32001` | `FileUnreadable` | File missing, unreadable, or unsupported format |
| `-32002` | `StaleOrUnknown` | Stale `snapshot_id` or unknown `preview_id` / `dataset_id` |
| `-32003` | `InvalidParams` | Params fail contract validation (`data.errors` lists problems) |
| `-32004` | `IncompatibleProject` | Project file has a newer `schema_version` than this build supports |
