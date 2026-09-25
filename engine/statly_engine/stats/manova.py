"""MANOVA and MANCOVA (SPEC §8). Reference: fixtures/r/ancova_manova.R.

Conventions (see also stats/README.md, "ANCOVA / MANOVA"):
- Model: car::Manova(lm(cbind(y1, ..., yp) ~ group [+ covariates]), type = 3) under contr.sum. No interaction
  terms, so a term's hypothesis SSCP H = SSPE(model without the term) - SSPE(full model).
- Tests on the eigenvalues of E^-1 H (car:::Pillai / Wilks / HL / Roy, i.e. the formulas of
  stats::summary.manova): Pillai's trace V (headline), Wilks' lambda (Rao's F), Hotelling-Lawley trace, Roy's
  largest root (upper-bound F). Each is reported as the statistic (key "pillai", ...) and its approximate F
  (key "pillai_F", ...), df and p, term = group label. MANCOVA adds Pillai's test per covariate.
- Effect size: partial eta² for Pillai = effectsize::eta_squared(Manova) = F df1 / (F df1 + df2) of Pillai's
  approximate F, which equals V / s (s = min(p, df_group)); CI two-sided (noncentral F on df1, df2).
- Follow-ups: per outcome, the univariate Type III ANOVA (ANCOVA for mancova) F for the group
  (car::Anova(lm(y_j ~ group [+ cov]), type = 3)), p Bonferroni-adjusted across the p outcomes (statistic key
  "F_univariate", p = adjusted; chart_data.univariate_followups keeps raw and adjusted p), with partial eta².
  MANCOVA also gives adjusted means per outcome (emmeans).
- Missing data: complete cases on every outcome, the group and the covariates.
- Assumptions (assumptions_multivariate.py): Box's M (judged at .001), multivariate outliers (Mahalanobis D²,
  p < .001), outcome correlations (|r| > .90), Shapiro-Wilk and Levene (Brown-Forsythe) on each outcome's model
  residuals, and for MANCOVA the multivariate equal-slopes test. Multivariate normality is not tested
  (no dependency-free test matches R); the univariate residual checks and Q-Q plots stand in, as stated.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from statly_engine.errors import InvalidParams
from statly_engine.stats import apa, assumptions as asm, assumptions_multivariate as amv, effect_sizes_anova as esa
from statly_engine.stats.ancova import (ancova_fit, adjusted_mean_records, check_rank, data_inputs, data_warnings,
                                        group_descriptives, model_data, LEVELS_OPT)
from statly_engine.stats.anova import p_phrase, require_two_sided
from statly_engine.stats.apa import Rich
from statly_engine.stats.core import ResultBuilder, magnitude, warning
from statly_engine.stats.registry import Role, register

ETA_P = Rich().t("η").sup("2").sub("p")
TESTS = [("pillai", "Pillai's trace", "V"), ("wilks", "Wilks' lambda", "Λ"),
         ("hotelling_lawley", "Hotelling-Lawley trace", "T"), ("roy", "Roy's largest root", "Θ")]

MANOVA_ROLES = [Role("outcomes", 2, None, "Two or more related outcome scores"),
                Role("group", 1, 1, "Grouping variable with two or more groups")]
MANCOVA_ROLES = MANOVA_ROLES + [Role("covariates", 1, None, "Score(s) to adjust for (e.g. pre-test)")]


def _run(df: pd.DataFrame, request, meta, with_covs: bool) -> dict:
    what = "A MANCOVA" if with_covs else "A MANOVA"
    require_two_sided(request, what)
    level, alpha = request.ci_level, request.alpha
    covs = request.variables.get("covariates", []) if with_covs else []
    d = model_data(df, request, meta, request.variables["outcomes"], covs)
    k, codes, Y, C = d["k"], d["codes"], d["Y"], d["C"]
    n, p = Y.shape
    contr = amv.sum_contrasts(codes, k)
    blocks = [C[:, [c]] for c in range(C.shape[1])] + [contr]
    X, sl = amv.design(blocks)
    check_rank(X, d)
    df_e = n - X.shape[1]
    if df_e < p:
        raise InvalidParams(f"{what} with {p} outcomes needs at least {X.shape[1] + p} complete rows; there are {n}.")
    fitted = amv.fit(X, Y)
    R = fitted["resid"]
    E = R.T @ R
    if np.linalg.matrix_rank(E) < p:
        raise InvalidParams("The outcomes are exact combinations of each other (or one has no spread within the "
                            "groups), so a MANOVA can't separate them. Remove the redundant outcome.")
    gl = d["gl"]
    b = ResultBuilder(request)
    group_descriptives(b, d, level)

    def term_tests(s: slice) -> tuple[dict, int]:
        H = amv.rss(amv.drop(X, s), Y) - E
        q = s.stop - s.start
        return amv.multivariate_tests(H, E, q, df_e), q

    tg, qg = term_tests(sl[-1])
    for key, lab, sym in TESTS:
        st, f, d1, d2, pv = tg[key]
        b.statistic(key, lab, sym, st, [d1, d2], pv, term=gl)
        b.statistic(f"{key}_F", f"{lab}: approximate F", "F", f, [d1, d2], pv, term=gl)
    v, fg, d1g, d2g, pg = tg["pillai"]
    pes = esa.pve_ci(fg * d1g / (fg * d1g + d2g) if math.isfinite(fg) else 1.0, d1g, d2g, level)
    b.effect("partial_eta_sq", "Partial eta squared (Pillai)", "η²p", pes, "eta_sq", term=gl, what="effect")
    cov_tests = []
    for c, cl in enumerate(d["cl"]):
        tc, _ = term_tests(sl[c])
        st, f, d1, d2, pv = tc["pillai"]
        b.statistic("pillai", "Pillai's trace", "V", st, [d1, d2], pv, term=cl)
        b.statistic("pillai_F", "Pillai's trace: approximate F", "F", f, [d1, d2], pv, term=cl)
        e = esa.pve_ci(f * d1 / (f * d1 + d2) if math.isfinite(f) else 1.0, d1, d2, level)
        b.effect("partial_eta_sq", "Partial eta squared (Pillai)", "η²p", e, "eta_sq", term=cl, what="effect")
        cov_tests.append((cl, st, f, d1, d2, pv))

    # univariate follow-ups
    uni, adj_recs = [], []
    for j, (yv, yl) in enumerate(zip(d["outcomes"], d["ol"])):
        m = ancova_fit(Y[:, j], C, codes, k, level)
        t = m["terms"][0]
        padj = min(1.0, p * t["p"]) if t["p"] is not None else None
        b.statistic("F_univariate", f"F (follow-up {'ANCOVA' if with_covs else 'ANOVA'}, Bonferroni-adjusted p)", "F",
                    t["F"], [t["df"], m["df_e"]] if t["F"] is not None else [], padj, term=yl)
        b.effect("partial_eta_sq", "Partial eta squared (follow-up)", "η²p", t["eta"], "eta_sq", term=yl, what="effect")
        uni.append({"outcome": yl, "F": t["F"], "df1": float(t["df"]), "df2": float(m["df_e"]), "p": t["p"],
                    "p_bonferroni": padj, "partial_eta_sq": t["eta"].value, "ci_lower": t["eta"].lower,
                    "ci_upper": t["eta"].upper, "ss": t["ss"], "mse": m["mse"]})
        if with_covs:
            adj_recs.extend(adjusted_mean_records(m, d, yl))
    b.chart("univariate_followups", uni)
    if with_covs:
        b.chart("adjusted_means", adj_recs)

    # assumptions
    if with_covs:
        b.assumption(amv.slopes_test(Y, C, contr, alpha))
    b.assumption(amv.box_m(Y, codes, k, d["names"]))
    mres, d2 = amv.mahalanobis(R, df_e)
    b.assumption(mres)
    b.chart("mahalanobis", [{"row": i + 1, "group": d["names"][codes[i]], "d2": float(x)} for i, x in enumerate(d2)])
    b.assumption(amv.outcome_correlations(Y, d["ol"]))
    normal_ok = True
    for j, yl in enumerate(d["ol"]):
        res, charts = amv.residual_normality(R[:, j], f"residuals: {yl}", alpha, chart_prefix=f"resid{j + 1}")
        normal_ok &= res["verdict"] != "failed"
        b.assumption(res, charts)
        lev, _ = asm.levene_brown_forsythe({nm: R[codes == g, j] for g, nm in enumerate(d["names"])},
                                           asm.scope("overall", yl), alpha,
                                           failed_note="Pillai's trace is the most robust test when this happens.")
        b.assumption(lev)
    b.assumption({"schema_version": 1, "assumption": "multivariate_normality", "label": "Multivariate normality",
                  "test_used": None, "statistic": None, "p": None, "verdict": "passed" if normal_ok else "caution",
                  "explanation": ("Multivariate normality is not tested directly. "
                                  + ("Each outcome's residuals look roughly bell-shaped, which is necessary (though "
                                     "not sufficient); with about 20 or more people per group MANOVA is fairly "
                                     "robust to this." if normal_ok else
                                     "At least one outcome's residuals are not bell-shaped, so multivariate "
                                     "normality is doubtful. Pillai's trace is the most robust test; check the Q-Q "
                                     "plots and the outliers.")),
                  "applies_to": asm.scope("residuals", "residuals", None, n), "chart_refs": []})
    data_warnings(b, d)
    if any(a["verdict"] == "failed" for a in b.assumptions if a["assumption"] == "homogeneity_of_regression_slopes"):
        b.warn(warning("slopes_differ", "caution", "The covariate relates to the outcomes differently in different "
                       "groups (the equal-slopes check failed), so the adjusted comparison can mislead."))
    data_inputs(b, d)

    # text
    covtxt = " and ".join(d["cl"])
    outs = ", ".join(d["ol"][:-1]) + f" and {d['ol'][-1]}"
    sig = pg < alpha
    r = Rich().t(f"A one-way {'MANCOVA controlling for ' + covtxt if with_covs else 'MANOVA'} on {outs} showed "
                 f"{'a significant' if sig else 'no significant'} multivariate effect of {gl}, Pillai's ").i("V") \
        .t(f" = {apa.no_zero(v)}, ").stat("F", [d1g, d2g], fg).t(", ").p(pg)
    if pes.value is not None:
        r.t(", ").es(ETA_P, pes.value, pes.lower, pes.upper, level, bounded=True)
    r.t(".")
    sig_uni = [u["outcome"] for u in uni if u["p_bonferroni"] is not None and u["p_bonferroni"] < alpha]
    mag = magnitude(pes.value, "eta_sq")
    summary = (f"The {k} groups of {gl} were compared on {len(d['ol'])} outcomes at once ({outs})"
               + (f", adjusting for {covtxt}" if with_covs else "") + ". "
               + ("Taken together, the groups differ by more than chance would explain" if sig else
                  "Taken together, the differences could easily be due to chance, so there is no strong evidence "
                  "that the groups differ") + f" ({p_phrase(pg)}, Pillai's trace)."
               + (f" The size of the effect was {mag} by common benchmarks." if mag else ""))
    if sig:
        summary += (" Follow-up tests (Bonferroni-adjusted) show differences on: " + ", ".join(sig_uni) + "."
                    if sig_uni else " No single outcome differs clearly on its own after the Bonferroni adjustment.")
    b.sentence(r).summary(summary)

    cols = [apa.column("test", "Test", "left"), apa.column("value", "Value"), apa.column("f", Rich().i("F")),
            apa.column("df1", Rich().i("df").sub("1")), apa.column("df2", Rich().i("df").sub("2")),
            apa.column("p", Rich().i("p"))]
    body = [apa.row([apa.cell_text(Rich().t(f"{gl}"))] + [apa.cell_empty()] * 5, kind="section_header")]
    for key, lab, _ in TESTS:
        st, f, d1, d2, pv = tg[key]
        body.append(apa.row([apa.cell_text(lab), apa.cell_num(st, 3), apa.cell_num(f), apa.cell_df(d1),
                             apa.cell_df(d2), apa.cell_p(pv)], indent=1))
    for cl, st, f, d1, d2, pv in cov_tests:
        body.append(apa.row([apa.cell_text(cl)] + [apa.cell_empty()] * 5, kind="section_header"))
        body.append(apa.row([apa.cell_text("Pillai's trace"), apa.cell_num(st, 3), apa.cell_num(f), apa.cell_df(d1),
                             apa.cell_df(d2), apa.cell_p(pv)], indent=1))
    b.table(apa.table(f"{'MANCOVA' if with_covs else 'MANOVA'} of {outs} by {gl}", cols, body,
                      general_note=Rich().t("Type III sums of squares and cross-products. Pillai's trace is the "
                                            "headline test; ").extend(ETA_P)
                      .t(f" (Pillai) = {apa.no_zero(pes.value)}, {apa.level_text(level)} CI "
                         f"{apa.ci_text(pes.lower, pes.upper, bounded=True)}.")))
    ucols = [apa.column("outcome", "Outcome", "left"), apa.column("f", Rich().i("F")), apa.column("df", Rich().i("df")),
             apa.column("p", Rich().i("p")), apa.column("padj", Rich().i("p").sub("Bonf")), apa.column("eta", ETA_P),
             apa.column("ci", f"{apa.level_text(level)} CI")]
    ubody = [apa.row([apa.cell_text(u["outcome"]), apa.cell_num(u["F"]), apa.cell_text(
        f"{apa.df_text(u['df1'])}, {apa.df_text(u['df2'])}"), apa.cell_p(u["p"]), apa.cell_p(u["p_bonferroni"]),
        apa.cell_num(u["partial_eta_sq"], bounded=True), apa.cell_ci(u["ci_lower"], u["ci_upper"], bounded=True)])
             for u in uni]
    b.extra_table(apa.table(f"Follow-Up {'ANCOVAs' if with_covs else 'ANOVAs'} by Outcome", ucols, ubody, number=2,
                            general_note=Rich().t(f"Type III F test of {gl} for each outcome; ").i("p").sub("Bonf")
                            .t(f" = Bonferroni-adjusted across {p} outcomes.")))
    dcols = [apa.column("var", "Outcome and group", "left"), apa.column("n", Rich().i("n")),
             apa.column("m", Rich().i("M")), apa.column("sd", Rich().i("SD"))]
    dbody = [apa.row([apa.cell_text(rw["label"]), apa.cell_int(rw["n"]), apa.cell_num(rw["mean"]), apa.cell_num(rw["sd"])])
             for rw in b.continuous]
    b.extra_table(apa.table(f"Descriptive Statistics by {gl}", dcols, dbody, number=3))
    return b.build()


@register("manova", label="MANOVA", roles=MANOVA_ROLES, options=LEVELS_OPT)
def manova(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    return _run(df, request, meta, False)


@register("mancova", label="MANCOVA", roles=MANCOVA_ROLES, options=LEVELS_OPT)
def mancova(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    return _run(df, request, meta, True)
