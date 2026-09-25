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

## Rater agreement + education (`agreement.py`, `education.py`; R: `fixtures/r/agreement_education.R`)
Tests: `tests/stats/test_agreement_education.py` (fixtures in `fixtures/expected/agreement_education/`, matched by key + term).
- **Agreement data:** `raters` = one column per rater, one row per rated case; complete cases (psych/irr), drops counted.
  Two-sided only. Benchmarks: Landis & Koch (1977) for kappa and W, Koo & Li (2016) for ICC, custom interpretation
  text with a stakes caveat (magnitude enum mapped: slight→negligible, fair→small, moderate→medium, ≥ substantial→large).
- **icc** = `psych::ICC(lmer = FALSE)` (ANOVA mean squares, as SPSS; psych's lmer default differs only when a variance
  component is negative). All six Shrout-Fleiss forms + psych CIs; `options.form` headline (default ICC2);
  `F_one_way`, `F_two_way`, `F_raters` statistics.
- **cohen_kappa** = `psych::cohen.kappa`: unweighted, linear (w.exp 1), quadratic (w.exp 2), CI est ± z·SE clipped to
  [-1, 1]; z/p = `irr::kappa2` (SE under H0). `options.weights` picks the headline. Categories = those used, value-label
  order else sorted (an unobserved extreme category is not added; weights follow psych/irr).
- **fleiss_kappa** = `irr::kappam.fleiss` (z, p) + unrounded per-category kappas (`category_kappa`, term = category);
  CI κ ± z·SE0 clipped to [-1, 1] (DescTools::KappaM convention).
- **kendall_w** = `irr::kendall(correct = TRUE)` (tie-corrected W, χ² = m(n-1)W). Agreement use (raters = blocks), not the
  Friedman effect size. CI: bootstrap over **cases** (`boot`, R = 2000, seed 12345, perc; all-equal replicates → [W, W]).
  effectsize resamples blocks (= raters), which pins the lower bound at W with 3-5 raters, so it is not used.
- **gain_score:** gain = post − pre; wide (`measures` [pre, post], optional `group`) or long (reuses `ttests._paired_long`
  linking). Paired t (tails honoured), mean gain (t CI), d_av, d_z. Grouped: per-group paired t / `mean_gain` (term), gains
  compared with Welch t + Hedges' g (2 groups) or Welch F (3+). Long layout + group is not supported.
- **normalized_gain** (`options.max_score` required, scores in [0, max]): headline Hake class-average g; mean individual g
  (pre = max excluded, counted; losses kept as negative g); Marx & Cummings c (losses / pre; pre = post = max or 0
  excluded). Percentile bootstrap (resample people, R = 2000, seed reset per group) reproduced draw for draw with
  `RRandom`, so CIs match R to ~1e-12. Hake bands low < .3 ≤ medium < .7 ≤ high.

## ANCOVA / MANOVA (`ancova.py`, `quade.py`, `manova.py`, `assumptions_multivariate.py`; R: `fixtures/r/ancova_manova.R`)
Registered through the import line in `stats/__init__.py`. Complete cases on outcome(s), group and covariates. Two-sided only.
- **ancova** (`outcome`, `group`, `covariates` 1+): `car::Anova(lm(y ~ covs + group), type = 3)`, contr.sum. No interactions,
  so Type III = drop-one-term SS. Statistics: group F (headline, `term` = group label), one F per covariate, then the
  pairwise `t` per pair. Adjusted means = `emmeans(fit, "group")` (covariates at their means) in
  `chart_data.adjusted_means`. Pairs = `pairs(emm, adjust=)`, first minus second: `options.adjust` holm (default) /
  bonferroni (Bonferroni CIs, as emmeans) / tukey (ptukey on |t|√2, k means; exact q for the CI).
  Effects per term: partial η², partial ω² = max(0, (SS - df MSE)/(SS + (N - df) MSE)), Cohen's f (group); two-sided CIs.
- **Assumptions**: equal slopes = joint group × covariate F (`anova(fit, fit + g:cov)`), failure also warns
  `slopes_differ`; linearity = F for adding x² within each group × covariate; Levene (median) and Shapiro-Wilk on the
  model residuals (SPSS-like "error variance", not raw y).
- **ancova.quade**: Quade (1967)/Conover: rank y and each covariate (average ranks), regress rank(y) on the covariate
  ranks ignoring groups, one-way ANOVA of the residuals (F on k - 1, N - k). η², ω², f of that ANOVA. No CRAN function;
  `stats::quade.test` is a *different* (block-design) test, so the reference is plain `lm` + `anova` on ranks.
- **manova** (`outcomes` 2+, `group`) / **mancova** (+ `covariates`): `car::Manova(lm(cbind(...) ~ g [+ cov]), type = 3)`.
  H = SSPE(without term) - SSPE(full). Keys `pillai` (headline), `wilks`, `hotelling_lawley`, `roy`, each with `<key>_F`
  (approx F, df, p; car's Pillai/Wilks(Rao)/HL/Roy formulas); MANCOVA adds `pillai`/`pillai_F` per covariate term.
  Partial η² (Pillai) = F df1/(F df1 + df2) = V/s (`effectsize::eta_squared(Manova)`). Follow-ups `F_univariate` per
  outcome (Type III ANOVA/ANCOVA), `p` Bonferroni-adjusted across outcomes (raw p in `chart_data.univariate_followups`).
- **Multivariate assumptions**: Box's M (`heplots::boxM` χ², judged at .001), Mahalanobis D² of residuals with
  S = SSPE/df_e flagged at χ²(p) .999, largest |r| between outcomes (> .90 fails), Shapiro-Wilk + Levene per outcome's
  residuals, MANCOVA equal slopes (Pillai F of the interaction). Multivariate normality is not tested (a note only).
- **Tolerance**: all 21 fixtures within 1e-6 (observed < 1e-8). effectsize's optim CI bounds can miss by ~6e-3 here, so
  fixtures record the exact noncentral-F inversion (as for ANOVA); effectsize's bounds are kept as `effectsize_ci_*`.

## Factorial, mixed, ART, simple effects (`anova_factorial.py`, `anova_mixed.py`, `art.py`, `posthoc_simple.py`; R: `fixtures/r/factorial.R`)
Roles: between = `outcome` + `factors` (exactly 2); mixed = wide `measures` + `between`, or long `outcome`/`time`/
`subject_id`/`between`. Complete cases, counts reported. Two-sided only. Term labels "A", "B", "A × B".
- **anova.factorial** = `car::Anova(lm(y ~ A*B), type = 3)` under `contr.sum` (= `afex::aov_car`, asserted). Type III SS
  = RSS increase when a term's effect-coded columns are dropped, so unbalanced cells are exact (`unbalanced_design`
  warning). An **empty cell** is refused (InvalidParams naming the cell), as car/afex refuse the aliased model.
  Levene (median) across the a × b cells; Shapiro-Wilk on model residuals. Per term: partial eta² (headline),
  partial omega² = (SS - df MSE)/(SS + (N - df) MSE), Cohen's f; two-sided CIs via `effect_sizes_anova.pve_ci`.
  `chart_data`: `marginal_means` (emmeans: unweighted means of cell means, pooled MSE, df N - ab) and
  `interaction_plot` (cell emmeans; x = first factor, series = second).
- **anova.mixed** = `afex::aov_ez(between, within, type = 3)`: car's multivariate-approach univariate tests. Time =
  Type III intercept of `Y C ~ group` (b0 = unweighted mean of group contrast means), group × time = between-group
  SSP trace, error = pooled SSPE trace. Mauchly/GG/HF from the pooled contrast covariance with error df N - G (car;
  HF-Lecoutre, capped at 1), shared by time and group × time; `options.correction` as RM ANOVA. Box's M =
  `heplots::boxM` (verdict at .001; installed from CRAN for the fixtures and cross-checked by a hand formula in R).
  Levene and residual Shapiro-Wilk per time point. Effects: partial eta², generalized eta² (afex `ges`), partial
  omega² (effectsize strata formula), Cohen's f. EMMs use afex's default `emmeans_model = "multivariate"`.
- **anova.art** = `ARTool::art` + `anova()`: align per effect (residual + inclusion-exclusion estimate from
  observation-weighted means), round to 8 dp (ARTool `rank.comparison.digits`), average ranks, full model on the
  ranks, keep the aligned-for term. Between: Type III lm. Mixed: ARTool's `Error(id)` aov is **Type I by stratum**
  (group; then time, group × time) and Statly matches it (= Type III with equal groups). Effect: partial eta²
  implied by F. ART-C contrasts (`art.con`) are not implemented.
- **posthoc.simple_effects**: per level of `options.by`, a joint F (`emmeans::joint_tests(by =)`) plus pairwise t
  (`pairs(emmeans(~ X | by))`), `options.adjust` holm (default)/bonferroni **within each by level**, Bonferroni CIs.
  Between: pooled MSE, df N - ab (default by = second factor). Mixed: afex's default **multivariate** emmeans model
  (pooled within-group covariance S, df N - G; afex's `"univariate"` option would pool strata with Satterthwaite df).
  `by` = "between"/group var (default: time within each group; paired contrasts via S) or "within"/"time"/time var.
  joint_tests prints F to 3 dp, so fixtures recompute the Wald F from emmeans' contrasts + vcov (checked to 1e-3).
- **Tolerance**: 28 fixtures within 1e-6 (observed < 1e-8). effectsize's optim CI bounds can miss by ~3e-3 (ART
  F_to_eta2); fixtures record the exact inversion and keep effectsize's as `effectsize_ci_*`.

## Regression (`regression.py`, `regression_logistic.py`, `assumptions_regression.py`; R: `fixtures/r/regression.R`)
Registered through the import line in `stats/__init__.py`. Complete cases on all model variables; tails two-sided.
- **Design:** a predictor is categorical if in `options.categorical`, nominal / text in metadata, or (no metadata)
  a non-numeric column. Treatment (dummy) coding, reference = first level (value-label order, else sorted) or
  `options.reference = {var: value}`. Terms: `var`, `var[level]`, `(Intercept)`. `chart_data.dummy_coding` (one
  record per level x dummy) + a "Dummy Coding of X" table for the UI. Aliased columns and n <= p -> InvalidParams.
- **regression.linear** = `lm` + `summary.lm` (b, SE, t, p, CI). beta = SPSS "Beta" =
  `standardize_parameters(method = "basic")` = b SD(column)/SD(y), dummies included, CI scaled alike. R² CI =
  two-sided noncentral-F inversion (`F_to_eta2(alternative = "two.sided")`, exact root); f² = R²/(1 - R²).
  Headline `F`; `t` per term; effects `r_squared`, `adj_r_squared`, `f_sq`, `beta` (termed).
- **regression.hierarchical**: roles `block_1`..`block_6` (filled in order), nested `lm`s on the same cases;
  ΔR², ΔF, p = `anova(prev, cur)` (block 1 vs intercept-only), local f² = ΔR²/(1 - R²_block). Headline =
  last block's `F_change`; final model reported as linear; `chart_data.blocks` + `block_coefficients`.
- **regression.logistic** = `glm(binomial)` by IRLS as `glm.fit` (logit clamp at |eta| > 30, epsilon 1e-12).
  Event = second level or `options.event`. Wald `z`; OR CIs = exact profile-likelihood roots (confint()'s spline
  kept in fixtures as `confint_*`, within 1e-3). Headline LR `chi2` vs null; Cox-Snell and Nagelkerke R² (no CI);
  classification at p >= .5; Hosmer-Lemeshow (`hoslem.test`, g = 10). Separation (fitted p within 1e-8 of 0/1 or
  no convergence) -> estimates kept, CIs null, serious `perfect_separation` warning. `few_events` when EPV < 10.
- **regression.ordinal** = `MASS::polr(Hess = TRUE)` (logit P(Y <= j) = zeta_j - x'b). Newton with the analytic
  Hessian; fixtures refine polr's optim to reltol 1e-14 (default polr is within 1e-3). p = normal approximation
  of polr's t = b/SE. ORs with exact profile CIs, thresholds + SEs, LR chi² vs thresholds-only model, pseudo-R².
  3+ outcome levels.
- **Assumptions** (`AssumptionResult`, keys): residual `shapiro_wilk` (+ Q-Q), `reset` (`lmtest::resettest`,
  fitted² and ³), `breusch_pagan` (studentized `bptest`), `vif` (`car::vif` GVIF; statistic = max GVIF^(1/Df);
  < 5 passed, 5-10 caution, >= 10 failed), `cooks_distance` (cutoff 4/n; any > 1 failed), `hosmer_lemeshow`,
  `brant` (`brant::brant`, omnibus + per coefficient in `chart_data.brant`). Scatter data: `residuals_vs_fitted`.
  Not implemented: Box-Tidwell (linearity of the logit), Durbin-Watson.

## Validity: EFA / CFA (`efa.py`, `cfa.py`, `factor_utils.py`; R: `fixtures/r/factor.R`, fixtures in `expected/factor/`)
All in-house (factor_analyzer is GPL; semopy was evaluated: MIT with permissive deps, but its SLSQP fit stops ~4e-4
from lavaan and lacks SRMR / RMSEA CI / standardized SEs, so it is not used and no dependency was added).
- **validity.efa** = `psych::fa` on pairwise correlations, n = rows with any answer. KMO = `psych::KMO`, Bartlett =
  `psych::cortest.bartlett(R, n)`. Extraction `options.extraction` minres (default) | ml | pa; minres/ml minimise
  psych's objectives over uniquenesses in [.005, 1] (L-BFGS-B, tighter than psych), pa is psych's loop verbatim.
  Rotation `options.rotation` oblimin (default; GPArotation GPFoblq "bb", ported line by line) | varimax
  (`stats::varimax`, Kaiser-normalized) | promax (`psych::kaiser` + Promax, power 4) | none. Final orientation as
  psych: each factor signed so its column sum is positive, sorted by SS loadings (diag(Phi L'L) when oblique).
  h² from the unrotated loadings, u² = 1 - h², % variance = SS / p. `options.suppress` (.30) blanks table cells only.
- **Parallel analysis** (always run; drives `n_factors` when not given) = `psych::fa.parallel(fa = "fa",
  fm = "minres", n.iter = 100, quant = .95)` after `set.seed(options.seed = 12345)` with `options(mc.cores = 1)`
  (psych's default mclapply forks and changes the stream). `RRandom` + `factor_utils.rnorm` reproduce the column
  resamples and `rnorm` (Inversion) draw for draw. Suggestion = leading observed eigenvalues above the 95th percentile.
- **validity.cfa** = `lavaan::cfa(std.lv = FALSE)`: ML (S / N), marker = first item per factor, listwise deletion,
  Fisher scoring; expected-information SEs; std.all with delta-method SEs; chi2 = N Fmin, CFI, TLI (untruncated),
  RMSEA (N, not N - 1) + 90% CI, SRMR (Bentler, observed SDs). `options.model` = {factor: [items]} (default one factor).
- **Chart data:** EFA `scree` (eigenvalue, factor_eigenvalue, simulated_mean/p95, fitted_factor_eigenvalue),
  `loadings` (long), `communalities` (+ item KMO), `variance`, `factor_correlations`. CFA `loadings`,
  `residual_variances`, `factor_variances`, `factor_covariances`, `fit_indices`, and `path_diagram`: records with
  `kind` "node" (id, label, node_type latent|observed, residual = std residual variance) or "edge" (from, to,
  edge_type loading|covariance, weight = standardized value, estimate, p, marker).
- **Warnings:** `factor_sample_size` (n < 100), `few_items_per_factor` (< 3 salient items), `low_sampling_adequacy`
  (KMO < .60), `bartlett_not_significant`, `cross_loadings`, `weak_items`/`weak_loadings`, `heywood_case`,
  `not_converged`, `saturated_model`, `missing_data`.
- **Tolerance:** KMO/Bartlett/eigenvalues 1e-6; fitted values 1e-4. Observed max: EFA 9.7e-5 (simulated 95th
  percentile, n = 60: psych's loose optim on near-Heywood random-data fits), everything else <= 2e-5; CFA 2e-6.

## Power (`power.py`; R: `fixtures/r/power.R`) — dataset-free
- Registered with `roles=[]`, `needs_data=False`: `registry.run(None, request)` calls `fn(None, req, None)`;
  `analysis.run` skips the dataset lookup and `dataset_id` / `snapshot_id` may be null (a subset is refused).
- **Modes** (`options.mode`): `a_priori` (effect, alpha, power -> n) and `sensitivity` (n, alpha, power -> smallest
  detectable effect). **No post hoc power:** "observed" power is a one-to-one function of the p-value, so it adds
  nothing and invites misreading a non-significant result; `mode: post_hoc` returns InvalidParams pointing to sensitivity.
- **Rounding:** the exact root (Brent, xtol 1e-11) is reported as `n_exact`; the plan is the next whole number
  (`n_required`), with `achieved_power` at it. Unequal groups: n1 rounded up, n2 = ceiling(ratio × n1). RM/mixed: total
  N rounded up to a multiple of k (equal groups). Regression: v rounded up, N = v + p + 1.
- **Matches:** `power.t_test` = `pwr.t.test` (independent, paired d_z, one-sample) / `pwr.t2n.test` (allocation ratio,
  unequal n2 in sensitivity); `power.anova` one_way = `pwr.anova.test` (n per group); `power.correlation` = `pwr.r.test`
  (pwr's Fisher-z approximation, not G*Power's exact test; warning); `power.chi_square` = `pwr.chisq.test` (df from
  `df`, `rows`×`columns` or `categories`); `power.regression` = `pwr.f2.test` with u = tested predictors, v = N − p − 1,
  λ = f²(u + v + 1). For ΔR² G*Power uses λ = f²N (slightly more power; warning). For R² (u = p) the two agree.
- **RM / mixed** (`design` rm_within | rm_between | mixed_interaction; `groups`, `measurements`, `correlation` ρ,
  `epsilon` ε): G*Power 3's univariate formulas (Faul et al., 2007, Table 3; G*Power's default effect-size convention,
  not "as in SPSS"). One common ρ and a single ε are assumptions; flagged with an `approximation` warning.
- **Output:** statistics (headline `n_required` or `detectable_effect`, then n_exact/n_total/achieved power, critical
  value with df, ncp), the effect with Cohen's benchmark + field-norms caveat, a benchmark table (n needed for
  small/medium/large), an inputs table, plain summary, APA sentence/table, `chart_data.power_curve` (power vs n for the
  planned effect and the three benchmarks). F and chi-square tests must be two-sided.
- **Fixtures:** exact uniroot (tol 1e-12) on pwr's own power function at 1e-6 (pwr's default-tol answer kept as
  `pwr_solution`); hand-R G*Power formulas at 1e-6; `gpower_*.json` = printed G*Power results from Faul et al. (2007)
  pp. 181, 183, checked at max(1e-3, half a printed unit).
