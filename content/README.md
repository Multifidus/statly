# /content

Non-code content reviewed and edited without touching engine code.

## decision_tree.yaml

The Test Advisor's decision tree (SPEC §7.1). This is the single source of
truth for which test Statly recommends for a given design — nothing about
test selection is hard-coded in Python. The engine loads and validates it
(`engine/statly_engine/advisor`) against `decision_tree.schema.json`, then
walks it with a pure function: `(tree, answers) -> next question |
recommendation`.

### Structure

- `root`: the id of the first node.
- `nodes`: a map of node id -> node. Every id is snake_case.

Two node types:

- **`question`** — `text` (asked to the user, plain language), `why` (a
  "Why does this matter?" expander), `options[]` (`value`, `label`,
  `next` node id), and an optional `auto` block.
- **`recommendation`** — `primary_test`, `nonparametric_alternative`
  (nullable), `assumptions[]`, `effect_size[]`, `post_hoc[]`,
  `why_this_test` (plain-language paragraph), `likert_note` (nullable —
  set when the outcome is a single Likert item, SPEC §7.3), `caveats[]`
  (e.g. `aggregate_time_comparison`, SPEC §5.4).

`primary_test`, `nonparametric_alternative`, entries in `assumptions`,
`effect_size`, `post_hoc`, and `caveats` are all snake_case ids owned by
the engine's stats/assumptions/effect-size registries (`engine/`), not
defined here.

### Auto-answered questions

A question can carry an `auto` block so the frontend can pre-fill (and the
user can still override) the answer from variable roles/levels, via
`dataset_context` passed to `advisor.start` / `advisor.answer`:

```yaml
auto:
  field: num_groups            # one of the five dataset_context signals
  rules:
    - when: { equals: 1 }
      value: one
    - when: { equals: 2 }
      value: two
    - when: { min: 3 }
      value: three_plus
```

`field` is one of `outcome_level`, `num_groups`, `num_time_points`,
`linked_mode`, `covariates_present`. `rules` are matched in order against
the dataset_context value for `field`; the first matching rule's `value`
becomes the answer, which must equal one of the question's `options[].value`.
`when` supports `equals`, `min`, `max`, `in` — plain comparisons, not
statistical logic, so test selection still lives entirely in this file.

### Editing

1. Edit the YAML.
2. Run the engine's advisor tests from `engine/`: `.venv/bin/pytest tests/advisor`.
   These validate the file against `decision_tree.schema.json`, check for
   orphan/unreachable nodes and cycles, and walk every path from `root` to a
   recommendation.
3. `advisor.paths` (RPC) enumerates every path for the frontend and the
   Study Planner (SPEC §11.2) — re-run it (or the RPC test) after structural
   changes.

## learn/ (SPEC §11.3)

Markdown pages for every test, assumption, and effect size, owned by a
separate workstream: what it is, when to use it, an everyday analogy, a
worked education example, how to read the output, how to report it in APA,
and common mistakes. Not yet populated by this change.
