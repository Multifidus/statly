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

## ANOVA (`anova.py`, `sphericity.py`, `posthoc_param.py`, `effect_sizes_anova.py`; R: `fixtures/r/anova.R`)
Registered through the import line in `stats/__init__.py` (not `ANALYSIS_MODULES`). Tails must be two-sided.
- **anova.one_way**: Type III SS, sum-to-zero contrasts (`car::Anova(lm, type = 3)`). With one factor
  Type I = II = III, so the closed form is used. Welch's F reported second. Levene (Brown-Forsythe) and
  Shapiro-Wilk per group; descriptives per group; rows missing y or group dropped and counted.
- **anova.welch**: `oneway.test(var.equal = FALSE)` headline, classical F second. Effect sizes from Welch's
  F and df (`effectsize::effectsize(oneway.test(...))`). A zero-variance group gives R NaN: null + warning.
- **anova.repeated_measures** (wide `measures` or long `outcome`/`time`/`subject_id`): `afex::aov_ez`, Type
  III. Complete cases, counts reported. Mauchly's W/p, GG and HF epsilon in-house (`sphericity.py`). HF is
  car's Huynh-Feldt-Lecoutre form, identical to SPSS's original HF with no between factor (they differ
  only in mixed designs), capped at 1 as afex/SPSS do. `options.correction` "auto" (default) makes GG the
  headline when Mauchly's p < alpha (else uncorrected); "none"/"gg"/"hf" force one. F, F_gg, F_hf,
  epsilon_gg, epsilon_hf are all reported.
- **Effect sizes** (`effect_sizes_anova.py`): one-way eta² (= partial eta²), omega², Cohen's f; RM partial
  eta² (headline), generalized eta² (afex `ges`), partial omega², Cohen's f. CIs are **two-sided at
  ci_level** (SPEC 95%) = `effectsize(..., ci = .95, alternative = "two.sided")`. effectsize's default is
  one-sided ("greater"), which Statly does not use. The CI follows effectsize's convention: invert the
  noncentral F at the F implied by the estimate. effectsize uses `optim` for that root (off by up to ~1e-4).
  Fixtures therefore record the exact `uniroot` inversion and keep effectsize's bounds as `effectsize_ci_*`.
- **Post hoc** (one `t` statistic + `mean_difference` + standardized effect per pair, `term` = "A vs B",
  direction first minus second as emmeans; TukeyHSD/rstatix report second minus first):
  `posthoc.tukey` = `TukeyHSD` / `emmeans(adjust = "tukey")` via `scipy.stats.studentized_range`;
  `posthoc.games_howell` = `rstatix::games_howell_test` (in-house; per-pair Welch df, k-mean range);
  `posthoc.pairwise` = `pairwise.t.test(pool.sd = TRUE)` (between) or `(paired = TRUE)` (RM layouts),
  `options.adjust` "holm" (default) / "bonferroni", with Bonferroni-adjusted CIs as emmeans gives for Holm.
  Standardized effect: Hedges' g (pooled over the pair) or d_av for RM, unadjusted CI.
- **Tolerance**: every fixture is within 1e-6. R's `qtukey` stops at eps = 1e-4, so studentized-range CIs
  are recorded from an exact `uniroot(ptukey)` inversion; TukeyHSD/rstatix bounds are kept and checked to 1e-3.
  Avoid fixtures whose noncentral-t bounds exceed |ncp| ≈ 37.6: R's `pnt` loses precision there.

## Nonparametric (`nonparametric.py`, `posthoc_rank.py`, `effect_sizes_rank.py`; R: `fixtures/r/nonparametric.R`)
- **p-values = R 4.6 `wilcox.test` defaults.** Exact when n < 50 (Mann-Whitney: both groups < 50), using the
  exact *conditional* distribution when there are ties or zeros (R >= 4.4 does this; older R fell back to
  normal); else normal approximation, tie-corrected variance, continuity correction. The headline label says
  "exact p" or "normal approximation, continuity corrected".
- **U** = R's W for the first group; **V** = sum of positive signed ranks of x - y (or x - test_value).
- **Zeros (signed rank):** the normal approximation drops them before ranking (R). The exact path ranks |d|
  with zeros included, then leaves zeros out of the null distribution (R's exact code; Pratt-like ranks).
- **z** (reported with U / V) = normal approximation, no continuity correction, zeros dropped.
  **r = z/√N**, N = n1 + n2 or the number of nonzero differences. Its CI = the rank-biserial CI x r/r_rb
  (both are linear in U / V); one-sided open bounds are -1 / 1.
- **Rank-biserial** = `effectsize::rank_biserial`, Fisher-z normal CI. Paired: the reference is
  `rank_biserial(x - y)`. effectsize 1.0.3's `paired = TRUE` CI counts nonzero x values, not nonzero
  differences (a bug; the estimate is unaffected).
- **Sign test** = `binom.test(#positive, #nonzero, .5)`; zeros dropped; effect = proportion positive with
  the Clopper-Pearson CI. Layouts: wide, long, or one-sample (`test_value`).
- **Kruskal-Wallis / Friedman**: tie-corrected chi-square. Friedman uses complete cases, wide or long
  (subjects in first-appearance order). **epsilon²** = H/(n - 1); **Kendall's W** has the tie correction.
- **Bootstrap CIs (epsilon², W)** = effectsize's percentile bootstrap: 200 resamples, one-sided "greater"
  (upper bound 1). `RRandom` reproduces R's RNG (`set.seed`, Mersenne-Twister, rejection `sample.int`) and
  boot's draw order, so the CIs match R to ~1e-11 with the same seed. Options: `bootstrap_seed` (default 12345),
  `bootstrap_iterations`.
- **Post hoc** (PMCMRplus 1.9): Dunn (tie-corrected z) and Conover (t, df = (n-1)(k-1)). Both take
  `options.adjust` = holm (default) / bonferroni / bh / none. Conover also takes "single-step", PMCMRplus's
  default. Nemenyi uses single-step ptukey(df = Inf) with no tie correction. Statistics are signed first
  minus second, `term` = "A - B", and `p` is adjusted. Each pair also reports a rank-biserial.

## Correlation (`correlation.py`; R: `fixtures/r/correlation.R`)
- **Missing:** complete pairs per pair (matrix = pairwise deletion); partial = complete cases on x, y, covariates.
- **Pearson / point-biserial** = `cor.test`: t on n - 2 df, Fisher-z CI (SE 1/√(n-3), needs n >= 4). Point-biserial
  codes the first level 0, second 1 (positive r = second group higher); keys `r_pb`, `t`.
- **Spearman** = `cor.test` defaults: no ties and n <= 1290 -> AS 89 p (exact enumeration n <= 9, Edgeworth
  above; `prho` reproduces R's C code to 1e-15); ties -> t approximation. `S` reported alongside.
- **Kendall tau-b** = `cor.test` defaults: n < 50 and no ties -> exact null distribution of T; otherwise the
  tie-corrected normal z, no continuity correction. Statistic key is `T` or `z` accordingly.
- **Rank-correlation CIs** (R gives none): Fisher z with Fieller et al. (1957) SEs √(1.06/(n-3)) for rho and
  √(0.437/(n-4)) for tau-b, hand-computed in the fixtures.
- **Partial** = `ppcor::pcor.test` (t on n - 2 - k df); Fisher-z CI with SE 1/√(n-3-k); `method` pearson|spearman.
- **Perfect |r| > 1 - 1e-12** snaps to +/-1: t = null, p = 0, CI [r, r] (R's 1 - 2e-16 gives t ≈ 1e8).
- **Matrix:** each pair tested exactly like its bivariate analysis, then `p.adjust` across the k(k-1)/2 pairs
  (`none|bonferroni|holm|fdr_bh`, from a `corrections` entry with scope "matrix", else `options.adjust`). Pearson
  equals `psych::corr.test(adjust=)` (asserted in the R script). psych uses the t approximation for Spearman /
  Kendall; we keep cor.test's p so matrix and bivariate agree. Stars use adjusted p. Output: per-pair
  statistics/effects (`term` = "A × B", raw p), `chart_data.correlation_pairs` (p + p_adjusted, CI, n),
  `correlation_heatmap` (k × k), APA M/SD + lower-triangle table, and a pairs table.

## Categorical (`categorical.py`, `effect_sizes_cat.py`; R: `fixtures/r/categorical.R`)
- Complete cases; `tails` only affects 2 × 2 Fisher. Crosstab table shows n and row %; an extra table gives
  expected counts and SPSS adjusted residuals; `chart_data.crosstab` has every cell.
- **chi_square.independence:** Pearson χ² (uncorrected) headline; 2 × 2 adds Yates (`chi2_yates`, R's
  min(0.5, |O - E|) rule); likelihood-ratio G² always. Warning `low_expected_counts` when > 20% of E < 5 or any E < 1.
- **Cramér's V / phi** = `effectsize::cramers_v / phi(adjust = FALSE)` (classical, unadjusted), effectsize's
  default one-sided CI (upper = 1). The ncp bound is solved exactly (Brent); effectsize's Nelder-Mead bound is
  kept in fixtures as `effectsize_ci_lower`. phi is unsigned (effectsize); direction comes from the sample OR.
- **Sample OR** (2 × 2) = ad/bc, Woolf CI (`effectsize::oddsratio`); null CI with a zero cell.
- **fisher_exact** = `fisher.test`. 2 × 2: p, conditional-MLE OR + exact CI (scipy `odds_ratio(kind=
  "conditional")`), sample OR, phi. fisher.test solves the MLE with uniroot's default tol (~1e-4), so fixtures
  record the same algorithm at tol 1e-14 (R's value kept as `fisher_test_*`). r × c: exact p by enumeration
  (tolerance 1e-7 as R), refused above 2e6 tables. An infinite OR is reported null with a `zero_cell` warning.
- **goodness_of_fit:** equal or `options.expected_proportions` ({value: p} or list; rescaled). Cohen's w (upper
  = √(1/min p - 1)) and Fei, effectsize defaults.
- **mcnemar:** `mcnemar.test` with correction headline (`chi2`), `chi2_uncorrected`, `binomial_exact`
  (binom.test on b of b + c). Cohen's g (Wilson CI, `effectsize::cohens_g`); paired OR b/c with the exact CI.
- **cochran_q:** Q on k - 1 df (= `rstatix::cochran_qtest`, i.e. friedman.test on 0/1); success = second code
  unless `options.success`. No effect size is reported (none with a CI in R).

## Reliability (`reliability.py`; R: `fixtures/r/reliability.R`)
- Items with no variance are dropped with a warning (psych `delete = TRUE`). Alpha, KR-20 and omega use pairwise
  covariances/correlations (psych `use = "pairwise"`); split-half and item analysis use complete cases.
- **cronbach_alpha** = `psych::alpha(check.keys = FALSE)`: raw α headline, standardized α, average r,
  alpha-if-deleted (raw + std, k >= 3), corrected item-total r (`r.drop`), in `chart_data.item_statistics`.
  CI = Feldt (`psych::alpha.ci`), n = respondents with any answer. Negative r.drop -> `reverse_scoring` warning.
- **kr20** = alpha on 0/1 items (equals the KR-20 formula; asserted in R and pytest). Non-0/1 -> InvalidParams.
- **mcdonald_omega** = `psych::omega(nfactors = 1)` **omega_total** (headline) plus omega_h and psych's
  standardized alpha. One-factor minres fit in-house: the principal-axis fixed point psych's optimiser targets
  (uniqueness floor .005), negative loaders flipped as psych. Tolerance 1e-4 (observed 6e-7). Heywood cases
  (communality >= .995) have no unique psych answer (L-BFGS-B stops on a line-search failure), so they carry a
  `heywood_case` warning and are tested at 5e-3. No CI.
- **split_half:** hand-validated (psych::splitHalf only samples random splits). Odd/even Spearman-Brown headline
  (`options.split = "first_second"` switches; first half = ceil(k/2) items), Guttman split-half and r between halves.
- **item_analysis:** 0/1 items, complete cases. Difficulty p, corrected item-total point-biserial, upper-lower
  D with groups total >= 73rd / <= 27th percentile (type 7, ties included), KR-20 if deleted, flags.
- Warnings: `few_items` (k < 3), `small_sample` (n < 30), `factor_sample_size` for omega (n < 100).
