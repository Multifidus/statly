# Adding an analysis (SPEC §8, §12)

An analysis is a pure function `fn(df, request, meta) -> dict`, registered by id and built with
`ResultBuilder`. `ttests.py` is the worked example; copy its shape.

| Module | Role |
|---|---|
| `registry.py` | `@register(id, label=, roles=, options=)`; role validation; `run()` applies `request.subset` |
| `core.py` | `ResultBuilder`, Cohen benchmarks + field-norms caveat, standard warnings |
| `apa.py` | APA number formats (`p_value`, `no_zero`, `df_text`, `ci_text`), `Rich` runs, table cells |
| `prep.py` | `numeric()` / `categorical()` (blank + missing codes = missing), `level_order()`, labels |
| `effect_sizes.py` | d, g, Glass's delta, d_z, d_av, r from t, `nct_ci`, `ncf_ci`, `partial_pve` |
| `assumptions.py` | Shapiro-Wilk, Lilliefors KS, Levene/Brown-Forsythe, Q-Q + histogram chart data |
| `descriptives.py` | `cell()` for `AnalysisResult.descriptives`; the `descriptives` analysis |

## Steps (example: Mann-Whitney U, id `mann_whitney`)
1. **Module.** Create `stats/nonparametric.py` and add it to `ANALYSIS_MODULES` in `registry.py`.
2. **Register.** Copy `ttests.independent`: `@register("mann_whitney", label="Mann-Whitney U test",
   roles=[Role("outcome", 1, 1, "..."), Role("group", 1, 1, "...")], options={...})`. Alternative
   layouts: `roles={"wide": [...], "long": [...]}` (see `t_test.paired`).
3. **Data.** `y = prep.numeric(df, name, meta)`, `g = prep.categorical(df, gname, meta)`,
   `levels = prep.level_order(g, gname, meta, request.options.get("levels"))`. Raise
   `InvalidParams` (plain-language message) when the design can't be analysed (e.g. not 2 groups).
   Missing data is pairwise; paired designs use complete cases and report what was dropped.
4. **Compute** with scipy/statsmodels/numpy only (no pingouin, factor_analyzer, or new deps).
   Direction is R's `x - y`, x = first level. Honour `request.tails` / `ci_level` / `alpha`.
5. **Build.** `b = ResultBuilder(request)`, then:
   - `b.statistic(key, label, symbol, value, [df], p)`: headline first. Use distinct keys for
     variants (`welch_t`, `student_t`); `term` only for multi-term models.
   - `b.effect(key, label, symbol, Estimate, family="d"|"r"|"eta_sq"|...)`: adds the benchmark
     interpretation. Every effect needs a CI (`Estimate.lower/upper`); null only if no method exists.
   - `b.descriptives([cell(var, {gvar: level}, label, values, ci_level)])`.
   - `b.assumption(*asm.shapiro_wilk(values, asm.scope("group", label, {gvar: level}), alpha))`
     (per group, or `"differences"` for paired). Charts ship in `chart_data`.
   - `b.warn(small_sample_warning(counts))`, `unequal_groups_warning`, `ties_warning`,
     `missing_warning`, or `core.warning(code, severity, msg)` for your own (e.g. `pairs_dropped`).
   - `b.inputs(n_used, n_excluded, [(group_dict, n), ...])`, `b.summary(text)`,
     `b.sentence(Rich)`, `b.table(apa.table(title, columns, rows, column_groups=, general_note=))`.
   - `return b.build()`: validates against `contracts/AnalysisResult.json` and adds engine version,
     timestamp and the inputs echo.
6. **APA rules** (SPEC §10.1): symbols italic via `Rich().i("U")`; `p` via `Rich.p()` / `apa.cell_p`
   (3 decimals, `< .001`); bounded values (r, rank-biserial) via `no_zero`; other stats 2 decimals;
   fractional df via `df_text`. The plain-language summary comes first, grade 8-10 wording.

## R reference fixtures (tolerance 1e-6; 1e-4 for iterative methods)
7. **Data.** Add any new CSV to `fixtures/r/datasets.R` (seeded, rounded values, blank = missing).
   Reuse the existing ones where possible: ties, n = 5, unequal groups, missing values, a
   constant group, a single group, a long paired layout.
8. **Script.** Create `fixtures/r/<family>.R` (copy `ttests.R`): `load_dataset()`, compute with the
   R function whose defaults you document, and call `write_fixture("<analysis_id>", "<case>",
   list(analysis_id, case, dataset, request = req(variables, options, tails, ci), expected = list(
   n_used, n_excluded, statistics = list(stat_rec(...)), effect_sizes = list(es_rec(...)),
   descriptives = list(desc_rec(...)), assumptions = list(shapiro_rec(...))), error = NULL))`.
   For inputs R rejects, write `expected = NULL, error = <message>` (use `error_fixture`).
   Add the script to `run_all.R`, then run `Rscript fixtures/r/run_all.R` (deterministic output).
9. **Noncentral-t CIs.** effectsize finds them with Nelder-Mead, which can miss the root by 1e-3.
   Record the exact inversion with `es_rec_nct()` / `es_rec_r()`. Its own bounds are kept as
   `effectsize_ci_*`, for information only.

## Tests (`engine/tests/stats/`)
10. Add the analysis dir to `ANALYSIS_DIRS` in `test_fixtures_r.py`. Every JSON case is then
    parametrized and checked by `assert_matches_fixture` (statistics by key, effects by key,
    descriptives by variable + group, assumptions by test + scope, n_used / n_excluded). Error
    fixtures expect `InvalidParams`, or a `constant_variable` warning with a null statistic.
11. Add one APA snapshot case to `test_apa_snapshots.py` (`STATLY_UPDATE_SNAPSHOTS=1` to accept).
12. Run `.venv/bin/python -m pytest` from `engine/`. `analysis.run` / `analysis.list` pick the analysis
    up automatically through the registry; no RPC changes are needed.

## Conventions already decided
- Skewness/kurtosis are G1/G2 (psych type 2, SPSS). Quartiles are R type 7 (not SPSS's type 6).
- Welch's t is the default headline, with Student's also reported. Levene uses median centring (car default).
- Normality verdicts: p >= alpha passed; p < alpha failed, but caution when n >= 100 (`LARGE_N`).
- Glass's delta is unadjusted (effectsize default is adjusted). d_av uses a normal-approximation CI
  (as in effectsize). eta² family: `partial_pve` reproduces effectsize's one-sided default.
