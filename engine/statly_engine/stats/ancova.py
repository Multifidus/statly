"""ANCOVA with estimated marginal (adjusted) means (SPEC §8). Reference: fixtures/r/ancova_manova.R.

Conventions (see also stats/README.md, "ANCOVA / MANOVA"):
- Model: car::Anova(lm(y ~ covariates + group), type = 3) under contr.sum. One or more covariates; no
  interaction terms, so each term's Type III SS equals the drop-that-term SS (identical to Type II).
  Statistics: F for the group (headline, term = group label), then F for each covariate (term = its label).
- Missing data: complete cases on the outcome, the group and every covariate (counts reported).
- Adjusted means = emmeans(fit, "group"): covariates held at their means, t CIs on the residual df.
- Pairwise adjusted-mean comparisons = pairs(emm, adjust = options.adjust), first level minus second:
  "holm" (default) or "bonferroni" (Bonferroni-adjusted CIs, as emmeans) or "tukey" (ptukey on |t|√2 with
  k means; CI = q(level; k, df) / √2 × SE).
- Effect sizes per term: partial eta² and partial omega² (effectsize(car::Anova(...), partial = TRUE)),
  plus Cohen's f for the group; CIs two-sided at ci_level (noncentral F, effect_sizes_anova.pve_ci).
  partial omega² = max(0, (SS - df MSE) / (SS + (N - df) MSE)).
- Assumptions (assumptions_multivariate.py): homogeneity of regression slopes (joint group × covariate F),
  linearity (curvature F per group and covariate), Levene (Brown-Forsythe) on the model residuals by group,
  Shapiro-Wilk on the model residuals.
"""

from __future__ import annotations

import math
from itertools import combinations

import numpy as np
import pandas as pd
from scipy import stats

from statly_engine.errors import InvalidParams
from statly_engine.stats import apa, assumptions as asm, assumptions_multivariate as amv, effect_sizes_anova as esa, prep
from statly_engine.stats.anova import descriptives_table, p_phrase, require_two_sided
from statly_engine.stats.apa import Rich
from statly_engine.stats.core import (ResultBuilder, magnitude, missing_warning, small_sample_warning,
                                      unequal_groups_warning, warning)
from statly_engine.stats.descriptives import cell
from statly_engine.stats.effect_sizes import Estimate
from statly_engine.stats.posthoc_param import _srange, p_adjust
from statly_engine.stats.registry import Role, register

ETA_P = Rich().t("η").sup("2").sub("p")
ADJUST = {"holm", "bonferroni", "tukey"}
LEVELS_OPT = {"levels": "Group values to include, in display order."}


# ---------------------------------------------------------------------------
# Data (shared with quade.py and manova.py)
# ---------------------------------------------------------------------------
def model_data(df: pd.DataFrame, request, meta, outcomes: list[str], covs: list[str]) -> dict:
    """Complete cases on outcomes, group and covariates; group codes 0..k-1 in display order."""
    gname = request.variables["group"][0]
    names = list(outcomes) + [gname] + list(covs)
    if len(set(names)) != len(names):
        raise InvalidParams("Each variable can be used only once (an outcome, the group and the covariates must "
                            "all be different columns).")
    gl = prep.label(meta, gname)
    g = prep.categorical(df, gname, meta)
    levels = prep.level_order(g, gname, meta, request.options.get("levels"))
    ys = np.column_stack([prep.numeric(df, y, meta).to_numpy() for y in outcomes])
    cs = (np.column_stack([prep.numeric(df, c, meta).to_numpy() for c in covs]) if covs
          else np.empty((len(df), 0)))
    code = np.full(len(df), -1)
    for j, lv in enumerate(levels):
        code[g.map(lambda v, lv=lv: prep._same(v, lv)).to_numpy(bool)] = j
    cc = (code >= 0) & np.all(np.isfinite(ys), axis=1) & np.all(np.isfinite(cs), axis=1)
    present = [j for j in range(len(levels)) if np.any(cc & (code == j))]
    empty = [prep.value_label(meta, gname, levels[j]) for j in range(len(levels)) if j not in present]
    remap = {old: new for new, old in enumerate(present)}
    levels = [levels[j] for j in present]
    if len(levels) < 2:
        found = ", ".join(prep.value_label(meta, gname, lv) for lv in levels) or "none"
        raise InvalidParams(f"Comparing groups needs at least two groups with complete data, but {gl} has "
                            f"{len(levels)} ({found}).")
    codes = np.array([remap[c] for c in code[cc]])
    n_used = int(cc.sum())
    return dict(gname=gname, gl=gl, levels=levels, names=[prep.value_label(meta, gname, lv) for lv in levels],
                codes=codes, k=len(levels), Y=ys[cc], C=cs[cc], outcomes=list(outcomes), covs=list(covs),
                ol=[prep.label(meta, y) for y in outcomes], cl=[prep.label(meta, c) for c in covs],
                n_used=n_used, n_excluded=int(len(df) - n_used), empty=empty)


def check_rank(X: np.ndarray, d: dict) -> None:
    if np.linalg.matrix_rank(X) < X.shape[1]:
        raise InvalidParams("A covariate has no spread, or duplicates another covariate or the groups, so the "
                            "model can't separate their effects. Remove it and try again.")


def group_descriptives(b: ResultBuilder, d: dict, level: float) -> list[dict]:
    """Descriptives per group for every outcome, then every covariate (analysed cases). Returns outcome 0 rows."""
    first = []
    for col, (v, lab) in enumerate(zip(d["outcomes"] + d["covs"], d["ol"] + d["cl"])):
        vals = d["Y"][:, col] if col < len(d["outcomes"]) else d["C"][:, col - len(d["outcomes"])]
        rows = [cell(v, {d["gname"]: lv}, nm if col == 0 and len(d["outcomes"]) == 1 else f"{lab}: {nm}",
                     vals[d["codes"] == j], level)
                for j, (lv, nm) in enumerate(zip(d["levels"], d["names"]))]
        b.descriptives(rows)
        if col == 0:
            first = rows
    return first


def data_warnings(b: ResultBuilder, d: dict) -> None:
    counts = {nm: int(np.sum(d["codes"] == j)) for j, nm in enumerate(d["names"])}
    b.warn(small_sample_warning(counts)).warn(unequal_groups_warning(counts))
    b.warn(missing_warning(d["n_excluded"]))
    if d["empty"]:
        b.warn(warning("empty_groups", "info", "These groups have no complete rows and were left out: "
                       + ", ".join(d["empty"]) + "."))


def data_inputs(b: ResultBuilder, d: dict) -> None:
    b.inputs(d["n_used"], d["n_excluded"],
             [({d["gname"]: lv}, int(np.sum(d["codes"] == j))) for j, lv in enumerate(d["levels"])])


# ---------------------------------------------------------------------------
# Univariate linear model (one outcome), Type III terms
# ---------------------------------------------------------------------------
def ancova_fit(y: np.ndarray, C: np.ndarray, codes: np.ndarray, k: int, level: float) -> dict:
    """lm(y ~ covariates + group) under contr.sum: term tables, adjusted means, residuals."""
    n = len(y)
    contr = amv.sum_contrasts(codes, k)
    blocks = [C[:, [c]] for c in range(C.shape[1])] + [contr]
    X, sl = amv.design(blocks)
    f = amv.fit(X, y)
    sse = float(f["resid"] @ f["resid"])
    df_e = n - X.shape[1]
    mse = sse / df_e if df_e > 0 else float("nan")
    terms = []
    for s in [sl[-1]] + sl[:-1]:                       # group first, then covariates
        df1 = s.stop - s.start
        ss = float(amv.rss(amv.drop(X, s), y)) - sse
        F = p = None
        if df_e > 0 and sse > 1e-12 * max(1.0, ss):
            F = (ss / df1) / mse
            p = float(stats.f.sf(F, df1, df_e))
        eta = esa.pve_ci(ss / (ss + sse) if ss + sse > 0 else None, df1, df_e, level)
        om = esa.pve_ci(max(0.0, (ss - df1 * mse) / (ss + (n - df1) * mse)) if mse > 0 else None, df1, df_e, level)
        terms.append(dict(ss=ss, df=df1, F=F, p=p, eta=eta, omega=om, f=esa.cohens_f(eta)))
    # Adjusted means: covariates at their means, group row of contr.sum.
    cmeans = C.mean(axis=0) if C.shape[1] else np.empty(0)
    L = np.zeros((k, X.shape[1]))
    L[:, 0] = 1.0
    for c in range(C.shape[1]):
        L[:, sl[c].start] = cmeans[c]
    L[:, sl[-1]] = amv.sum_contrasts(np.arange(k), k)
    V = f["xtx_inv"] * mse
    means = L @ f["beta"]
    ses = np.sqrt(np.einsum("ij,jk,ik->i", L, V, L))
    q = stats.t.ppf(1 - (1 - level) / 2, df_e) if df_e > 0 else float("nan")
    return dict(terms=terms, sse=sse, df_e=df_e, mse=mse, resid=f["resid"], L=L, V=V, beta=f["beta"],
                means=means, ses=ses, lower=means - q * ses, upper=means + q * ses, sst=float(np.sum((y - y.mean()) ** 2)))


def pairwise(m: dict, k: int, names: list[str], adjust: str, level: float) -> list[dict]:
    """emmeans pairs(): first minus second, adjusted p and CI."""
    df_e = m["df_e"]
    pairs = list(combinations(range(k), 2))
    npairs = len(pairs)
    if adjust == "tukey":
        crit = _srange("ppf", level, k, df_e) / math.sqrt(2)
    else:
        crit = float(stats.t.ppf(1 - (1 - level) / (2 * npairs), df_e))
    out = []
    for i, j in pairs:
        dvec = m["L"][i] - m["L"][j]
        est = float(dvec @ m["beta"])
        se = float(math.sqrt(dvec @ m["V"] @ dvec))
        t = p = None
        lo = hi = None
        if se > 0:
            t = est / se
            if adjust == "tukey":
                p = _srange("sf", abs(t) * math.sqrt(2), k, df_e)
            else:
                p = float(2 * stats.t.sf(abs(t), df_e))
            lo, hi = est - crit * se, est + crit * se
        out.append(dict(term=f"{names[i]} vs {names[j]}", names=(names[i], names[j]), t=t, p=p, df=df_e,
                        md=Estimate(est, lo, hi, level)))
    if adjust != "tukey":
        for c, pa in zip(out, p_adjust([c["p"] for c in out], adjust)):
            c["p"] = pa
    return out


def adjusted_mean_records(m: dict, d: dict, outcome: str | None = None) -> list[dict]:
    recs = []
    for j, (lv, nm) in enumerate(zip(d["levels"], d["names"])):
        r = {"group": nm, "emmean": float(m["means"][j]), "se": float(m["ses"][j]), "df": float(m["df_e"]),
             "lower": float(m["lower"][j]), "upper": float(m["upper"][j]),
             "n": int(np.sum(d["codes"] == j))}
        if outcome is not None:
            r["outcome"] = outcome
        recs.append(r)
    return recs


def _size(est) -> str:
    mag = magnitude(est.value, "eta_sq")
    return f" The size of the group effect was {mag} by common benchmarks." if mag else ""


# ---------------------------------------------------------------------------
# ancova
# ---------------------------------------------------------------------------
ANCOVA_ROLES = [Role("outcome", 1, 1, "Scores to compare (e.g. post-test)"),
                Role("group", 1, 1, "Grouping variable with two or more groups"),
                Role("covariates", 1, None, "Score(s) to adjust for (e.g. pre-test)")]


@register("ancova", label="ANCOVA", roles=ANCOVA_ROLES,
          options={"adjust": "\"holm\" (default), \"bonferroni\" or \"tukey\": correction for the pairwise "
                             "comparisons of adjusted means.", **LEVELS_OPT})
def ancova(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    require_two_sided(request, "An ANCOVA")
    level, alpha = request.ci_level, request.alpha
    adjust = str(request.options.get("adjust") or "holm").lower()
    if adjust not in ADJUST:
        raise InvalidParams("options.adjust must be \"holm\", \"bonferroni\" or \"tukey\".")
    d = model_data(df, request, meta, request.variables["outcome"], request.variables["covariates"])
    k, codes, y, C = d["k"], d["codes"], d["Y"][:, 0], d["C"]
    X, _ = amv.design([C, amv.sum_contrasts(codes, k)])
    check_rank(X, d)
    if d["n_used"] - X.shape[1] < 1:
        raise InvalidParams(f"An ANCOVA with {k} groups and {len(d['covs'])} covariate(s) needs more than "
                            f"{X.shape[1]} complete rows; there are {d['n_used']}.")
    vl, gl = d["ol"][0], d["gl"]
    b = ResultBuilder(request)
    rows = group_descriptives(b, d, level)
    m = ancova_fit(y, C, codes, k, level)
    tg = m["terms"][0]
    b.statistic("F", "F (group, adjusted for covariates)", "F", tg["F"], [tg["df"], m["df_e"]] if tg["F"] is not None else [],
                tg["p"], term=gl)
    for cl, t in zip(d["cl"], m["terms"][1:]):
        b.statistic("F", "F (covariate)", "F", t["F"], [t["df"], m["df_e"]] if t["F"] is not None else [], t["p"], term=cl)
    comps = pairwise(m, k, d["names"], adjust, level)
    for c in comps:
        b.statistic("t", "t (adjusted means)", "t", c["t"], [c["df"]] if c["t"] is not None else [], c["p"], term=c["term"])
    for lab, t in zip([gl] + d["cl"], m["terms"]):
        b.effect("partial_eta_sq", "Partial eta squared", "η²p", t["eta"], "eta_sq", term=lab, what="effect")
        b.effect("partial_omega_sq", "Partial omega squared", "ω²p", t["omega"], "eta_sq", term=lab, what="effect")
        if lab == gl:
            b.effect("cohens_f", "Cohen's f", "f", t["f"], "cohens_f", term=lab, what="effect")
    for c in comps:
        b.effect("mean_difference", "Adjusted mean difference", "Mdiff", c["md"], term=c["term"])

    # assumptions
    slopes = amv.slopes_test(y, C, amv.sum_contrasts(codes, k), alpha)
    b.assumption(slopes)
    for j, (lv, nm) in enumerate(zip(d["levels"], d["names"])):
        for c, cl in enumerate(d["cl"]):
            sel = codes == j
            b.assumption(amv.linearity(C[sel, c], y[sel], f"{nm}: {cl}", {d["gname"]: lv}, alpha))
    lev, _ = asm.levene_brown_forsythe({nm: m["resid"][codes == j] for j, nm in enumerate(d["names"])},
                                       asm.scope("overall", "residuals by group"), alpha,
                                       failed_note="Unequal spread matters most when group sizes differ; "
                                                   "compare the adjusted means with care.")
    b.assumption(lev)
    res, charts = amv.residual_normality(m["resid"], "residuals", alpha)
    b.assumption(res, charts)
    data_warnings(b, d)
    if slopes["verdict"] == "failed":
        b.warn(warning("slopes_differ", "caution", "The covariate relates to the outcome differently in different "
                       "groups (the equal-slopes check failed), so a single adjusted comparison can mislead."))
    if tg["F"] is None:
        b.warn(warning("constant_variable", "serious", f"{vl} is perfectly predicted by the model, so there is no "
                       "variation left to test."))
    data_inputs(b, d)
    b.chart("adjusted_means", adjusted_mean_records(m, d))
    b.chart("scatter_covariate", [{"group": d["names"][codes[i]], **{cl: float(C[i, c]) for c, cl in enumerate(d["cl"])},
                                   vl: float(y[i])} for i in range(len(y))])

    covtxt = " and ".join(d["cl"])
    eta = tg["eta"]
    r = Rich().t(f"A one-way ANCOVA controlling for {covtxt} ")
    if tg["F"] is None:
        r.t(f"could not be computed for {vl}.")
        summary = f"The ANCOVA could not be calculated because {vl} has no variation left after the adjustment."
    else:
        sig = tg["p"] < alpha
        r.t(f"showed that adjusted {vl} scores {'differed significantly' if sig else 'did not differ significantly'} "
            f"across the {k} groups of {gl}, ").stat("F", [tg["df"], m["df_e"]], tg["F"]).t(", ").p(tg["p"])
        if eta.value is not None:
            r.t(", ").es(ETA_P, eta.value, eta.lower, eta.upper, level, bounded=True)
        r.t(".")
        hi = int(np.argmax(m["means"]))
        lo = int(np.argmin(m["means"]))
        summary = (f"After adjusting for {covtxt}, average {vl} scores were compared across the {k} groups of {gl} "
                   f"(adjusted means highest: {d['names'][hi]}, {apa.num(m['means'][hi])}; lowest: {d['names'][lo]}, "
                   f"{apa.num(m['means'][lo])}). "
                   + ("Differences this large are unlikely to be due to chance alone" if sig else
                      "The adjusted differences could easily be due to chance, so there is no strong evidence that "
                      "the groups really differ") + f" ({p_phrase(tg['p'])})." + _size(eta)
                   + (" The pairwise comparisons of adjusted means show which groups differ." if sig and k > 2 else ""))
        if slopes["verdict"] == "failed":
            summary += " Caution: the covariate works differently in different groups, so these adjusted means can mislead."
    b.sentence(r).summary(summary)

    cols = [apa.column("source", "Source", "left"), apa.column("ss", Rich().i("SS")), apa.column("df", Rich().i("df")),
            apa.column("ms", Rich().i("MS")), apa.column("f", Rich().i("F")), apa.column("p", Rich().i("p")),
            apa.column("eta", ETA_P), apa.column("ci", f"{apa.level_text(level)} CI")]
    body = []
    for lab, t in zip(d["cl"] + [gl], m["terms"][1:] + m["terms"][:1]):
        body.append(apa.row([apa.cell_text(lab), apa.cell_num(t["ss"]), apa.cell_df(t["df"]),
                             apa.cell_num(t["ss"] / t["df"]), apa.cell_num(t["F"]), apa.cell_p(t["p"]),
                             apa.cell_num(t["eta"].value, bounded=True),
                             apa.cell_ci(t["eta"].lower, t["eta"].upper, bounded=True)]))
    blank = apa.cell_empty
    body.append(apa.row([apa.cell_text("Error"), apa.cell_num(m["sse"]), apa.cell_df(m["df_e"]), apa.cell_num(m["mse"]),
                         blank(), blank(), blank(), blank()]))
    body.append(apa.row([apa.cell_text("Corrected total"), apa.cell_num(m["sst"]), apa.cell_df(d["n_used"] - 1),
                         blank(), blank(), blank(), blank(), blank()]))
    b.table(apa.table(f"ANCOVA of {vl} by {gl}, Controlling for {covtxt}", cols, body,
                      general_note=Rich().t("Type III sums of squares. ").extend(ETA_P).t(" = partial eta squared.")))

    acols = [apa.column("group", gl, "left"), apa.column("n", Rich().i("n")), apa.column("m", Rich().i("M")),
             apa.column("madj", Rich().i("M").sub("adj")), apa.column("se", Rich().i("SE")),
             apa.column("ci", f"{apa.level_text(level)} CI")]
    abody = [apa.row([apa.cell_text(nm), apa.cell_int(rw["n"]), apa.cell_num(rw["mean"]), apa.cell_num(m["means"][j]),
                      apa.cell_num(m["ses"][j]), apa.cell_ci(m["lower"][j], m["upper"][j])])
             for j, (nm, rw) in enumerate(zip(d["names"], rows))]
    cmean_txt = ", ".join(f"{cl} = {apa.num(float(np.mean(C[:, c])))}" for c, cl in enumerate(d["cl"]))
    b.extra_table(apa.table(f"Observed and Adjusted Means of {vl} by {gl}", acols, abody, number=2,
                            general_note=Rich().t(f"Adjusted means are evaluated at the covariate mean ({cmean_txt}).")))
    pcols = [apa.column("comparison", "Comparison", "left"), apa.column("md", Rich().i("M").sub("diff")),
             apa.column("ci", f"{apa.level_text(level)} CI"), apa.column("t", Rich().i("t")),
             apa.column("df", Rich().i("df")), apa.column("p", Rich().i("p"))]
    pbody = [apa.row([apa.cell_text(c["term"]), apa.cell_num(c["md"].value), apa.cell_ci(c["md"].lower, c["md"].upper),
                      apa.cell_num(c["t"]), apa.cell_df(c["df"]), apa.cell_p(c["p"])]) for c in comps]
    note = {"tukey": "p values and CIs are Tukey-adjusted", "holm": "p values are Holm-adjusted; CIs are "
            "Bonferroni-adjusted", "bonferroni": "p values and CIs are Bonferroni-adjusted"}[adjust]
    b.extra_table(apa.table(f"Pairwise Comparisons of Adjusted {vl} Means", pcols, pbody, number=3,
                            general_note=Rich().t(f"Differences are first minus second group; {note} for "
                                                  f"{len(comps)} comparisons.")))
    b.extra_table(descriptives_table(f"Descriptive Statistics for {vl} by {gl}", rows, gl, level, number=4))
    return b.build()
