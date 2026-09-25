"""Quade's rank ANCOVA (Quade 1967, as described in Conover 1999), the nonparametric ANCOVA option (SPEC §8).

Reference: fixtures/r/ancova_manova.R (plain lm + anova on ranks; no CRAN function implements it, and
stats::quade.test is a different test, for unreplicated complete block designs).

Procedure:
1. Rank the outcome and every covariate across all analysed cases (average ranks for ties, R's rank()).
2. Regress rank(y) on the covariate ranks, ignoring groups (lm(rank(y) ~ rank(x1) + ...)). Quade centres the
   ranks and fits through the origin; with an intercept the residuals are identical.
3. One-way ANOVA of the residuals by group: F on (k - 1, N - k) df.
Effect sizes: eta², omega², Cohen's f of that residual ANOVA (effectsize on aov(residuals ~ group)),
two-sided CIs at ci_level. Missing data: complete cases on outcome, group and covariates.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats

from statly_engine.errors import InvalidParams
from statly_engine.stats import apa, assumptions_multivariate as amv, effect_sizes_anova as esa
from statly_engine.stats.ancova import (ANCOVA_ROLES, LEVELS_OPT, data_inputs, data_warnings, group_descriptives,
                                        model_data)
from statly_engine.stats.anova import classical_f, descriptives_table, p_phrase, require_two_sided
from statly_engine.stats.apa import Rich
from statly_engine.stats.core import ResultBuilder, constant_warning, magnitude, ties_warning, warning
from statly_engine.stats.registry import register

ETA = Rich().t("η").sup("2")


@register("ancova.quade", label="Quade's rank ANCOVA", roles=ANCOVA_ROLES, options=LEVELS_OPT)
def quade(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    require_two_sided(request, "Quade's rank ANCOVA")
    level, alpha = request.ci_level, request.alpha
    d = model_data(df, request, meta, request.variables["outcome"], request.variables["covariates"])
    k, codes = d["k"], d["codes"]
    y, C = d["Y"][:, 0], d["C"]
    ry = stats.rankdata(y)
    rx = np.column_stack([stats.rankdata(C[:, c]) for c in range(C.shape[1])])
    X, _ = amv.design([rx])
    if np.linalg.matrix_rank(X) < X.shape[1]:
        raise InvalidParams("A covariate has no spread (or duplicates another covariate), so it can't be used.")
    resid = amv.fit(X, ry)["resid"]
    xs = [resid[codes == j] for j in range(k)]
    cf = classical_f(xs)
    if cf["df2"] <= 0:
        raise InvalidParams(f"Quade's test needs more complete rows than groups; there are {d['n_used']}.")
    vl, gl = d["ol"][0], d["gl"]
    b = ResultBuilder(request)
    rows = group_descriptives(b, d, level)
    b.statistic("F", "Quade's F (ANOVA of rank residuals)", "F", cf["f"], [cf["df1"], cf["df2"]] if cf["f"] is not None
                else [], cf["p"])
    es = esa.one_way(cf["ss_b"], cf["ss_w"], cf["df1"], cf["df2"], level) if cf["f"] is not None \
        else esa.from_f(None, cf["df1"], None, level)
    b.effect("eta_sq", "Eta squared (rank residuals)", "η²", es["eta_sq"], "eta_sq", what="effect")
    b.effect("omega_sq", "Omega squared (rank residuals)", "ω²", es["omega_sq"], "eta_sq", what="effect")
    b.effect("cohens_f", "Cohen's f (rank residuals)", "f", es["cohens_f"], "cohens_f", what="effect")
    data_warnings(b, d)
    if ties_warning(y, vl) is not None:
        b.warn(warning("ties_present", "info", f"{vl} has only {len(np.unique(y))} different values, so many scores "
                       "are tied. Tied scores share the average of their ranks, which Quade's test handles well."))
    if cf["f"] is None:
        b.warn(constant_warning(f"{vl} after adjusting for the covariate ranks"))
    data_inputs(b, d)
    recs = [{"group": nm, "n": int(len(x)), "mean_residual": float(np.mean(x)), "mean_rank": float(np.mean(ry[codes == j]))}
            for j, (nm, x) in enumerate(zip(d["names"], xs))]
    b.chart("rank_residuals", recs)

    covtxt = " and ".join(d["cl"])
    eta = es["eta_sq"]
    r = Rich().t(f"Quade's rank ANCOVA controlling for {covtxt} ")
    if cf["f"] is None:
        r.t(f"could not be computed for {vl}.")
        summary = f"Quade's test could not be calculated because the adjusted ranks of {vl} do not vary within groups."
    else:
        sig = cf["p"] < alpha
        r.t(f"showed that {vl} ranks {'differed significantly' if sig else 'did not differ significantly'} across the "
            f"{k} groups of {gl}, ").stat("F", [cf["df1"], cf["df2"]], cf["f"]).t(", ").p(cf["p"])
        if eta.value is not None:
            r.t(", ").es(ETA, eta.value, eta.lower, eta.upper, level, bounded=True)
        r.t(".")
        hi = max(recs, key=lambda x: x["mean_residual"])
        lo = min(recs, key=lambda x: x["mean_residual"])
        mag = magnitude(eta.value, "eta_sq")
        summary = (f"This rank-based test compares {vl} across the {k} groups of {gl} after taking {covtxt} into "
                   f"account, without assuming bell-shaped scores (highest adjusted ranks: {hi['group']}; lowest: "
                   f"{lo['group']}). "
                   + ("Differences this large are unlikely to be due to chance alone" if sig else
                      "The differences could easily be due to chance, so there is no strong evidence that the groups "
                      "really differ") + f" ({p_phrase(cf['p'])})."
                   + (f" The size of the effect was {mag} by common benchmarks." if mag else ""))
    b.sentence(r).summary(summary)
    cols = [apa.column("group", gl, "left"), apa.column("n", Rich().i("n")),
            apa.column("rank", Rich().t("Mean rank of ").i("y")), apa.column("res", "Mean rank residual")]
    body = [apa.row([apa.cell_text(x["group"]), apa.cell_int(x["n"]), apa.cell_num(x["mean_rank"]),
                     apa.cell_num(x["mean_residual"])]) for x in recs]
    note = Rich().t(f"Ranks of {vl} were regressed on the ranks of {covtxt} (ignoring groups); the residuals were "
                    "compared with a one-way ANOVA: ")
    if cf["f"] is not None:
        note.stat("F", [cf["df1"], cf["df2"]], cf["f"]).t(", ").p(cf["p"]).t(".")
    else:
        note.t("not computable.")
    b.table(apa.table(f"Quade's Rank ANCOVA of {vl} by {gl}", cols, body, general_note=note))
    b.extra_table(descriptives_table(f"Descriptive Statistics for {vl} by {gl}", rows, gl, level))
    return b.build()
