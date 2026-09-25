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

## Test Advisor methods (SPEC §7.1)

Stateless and pure: each handler loads `content/decision_tree.yaml` (cached, validated
against `content/decision_tree.schema.json` at first load) and evaluates it fresh from
`answers`/`dataset_context` given in the request - no session state, no `dataset_id`.
Params/results are plain JSON objects (not yet in `contracts/Rpc.json`); malformed params
raise `-32003` `InvalidParams` the same way Phase 1 methods do.

| Method | Params | Result |
|---|---|---|
| `advisor.start` | `{"dataset_context"?: DatasetContext}` | `AdvisorStep` |
| `advisor.answer` | `{"answers": {question_id: value}, "dataset_context"?: DatasetContext}` | `AdvisorStep` |
| `advisor.paths` | `{}` | `{"paths": AdvisorPath[]}` |

`DatasetContext` (all optional; auto-fills a question only when the field the question
declares `auto.field: <name>` for is present and one of its `auto.rules` matches):
- `outcome_level`: `"nominal" \| "ordinal" \| "continuous"`
- `num_groups`: integer
- `num_time_points`: integer
- `linked_mode`: boolean
- `covariates_present`: boolean

`AdvisorStep` (exactly one of `next_question`/`recommendation` is non-null):
- `next_question`: `{"id", "text", "why", "options": [{"value", "label"}], "auto_answer"}`
  or `null`. `auto_answer` is the value `dataset_context` would supply for this question
  (informational; the caller still answers explicitly via `advisor.answer`).
- `recommendation`: `{"id", "primary_test", "nonparametric_alternative", "assumptions"[],
  "effect_size"[], "post_hoc"[], "why_this_test", "likert_note", "caveats"[]}` or `null`.
- `path`: `[{"question", "value", "source": "user"\|"auto"}]` - every question answered
  (explicitly or via `dataset_context`) to reach this step, in order.

`advisor.answer`'s `answers` is the *full* set of question id -> value answered so far
(not just the newest one), so the handler stays a pure function of its params instead of
holding conversation state. `AdvisorPath` (from `advisor.paths`, e.g. for the Study
Planner, SPEC §11.2): `{"answers": [{"question", "value", "label"}], "recommendation":
<same shape as AdvisorStep.recommendation>}`, ignoring auto/dataset_context - it
enumerates every root-to-recommendation path.

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

## Phase 2 methods (Variable Interview, SPEC §6)
`contracts/Rpc.json` does not define these yet; the engine validates them with closed pydantic
models in `engine/statly_engine/rpc_methods/variables.py` built from the generated contract
types (`ValueLabel`, `ResponseRange`, `VariableRole`, `MeasurementLevel`, `ComputedDefinition`,
`DatasetMeta`). The app mirrors them in `app/src/lib/variablesRpc.ts`.

Every mutating method takes `{dataset_id, snapshot_id?, ...}` (`snapshot_id` = optional stale check,
`-32002` if it is not current) and returns `DatasetEditResult = {dataset_meta, warnings}` where
`warnings: [{code, message, variable|null}]` are plain-language notes for the user. Each call
commits one new snapshot with a history label (undo/redo step).

| Method | Params | Result |
|---|---|---|
| `variables.update` | `{dataset_id, snapshot_id?, updates: [VariablePatch], label?}` | `DatasetEditResult` |
| `scales.upsert` | `{dataset_id, snapshot_id?, scale: {id?, name, items, scoring_method: mean\|sum, min_items?, score_variable?}}` | `DatasetEditResult` |
| `scales.delete` | `{dataset_id, snapshot_id?, scale_id}` | `DatasetEditResult` |
| `items.score` | `{dataset_id, snapshot_id?, key: [{item, correct: [value] \| null}], total_name?, total_label?}` | `DatasetEditResult` |
| `items.parse_answer_key` | `{path}` | `{entries: [{item, correct: [value]}], warnings}` |
| `computed.preview` | `{dataset_id, definition: ComputedDefinition}` | `{snapshot_id, dtype, row_ids, values, n_valid, n_missing, warnings}` (first 10 rows) |
| `computed.add` | `{dataset_id, snapshot_id?, name, label?, role?, level?, definition: ComputedDefinition}` | `DatasetEditResult` |
| `computed.remove` | `{dataset_id, snapshot_id?, name}` | `DatasetEditResult` |
| `dataset.history` | `{dataset_id}` | `{dataset_id, current_snapshot_id, cursor, entries: [{snapshot_id, label, timestamp, restorable}]}` |
| `dataset.restore_snapshot` | `{dataset_id, snapshot_id}` | `{dataset_meta}` |

Semantics:
- `VariablePatch` = `{name, role?, level?, label?, question_text?, value_labels?, reverse_coded?,
  response_range?, missing_codes?, display_order?}`; only the keys sent are changed (a sent `null`
  clears a nullable field). Array order of `value_labels` is the category order. Patched
  `display_order`s win ties and the engine renumbers all variables 0..n-1. Text variables can't be
  reverse-coded; duplicate value codes are rejected.
- After every edit the engine re-evaluates all computed variables in dependency order, so changing
  `reverse_coded`, `response_range` or `missing_codes` of an item immediately updates its scores.
- Reverse-scoring never changes stored item values; scores use `(min + max) - x` with min/max from
  `response_range`. If it is null, the observed min/max are used and a `reverse_range_observed`
  warning is returned.
- Scales: `scales.upsert` creates (no/unknown `id`) or updates a scale, sets each item's `scale_id`
  (role `unassigned` becomes `likert_item`), and creates/updates its score variable
  (`<slug(name)>_score` unless `score_variable` is given; role `scale_score`, level `continuous`,
  dtype `float`, `computed` = `scale_mean`/`scale_sum`, placed after the last item). Omitted
  `min_items` defaults to half the items rounded up for `mean` and all items for `sum`; an explicit
  `null` keeps the contract meaning (>= 1 answered for mean, all for sum). Scores are the mean/sum of
  *answered* items; rows answering fewer than `min_items` get a missing score. Items need a numeric
  dtype; at least two items. An item already in another scale moves to this one; a scale left with
  fewer than two items is removed (warning `scale_removed`). `scales.delete` clears `scale_id`s and
  removes the score variable (rejected while another computed variable uses it).
- `items.score`: for each key entry with `correct` values, creates/replaces `<item>_correct`
  (integer 0/1, role `test_item`, value labels Incorrect/Correct, placed after the item) as a
  `recode` of the item: the correct answer(s) -> 1, every other answer observed at scoring time -> 0,
  blank/missing stays missing. Keys match answers ignoring case and surrounding spaces; a key nobody
  chose gives `key_not_observed`. `correct: null` = the item is already scored 0/1 and is used as is.
  The total (`<common prefix>_total`, e.g. `Q4_total`, else `test_total`, or `total_name`) is a
  `scale_sum` with `min_items: 1`: the number of correct answers among answered questions (same as
  Qualtrics `SC0`), missing only when every question is blank; role `test_total`. Re-scoring
  replaces the same variables. Answers that first appear later (e.g. after stacking another file)
  are not in the recode rules: score the test again after adding data.
- `items.parse_answer_key` reads a CSV/XLSX with a header naming the question column
  (item/variable/name/question) and the answer column (correct/answer/key); with no such header the
  first two columns are used (warning `answer_key_no_header`). Several correct answers may be
  separated by `|` or `;`.
- Computed variables use `VariableSchema.computed` ops only (no formula language). Operands with
  `time_level: null` are row-wise. An operand with a `time_level` needs a stacked dataset in linked
  mode (else `-32003` asking the user to link): the participant's value at that level (IDs
  normalized as in `dataset.link`) is written onto every row of that participant; IDs duplicated
  at that level get missing (warning `duplicate_ids_at_level`). `normalized_gain` =
  `(post - pre) / (max_score - pre)`, missing when `pre == max_score` (warning `gain_at_ceiling`).
  `recode` output is integer/float when every output is numeric, else string. Default role: scale
  ops `scale_score`; difference/gain inherit `test_total`/`scale_score` when both operands share it
  (else `unassigned`); recode inherits the source's role and level. The new variable is placed after
  its last operand. `computed.remove` only removes computed variables and is rejected while another
  computed variable depends on it; removing a scale's score clears `scale.score_variable`.
- History / undo-redo: the engine keeps an ordered snapshot history per dataset
  (`DatasetStore`). Every commit (import, stack, link, and the methods above) appends an entry
  labelled for the user and drops any redo tail; an edit that changes nothing adds no entry.
  Snapshot ids are content hashes, suffixed `__2`, `__3`, ... when earlier content reappears, so
  every history position has a unique id. `dataset.restore_snapshot` moves the pointer (undo/redo)
  and makes that snapshot current. The 50 most recent entries keep their data (`restorable`);
  older ones keep only their label. `project.save` writes `history.json` (labels up to the current
  entry) into the `.statly` zip; after `project.load` only the current snapshot is restorable and the
  earlier entries are a read-only change log.
