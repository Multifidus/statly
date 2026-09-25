# Statly shared contracts

JSON Schema (draft 2020-12) definitions shared by the app (TypeScript) and the engine
(Python). SPEC §4. The schemas are the source of truth; generated code is derived.

## Conventions
- One file per contract. `$id` = `https://statly.local/contracts/<Name>.json`; cross-file
  references use relative `$ref` (`"DatasetMeta.json"`, `"AnalysisRequest.json#/$defs/Tails"`).
- Every top-level contract has `schema_version` (`const: 1`). A breaking change bumps the
  const and requires a migration in the engine's project loader; additive optional
  fields do not.
- Objects are closed (`additionalProperties: false`) except where noted as open
  (`AnalysisRequest.options`, `ChartSpec.customization`). Fields are required and use
  `null` for "not applicable" rather than being omitted, so both languages see one shape.
- Every named sub-type has a `title` equal to its `$defs` key; that is the generated type name.
- Enum-like identifiers that grow over time (analysis ids, assumption keys, effect-size
  keys, warning codes) are open strings constrained by a snake_case pattern; the engine's
  registry is authoritative.

| Contract | Purpose |
|---|---|
| `VariableSchema` | One variable: role, level, dtype, ordered value labels, reverse coding, missing codes, provenance, PII, computed definition |
| `DatasetMeta` | Everything but the rows: variables, scales, import log, stacking, link config, missing summary, `snapshot_id` |
| `ProjectFile` | `project.json` root inside a `.statly` file (also defines `TestFamily`, `UiState`, `AutosaveMarker`) |
| `AnalysisRequest` | Input to a pure analysis: `(snapshot_id, AnalysisRequest) -> AnalysisResult` |
| `AnalysisResult` | Statistics, effect sizes + CIs, assumptions, descriptives, plain-language summary, APA sentence/tables, warnings, inputs |
| `AssumptionResult` | One assumption check for one group / the differences / residuals |
| `ChartSpec` | Saved chart-builder chart (Vega-Lite is derived, never stored) |
| `TestLogEntry` | One logged analysis run + user-chosen family correction |
| `TagCodebook` | Qualitative tags and their application to response rows |
| `StudyPlan` | Study Planner design answers, planned analyses, power analyses, recommendations |
| `Rpc` | `$defs` only: params/results for the Phase 1 RPC methods below |

Hand-written example instances live in `examples/<Name>.json` and are checked by
`engine/tests/test_contracts.py` (schema validation + pydantic round-trip).

## Code generation
Run `scripts/gen-contracts.sh` (or `npm run gen:contracts` in `app/`) after editing any
schema, and commit the output. Generated files carry a DO NOT EDIT header.

| Output | Tool | License |
|---|---|---|
| `app/src/contracts/index.ts` (single module, all types) | `json-schema-to-typescript` 16.x (npm, devDependency) | MIT |
| `engine/statly_engine/contracts/` (pydantic v2; import from the package root, e.g. `from statly_engine.contracts import DatasetMeta`, `contracts.Rpc.DatasetRowsParams`) | `datamodel-code-generator` 0.83.0 (pip, dev extra) | MIT |
| Runtime model library | `pydantic` 2.x (engine runtime dependency) | MIT |
| Contract-test validator | `jsonschema` 4.x + `referencing` (dev extra) | MIT |

## Identity and data ownership
- The engine owns the data. The frontend holds `DatasetMeta` and paged row slices from
  `dataset.rows`, never the full dataset.
- `DatasetMeta.snapshot_id` identifies the current data + variable metadata. Any
  mutation produces a new id. Analyses take a snapshot id and are pure.
- Each row has a stable id in the reserved Parquet column `_statly_row_id` (int64, not a
  variable). Tag applications and grid selections reference rows by it.

## `.statly` file layout (zip, deflate)
```
project.json                 ProjectFile (schema_version, app/engine versions, dataset_meta, ...)
data/dataset.parquet         the dataset incl. _statly_row_id (pyarrow, Apache-2.0); absent if no data
originals/<file_id>/<name>   untouched imported files, byte-identical (sha256 in import_log)
results/<entry_id>.json      full AnalysisResult per TestLogEntry (entry.result_path)
autosave.json                AutosaveMarker -- present ONLY in autosave copies
```
- Save is atomic: write `<path>.tmp`, fsync, rename over `<path>`; then delete this
  project's autosave.
- Autosave writes a full copy to `<autosave_dir>/<project_id>.statly` including
  `autosave.json`. `autosave_dir` is supplied by the shell (Tauri app data dir).
- Crash recovery: at launch the app calls `project.recoverable`; any autosave newer than
  its `original_path` (or with no original) is offered for recovery via `project.load`.

## Phase 1 RPC methods
Extends the Phase 0 set in `docs/PROTOCOL.md` (`ping`, `engine.info`, `shutdown`).
All schema refs below are `Rpc.json#/$defs/<Name>` unless qualified.

| Method | Params | Result | Notes |
|---|---|---|---|
| `dataset.import_preview` | `DatasetImportPreviewParams` | `DatasetImportPreviewResult` | Parse 1+ files: encoding/delimiter/sheet, Qualtrics detection, proposed `VariableSchema`s, sample rows, suggested row filters and scales; `stack_proposal` (column matching) for 2+ files or when `stack_onto_dataset_id` is set. Engine stages the parse under `preview_id`. |
| `dataset.import` | `DatasetImportParams` | `DatasetResult` | Commit a preview as a new dataset. `stack` required for 2+ files. |
| `dataset.stack` | `DatasetStackParams` | `DatasetResult` | Append newly previewed files (e.g. a later Follow-up export) to an existing dataset as new time levels. |
| `dataset.link` | `DatasetLinkParams` | `DatasetLinkResult` | Switch aggregate/linked mode; normalizes IDs and reports matched/unmatched/duplicate. |
| `dataset.rows` | `DatasetRowsParams` | `DatasetRowsResult` | Paged row slice (`limit` <= 2000) for the virtualized grid. |
| `dataset.missing_summary` | `DatasetIdParams` | `DatasetMissingSummaryResult` | Per-variable missing counts (blank vs declared codes). |
| `project.save` | `ProjectSaveParams` | `ProjectSaveResult` | Writes the zip; engine substitutes its authoritative `dataset_meta`. |
| `project.load` | `ProjectLoadParams` | `ProjectLoadResult` | Loads project + data into the engine; works for autosave copies (`is_autosave`). |
| `project.autosave` | `ProjectAutosaveParams` | `ProjectAutosaveResult` | Periodic crash-recovery copy. |
| `project.recoverable` | `ProjectRecoverableParams` | `ProjectRecoverableResult` | Lists autosaves in `autosave_dir` (crash recovery at launch). |
| `project.discard_autosave` | `ProjectDiscardAutosaveParams` | `OkResult` | User declined recovery. |

Phase 1 application errors (JSON-RPC `error.code`, `error.data.type` = short name):
`-32001` file unreadable / unsupported format, `-32002` stale snapshot or unknown
`preview_id`/`dataset_id`, `-32003` params fail contract validation (with `data.errors`),
`-32004` project file incompatible (newer `schema_version` than this build supports).
