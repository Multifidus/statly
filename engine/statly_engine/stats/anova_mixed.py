"""Mixed ANOVA: one between-subjects factor x one within-subjects factor (SPEC §3, §8).
Reference: fixtures/r/factorial.R.

Conventions (see also stats/README.md, "Factorial, mixed, ART, simple effects"):
- anova.mixed = afex::aov_ez(id, dv, between = group, within = time, type = 3), i.e. car::Anova on the
  wide multivariate linear model with sum-to-zero contrasts, reported as univariate tests. With Y the
  n x k complete-case matrix, C a k x (k - 1) orthonormal contrast matrix and G groups:
  * group: one-way ANOVA on the subject totals / sqrt(k) (error df N - G);
  * time: Type III test of the intercept of the mlm Y C ~ group, SS = |b0|² / h00 with b0 the
    unweighted mean of the group mean vectors and h00 = sum(1 / n_g) / G²;
  * group x time: between-group SSP of Y C, SS = trace; error SS = trace of the pooled residual SSP E,
    df (N - G)(k - 1). Unequal group sizes are handled exactly (Type III).
- Sphericity (time and group x time share it): Mauchly's W from S = E / (N - G) with error df N - G
  (car's mauchly on the SSPE), GG = tr(S)² / (p tr(S²)), HF = car's Huynh-Feldt-Lecoutre form
  ((N - G + 1) p GG - 2) / (p (N - G - p GG)), capped at 1 as afex. With one group these are
  sphericity.py's values. options.correction as anova.repeated_measures ("auto": GG when Mauchly's
  p < alpha).
- Box's M (equal covariance matrices across groups) = heplots::boxM chi-square approximation.
  Box's M is very sensitive, so the conventional .001 level is used for the verdict.
- Levene (Brown-Forsythe) across groups and Shapiro-Wilk on the residuals (score minus its group
  mean), both per time point.
- Effect sizes (effectsize on the afex model): partial eta² = SS_t / (SS_t + SS_err(stratum)),
  generalized eta² = SS_t / (SS_t + SS_err,between + SS_err,within) (afex ges), partial omega² =
  max(0, (SS_t - df_t MS_err) / (SS_t + [within] SS_err,within + SS_err,between + MS_err,between)),
  Cohen's f from partial eta². CIs two-sided at ci_level on the uncorrected df.
- Estimated marginal means follow afex's default emmeans_model = "multivariate": SEs from the pooled
  within-group covariance of the raw scores, df = N - G.
- Layouts: wide (`measures` + `between`) or long (`outcome`, `time`, `subject_id`, `between`). Complete
  cases; in the long layout a person must have exactly one row per time point and one group value.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy import stats

from statly_engine.data.linking import normalize_id
from statly_engine.errors import InvalidParams
from statly_engine.stats import apa, assumptions as asm, effect_sizes_anova as esa, prep, sphericity as sph
from statly_engine.stats.anova import ETA_G, ETA_P, require_two_sided
from statly_engine.stats.anova_factorial import (TIMES, anova_table, cell_counts_warning, cell_table, term_sentence,
                                                 term_summary)
from statly_engine.stats.apa import Rich
from statly_engine.stats.core import ResultBuilder, constant_warning, ties_warning, warning
from statly_engine.stats.descriptives import cell
from statly_engine.stats.registry import Role, register

MIXED_ROLES = {
    "wide": [Role("measures", 2, None, "Score columns for the same people, in time order"),
             Role("between", 1, 1, "Grouping variable (e.g. program vs control)")],
    "long": [Role("outcome", 1, 1, "Scores"), Role("time", 1, 1, "Time point (two or more levels)"),
             Role("subject_id", 1, 1, "Participant ID linking rows across time"),
             Role("between", 1, 1, "Grouping variable (e.g. program vs control)")],
}
CORRECTIONS = {"auto", "none", "gg", "hf"}
BOX_M_ALPHA = 0.001


# ---------------------------------------------------------------------------
# Data (wide or long, complete cases)
# ---------------------------------------------------------------------------
def _group_index(values: list, levels: list) -> np.ndarray:
    return np.array([next(i for i, lv in enumerate(levels) if prep._same(v, lv)) for v in values], int)


def _mixed_wide(df, request, meta) -> dict:
    cols = request.variables["measures"]
    gname = request.variables["between"][0]
    if len(set(cols)) != len(cols):
        raise InvalidParams("Each measure can be chosen only once.")
    if gname in cols:
        raise InvalidParams("The grouping variable can't also be one of the measures.")
    xs = [prep.numeric(df, c, meta) for c in cols]
    gcol = prep.categorical(df, gname, meta)
    has_g = gcol.notna().to_numpy()
    cc = np.all([x.notna().to_numpy() for x in xs], axis=0) & has_g
    gl = prep.level_order(gcol[cc], gname, meta)
    gidx = _group_index(gcol[cc].tolist(), gl) if gl else np.zeros(0, int)
    y = np.column_stack([x[cc].to_numpy() for x in xs])
    tnames = [prep.label(meta, c) for c in cols]
    gnames = [prep.value_label(meta, gname, lv) for lv in gl]
    desc = []
    for i, lv in enumerate(gl):
        in_g = gcol.map(lambda v, lv=lv: prep._same(v, lv)).to_numpy(bool)
        for j, c in enumerate(cols):
            desc.append((c, {gname: lv}, f"{gnames[i]}, {tnames[j]}", y[gidx == i, j], int(xs[j][in_g].isna().sum()),
                         gnames[i], tnames[j]))
    dropped = int((~cc).sum())
    notes = []
    if dropped:
        notes.append(f"{dropped} people were left out because they are missing at least one of the measures or "
                     "their group")
    return dict(y=y, g=gidx, gl=gl, gnames=gnames, tnames=tnames, gname=gname, time_var=None, time_levels=None,
                glabel=prep.label(meta, gname), tlabel="Time", outcome_label=", ".join(tnames), desc=desc,
                n_excluded=dropped, notes=notes)


def _mixed_long(df, request, meta) -> dict:
    yname = request.variables["outcome"][0]
    tname = request.variables["time"][0]
    sname = request.variables["subject_id"][0]
    gname = request.variables["between"][0]
    if len({yname, tname, sname, gname}) < 4:
        raise InvalidParams("Choose four different variables for scores, time, ID and group.")
    y = prep.numeric(df, yname, meta)
    tcol = prep.categorical(df, tname, meta)
    gcol = prep.categorical(df, gname, meta)
    levels = prep.level_order(tcol, tname, meta)
    k = len(levels)
    if k < 2:
        raise InvalidParams(f"A mixed ANOVA needs at least two time points, but {prep.label(meta, tname)} has {k}.")
    link = (meta or {}).get("link") or {}
    norm = (link.get("normalization") if link.get("mode") == "linked" and link.get("id_variable") == sname
            else None) or {"trim_whitespace": True, "case_insensitive": False}
    ids = prep.categorical(df, sname, meta).map(
        lambda v: None if v is None else normalize_id(v, norm["trim_whitespace"], norm["case_insensitive"]))
    at = [tcol.map(lambda v, lv=lv: prep._same(v, lv)).to_numpy(bool) for lv in levels]
    lvl = np.full(len(df), -1)
    for j, m in enumerate(at):
        lvl[m] = j
    in_levels = lvl >= 0
    frame = pd.DataFrame({"id": ids.to_numpy(), "lvl": lvl, "y": y.to_numpy()})[in_levels]
    no_id = int(frame["id"].isna().sum())
    frame = frame[frame["id"].notna()]
    counts = frame.groupby(["id", "lvl"]).size().unstack(fill_value=0).reindex(columns=range(k), fill_value=0)

    seen: dict = {}
    for sid, gv in zip(ids.to_numpy()[in_levels], gcol.to_numpy()[in_levels]):
        if sid is None:
            continue
        vals = seen.setdefault(sid, [])
        if gv is not None and not any(prep._same(gv, u) for u in vals):
            vals.append(gv)
    groups = {sid: vals[0] for sid, vals in seen.items() if len(vals) == 1}
    dup = counts[(counts > 1).any(axis=1)].index
    partial = counts[(counts == 0).any(axis=1) & ~counts.index.isin(dup)].index
    matched = counts[(counts == 1).all(axis=1)].index
    no_group = [i for i in matched if groups.get(i) is None]
    ok = [i for i in matched if groups.get(i) is not None]
    wide = frame[frame["id"].isin(ok)].pivot(index="id", columns="lvl", values="y").sort_index()
    wide = wide.reindex(columns=range(k))
    cc = wide.notna().all(axis=1)
    keep_ids = list(wide.index[cc])
    n = len(keep_ids)
    gvals = [groups[i] for i in keep_ids]
    gl = prep.level_order(pd.Series(gvals, dtype=object), gname, meta)
    gidx = _group_index(gvals, gl) if gl else np.zeros(0, int)
    notes = []
    if len(partial):
        notes.append(f"{len(partial)} people do not have a row at every time point")
    if len(dup):
        notes.append(f"{len(dup)} IDs appear more than once at the same time point, so their scores can't be matched")
    if no_group:
        notes.append(f"{len(no_group)} people have no group, or different groups on different rows")
    if int((~cc).sum()):
        notes.append(f"{int((~cc).sum())} matched people are missing a {prep.label(meta, yname)} score")
    if no_id:
        notes.append(f"{no_id} rows have no ID")
    ymat = wide.loc[keep_ids].to_numpy(float) if n else np.zeros((0, k))
    tnames = [prep.value_label(meta, tname, lv) for lv in levels]
    gnames = [prep.value_label(meta, gname, lv) for lv in gl]
    desc = []
    for i, glv in enumerate(gl):
        in_g = gcol.map(lambda v, glv=glv: prep._same(v, glv)).to_numpy(bool)
        for j, tlv in enumerate(levels):
            desc.append((yname, {gname: glv, tname: tlv}, f"{gnames[i]}, {tnames[j]}", ymat[gidx == i, j],
                         int(y[in_g & at[j]].isna().sum()), gnames[i], tnames[j]))
    return dict(y=ymat, g=gidx, gl=gl, gnames=gnames, tnames=tnames, gname=gname, time_var=tname, time_levels=levels,
                glabel=prep.label(meta, gname), tlabel=prep.label(meta, tname), outcome_label=prep.label(meta, yname),
                desc=desc, n_excluded=int(in_levels.sum() - k * n), notes=notes)


def mixed_data(df: pd.DataFrame, request, meta) -> dict:
    d = _mixed_wide(df, request, meta) if "measures" in request.variables else _mixed_long(df, request, meta)
    n, G = d["y"].shape[0], len(d["gl"])
    if G < 2:
        raise InvalidParams(f"A mixed ANOVA needs at least two groups in {d['glabel']} with complete scores; "
                            f"there {'is' if G == 1 else 'are'} {G}.")
    if n - G < 1:
        raise InvalidParams(f"There are too few people ({n}) with every score for {G} groups.")
    return d


# ---------------------------------------------------------------------------
# Computation
# ---------------------------------------------------------------------------
def group_means(y: np.ndarray, g: np.ndarray, G: int) -> tuple[np.ndarray, np.ndarray]:
    ng = np.bincount(g, minlength=G).astype(float)
    m = np.vstack([y[g == i].mean(axis=0) for i in range(G)])
    return ng, m


def pooled_cov(y: np.ndarray, g: np.ndarray, G: int) -> np.ndarray:
    """Pooled within-group covariance (SSPE / (N - G))."""
    _, m = group_means(y, g, G)
    r = y - m[g]
    return r.T @ r / (len(y) - G)


def mixed_table(y: np.ndarray, g: np.ndarray, G: int) -> dict:
    """Type III univariate tests of the mixed design (car::Anova on the mlm, as afex)."""
    n, k = y.shape
    ng, _ = group_means(y, g, G)
    # between: subject totals / sqrt(k)
    s0 = y.sum(axis=1) / math.sqrt(k)
    m0 = np.array([s0[g == i].mean() for i in range(G)])
    grand0 = float(np.sum(ng * m0) / n)
    ss_g = float(np.sum(ng * (m0 - grand0) ** 2))
    ss_eb = float(np.sum((s0 - m0[g]) ** 2))
    # within: orthonormal contrasts
    c = sph.orthonormal_contrasts(k)
    yc = y @ c
    _, mc = group_means(yc, g, G)
    resid = yc - mc[g]
    e = resid.T @ resid
    ss_ew = float(np.trace(e))
    b0 = mc.mean(axis=0)
    h00 = float(np.sum(1 / ng)) / G ** 2
    ss_t = float(b0 @ b0) / h00
    mw = (ng[:, None] * mc).sum(axis=0) / n
    ss_gt = float(np.sum(ng[:, None] * (mc - mw) ** 2))
    dfb, dfw = n - G, (n - G) * (k - 1)
    scale = float(np.sum((y - y.mean()) ** 2))
    tiny = 1e-12 * max(1.0, scale)

    def test(ss, df1, sse, dfe):
        if not (dfe > 0 and sse > tiny):
            return dict(ss=ss, df=df1, f=None, p=None)
        f = (ss / df1) / (sse / dfe)
        return dict(ss=ss, df=df1, f=f, p=float(stats.f.sf(f, df1, dfe)))

    return {"G": {**test(ss_g, G - 1, ss_eb, dfb), "dfe": dfb, "sse": ss_eb, "within": False},
            "T": {**test(ss_t, k - 1, ss_ew, dfw), "dfe": dfw, "sse": ss_ew, "within": True},
            "GT": {**test(ss_gt, (G - 1) * (k - 1), ss_ew, dfw), "dfe": dfw, "sse": ss_ew, "within": True},
            "ss_eb": ss_eb, "ss_ew": ss_ew, "dfb": dfb, "dfw": dfw}


def pooled_sphericity(y: np.ndarray, g: np.ndarray, G: int) -> sph.Sphericity:
    """Mauchly / GG / HF from the pooled within-group contrast covariance, error df N - G (car)."""
    n, k = y.shape
    p = k - 1
    n_e = n - G
    if p < 2:
        return sph.Sphericity(None, None, None, None, 1.0, 1.0, 1.0)
    c = sph.orthonormal_contrasts(k)
    yc = y @ c
    s = pooled_cov(yc, g, G)
    tr, tr2 = float(np.trace(s)), float(np.trace(s @ s))
    if not (tr > 0 and tr2 > 0):
        nan = float("nan")
        return sph.Sphericity(None, None, None, None, nan, nan, nan)
    gg = tr * tr / (p * tr2)
    denom = p * (n_e - p * gg)
    hf_raw = ((n_e + 1) * p * gg - 2) / denom if denom != 0 else float("nan")
    hf = min(1.0, hf_raw) if math.isfinite(hf_raw) else float("nan")
    if n_e < p:
        return sph.Sphericity(None, None, None, None, gg, hf, hf_raw)
    sign, logdet = np.linalg.slogdet(s)
    f = p * (p + 1) // 2 - 1
    if sign <= 0:
        return sph.Sphericity(0.0, math.inf, f, 0.0, gg, hf, hf_raw)
    log_w = logdet - p * math.log(tr / p)
    rho = 1 - (2 * p * p + p + 2) / (6 * p * n_e)
    w2 = (p + 2) * (p - 1) * (p - 2) * (2 * p ** 3 + 6 * p * p + 3 * p + 2) / (288 * (n_e * p * rho) ** 2)
    z = -n_e * rho * log_w
    pr1, pr2 = stats.chi2.sf(z, f), stats.chi2.sf(z, f + 4)
    pv = float(min(1.0, max(0.0, pr1 + w2 * (pr2 - pr1))))
    return sph.Sphericity(math.exp(log_w), z, f, pv, gg, hf, hf_raw)


@dataclass(frozen=True)
class BoxM:
    chi2: float | None
    df: float
    p: float | None


def box_m(y: np.ndarray, g: np.ndarray, G: int) -> BoxM:
    """Box's M chi-square approximation (heplots::boxM)."""
    n, p = y.shape
    ng = np.bincount(g, minlength=G)
    df = p * (p + 1) * (G - 1) / 2
    if np.any(ng - 1 < p):
        return BoxM(None, df, None)
    covs = [np.cov(y[g == i], rowvar=False, ddof=1) for i in range(G)]
    sp = sum((ng[i] - 1) * covs[i] for i in range(G)) / (n - G)
    dets = [np.linalg.slogdet(s) for s in covs + [sp]]
    if any(sgn <= 0 for sgn, _ in dets):
        return BoxM(None, df, None)
    m = (n - G) * dets[-1][1] - sum((ng[i] - 1) * dets[i][1] for i in range(G))
    c1 = (np.sum(1 / (ng - 1)) - 1 / (n - G)) * (2 * p * p + 3 * p - 1) / (6 * (p + 1) * (G - 1))
    chi = float(m * (1 - c1))
    return BoxM(chi, df, float(stats.chi2.sf(chi, df)))


def box_m_assumption(bm: BoxM, n: int) -> dict:
    sc = {"kind": "overall", "label": "all groups", "group": None, "n": n}
    base = {"schema_version": 1, "assumption": "equal_covariance_matrices",
            "label": "Equal covariance matrices", "test_used": {"key": "box_m", "label": "Box's M test"},
            "applies_to": sc, "chart_refs": []}
    if bm.chi2 is None:
        return {**base, "statistic": None, "p": None, "verdict": "caution",
                "explanation": "Box's M can't be computed because at least one group has no more people than there "
                               "are time points (or its scores don't vary enough). Compare the groups' spreads in "
                               "the descriptives instead."}
    ptxt = apa.p_value(bm.p)
    ptxt = f"p {ptxt}" if ptxt[0] in "<>" else f"p = {ptxt}"
    stat = {"symbol": "χ²", "value": bm.chi2, "df": [float(bm.df)]}
    if bm.p >= BOX_M_ALPHA:
        verdict, text = "passed", (f"Box's M found no strong sign that the groups' patterns of spread and "
                                   f"correlation across time points differ ({ptxt}; judged at the usual .001 "
                                   "level because this test is very sensitive).")
    else:
        verdict, text = "failed", (f"Box's M suggests the groups differ in how their scores spread and correlate "
                                   f"across time points ({ptxt}). The tests are fairly robust to this when the "
                                   "groups are about the same size; with very unequal groups, read the between-"
                                   "groups and interaction results with care.")
    return {**base, "statistic": stat, "p": bm.p, "verdict": verdict, "explanation": text}


def mixed_effects(t: dict, key: str, level: float) -> dict:
    tt = t[key]
    none = esa.Estimate(None, None, None, level)
    if tt["f"] is None:
        return {"partial_eta_sq": none, "generalized_eta_sq": none, "omega_sq": none, "cohens_f": none}
    ss, df1, sse, dfe = tt["ss"], tt["df"], tt["sse"], tt["dfe"]
    ms_eb = t["ss_eb"] / t["dfb"]
    pes = esa.pve_ci(ss / (ss + sse), df1, dfe, level)
    ges = esa.pve_ci(ss / (ss + t["ss_eb"] + t["ss_ew"]), df1, dfe, level)
    om = esa.pve_ci(max(0.0, (ss - df1 * sse / dfe) / (ss + (t["ss_ew"] if tt["within"] else 0.0)
                                                         + t["ss_eb"] + ms_eb)), df1, dfe, level)
    return {"partial_eta_sq": pes, "generalized_eta_sq": ges, "omega_sq": om, "cohens_f": esa.cohens_f(pes)}


def emmeans_mixed(d: dict, level: float) -> tuple[list[dict], list[dict]]:
    """Marginal and cell means with afex's multivariate emmeans model (df = N - G)."""
    y, g = d["y"], d["g"]
    G, (n, k) = len(d["gl"]), y.shape
    ng, m = group_means(y, g, G)
    s = pooled_cov(y, g, G)
    dfe = n - G
    q = stats.t.ppf(0.5 + level / 2, dfe)

    def rec(mean, se):
        return {"emmean": float(mean), "se": float(se), "df": float(dfe), "ci_lower": float(mean - q * se),
                "ci_upper": float(mean + q * se)}

    one = np.ones(k)
    marg = [{"factor": d["glabel"], "level": d["gnames"][i],
             **rec(m[i].mean(), math.sqrt(float(one @ s @ one) / k ** 2 / ng[i]))} for i in range(G)]
    marg += [{"factor": d["tlabel"], "level": d["tnames"][j],
              **rec(m[:, j].mean(), math.sqrt(s[j, j] * float(np.sum(1 / ng))) / G)} for j in range(k)]
    cells = [{"x": d["tnames"][j], "series": d["gnames"][i], "n": int(ng[i]), **rec(m[i, j], math.sqrt(s[j, j] / ng[i]))}
             for i in range(G) for j in range(k)]
    return marg, cells


# ---------------------------------------------------------------------------
# Shared reporting (mixed ANOVA, ART, simple effects)
# ---------------------------------------------------------------------------
def mixed_descriptives(b: ResultBuilder, d: dict, level: float) -> list[dict]:
    rows, shown = [], []
    for var, grp, lab, vals, n_miss, gn, tn in d["desc"]:
        r = cell(var, grp, lab, vals, level, n_miss)
        rows.append(r)
        shown.append({**r, "_a": gn, "_b": tn})
    b.descriptives(rows)
    return shown


def mixed_warnings(b: ResultBuilder, d: dict, sequential: bool = False) -> None:
    ng = np.bincount(d["g"], minlength=len(d["gl"]))
    cell_counts_warning(b, dict(zip(d["gnames"], (int(x) for x in ng))), what="groups", sequential=sequential)
    b.warn(ties_warning(d["y"].ravel(), d["outcome_label"]))
    if d["notes"]:
        n = d["y"].shape[0]
        b.warn(warning("pairs_dropped", "info", "A mixed ANOVA needs each person's score at every time point, so some "
                       "people were left out: " + "; ".join(d["notes"]) + f". {n} complete people were analysed."))


def mixed_inputs(b: ResultBuilder, d: dict) -> None:
    ng = np.bincount(d["g"], minlength=len(d["gl"]))
    b.inputs(d["y"].shape[0], d["n_excluded"], [({d["gname"]: lv}, int(ng[i])) for i, lv in enumerate(d["gl"])])


def mixed_term_labels(d: dict) -> dict:
    return {"G": d["glabel"], "T": d["tlabel"], "GT": f"{d['glabel']} {TIMES} {d['tlabel']}"}


# ---------------------------------------------------------------------------
# anova.mixed
# ---------------------------------------------------------------------------
@register("anova.mixed", label="Mixed ANOVA (between x within)", roles=MIXED_ROLES,
          options={"correction": "\"auto\" (default: Greenhouse-Geisser when Mauchly's test is significant), "
                                 "\"none\", \"gg\" or \"hf\": which F is the headline for the within-subjects "
                                 "effects; all are reported."})
def mixed(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    require_two_sided(request, "A mixed ANOVA")
    level, alpha = request.ci_level, request.alpha
    correction = str(request.options.get("correction") or "auto").lower()
    if correction not in CORRECTIONS:
        raise InvalidParams("options.correction must be \"auto\", \"none\", \"gg\" or \"hf\".")
    d = mixed_data(df, request, meta)
    y, g = d["y"], d["g"]
    (n, k), G = y.shape, len(d["gl"])
    t = mixed_table(y, g, G)
    s = pooled_sphericity(y, g, G)
    used = correction if correction != "auto" else ("gg" if (s.p is not None and s.p < alpha) else "none")
    labels = mixed_term_labels(d)
    b = ResultBuilder(request)
    shown = mixed_descriptives(b, d, level)

    tg = t["G"]
    b.statistic("F", "F", "F", tg["f"], [tg["df"], tg["dfe"]] if tg["f"] is not None else [], tg["p"], term=labels["G"])
    rows = [dict(label=labels["G"], ss=tg["ss"], df=[tg["df"], tg["dfe"]], f=tg["f"], p=tg["p"], interaction=False,
                 key="G")]
    rows.append(dict(error=True, label="Error (between)", ss=t["ss_eb"], df=t["dfb"]))
    for key in ("T", "GT"):
        tt = t[key]
        f, df1, df2 = tt["f"], tt["df"], tt["dfe"]
        ok = f is not None and math.isfinite(s.gg)

        def corrected(eps):
            if not ok:
                return None, []
            return float(stats.f.sf(f, df1 * eps, df2 * eps)), [df1 * eps, df2 * eps]

        p_gg, df_gg = corrected(s.gg)
        p_hf, df_hf = corrected(s.hf)
        recs = {"none": ("F", "F (sphericity assumed)", tt["p"], [df1, df2] if f is not None else []),
                "gg": ("F_gg", "F (Greenhouse-Geisser)", p_gg, df_gg),
                "hf": ("F_hf", "F (Huynh-Feldt)", p_hf, df_hf)}
        for c in [used] + [c for c in ("none", "gg", "hf") if c != used]:
            kk, lab, p, dfs = recs[c]
            b.statistic(kk, lab, "F", f, dfs, p, term=labels[key])
        _, _, p_head, df_head = recs[used]
        rows.append(dict(label=labels[key], ss=tt["ss"], df=df_head if df_head else [df1, df2], f=f, p=p_head,
                         interaction=key == "GT", key=key,
                         corrected=[{"label": "Greenhouse-Geisser", "df": df_gg, "p": p_gg},
                                    {"label": "Huynh-Feldt", "df": df_hf, "p": p_hf}] if k > 2 else []))
    rows.append(dict(error=True, label="Error (within)", ss=t["ss_ew"], df=t["dfw"]))
    b.statistic("epsilon_gg", "Greenhouse-Geisser epsilon", "ε", s.gg, term=labels["T"])
    b.statistic("epsilon_hf", "Huynh-Feldt epsilon (capped at 1)", "ε", s.hf, term=labels["T"])

    ges_text = []
    for row in (r for r in rows if not r.get("error")):
        es = mixed_effects(t, row["key"], level)
        row["pes"] = es["partial_eta_sq"]
        ges_text.append(f"{row['label']} {apa.no_zero(es['generalized_eta_sq'].value)}")
        b.effect("partial_eta_sq", "Partial eta squared", "η²p", es["partial_eta_sq"], "eta_sq", term=row["label"],
                 what="effect")
        b.effect("generalized_eta_sq", "Generalized eta squared", "η²G", es["generalized_eta_sq"], "eta_sq",
                 term=row["label"], what="effect")
        b.effect("omega_sq", "Partial omega squared", "ω²p", es["omega_sq"], "eta_sq", term=row["label"], what="effect")
        b.effect("cohens_f", "Cohen's f", "f", es["cohens_f"], "cohens_f", term=row["label"], what="effect")

    b.assumption(sph.assumption(s, k, n, alpha, used))
    b.assumption(box_m_assumption(box_m(y, g, G), n))
    _, m = group_means(y, g, G)
    for j, tn in enumerate(d["tnames"]):
        grp = {d["time_var"]: d["time_levels"][j]} if d["time_var"] else None
        lev, _ = asm.levene_brown_forsythe({gn: y[g == i, j] for i, gn in enumerate(d["gnames"])},
                                           asm.scope("group", tn, grp), alpha,
                                           failed_note="The F tests are fairly robust to this when the groups are "
                                           "about the same size.")
        b.assumption(lev)
        b.assumption(*asm.shapiro_wilk(y[:, j] - m[g, j], asm.scope("residuals", tn, grp), alpha,
                                       chart_prefix="residuals"))
    mixed_warnings(b, d)
    if t["T"]["f"] is None:
        b.warn(constant_warning("the changes between time points"))
    marg, inter = emmeans_mixed(d, level)
    b.chart("marginal_means", marg).chart("interaction_plot", inter)
    mixed_inputs(b, d)

    terms = [r for r in rows if not r.get("error")]
    corr_txt = {"none": "", "gg": " (Greenhouse-Geisser corrected for the within-subjects effects)",
                "hf": " (Huynh-Feldt corrected for the within-subjects effects)"}[used]
    r = Rich().t(f"A {G} {TIMES} {k} mixed ANOVA{corr_txt} of {d['outcome_label']}, with {d['glabel']} between "
                 f"subjects and {d['tlabel'].lower() if d['tlabel'] == 'Time' else d['tlabel']} within subjects, showed ")
    term_sentence(r, terms, alpha, level)
    summary = (f"{n} people in {G} groups ({d['glabel']}) were each measured {k} times. " + term_summary(terms, alpha))
    if terms[2]["f"] is not None and terms[2]["p"] < alpha:
        summary += (" Because the groups changed differently over time, simple-effects tests show where they "
                    "differ.")
    if used == "gg" and correction == "auto":
        summary += (" Because the spread of changes differed between time points, a Greenhouse-Geisser correction "
                    "was applied to the time effects.")
    b.sentence(r).summary(summary)
    note = Rich().t("Type III sums of squares (sum-to-zero contrasts). ").extend(ETA_P).t(" = partial eta squared; "
                                                                                         "generalized ").extend(ETA_G) \
        .t(": " + "; ".join(ges_text) + ". ")
    if s.w is not None:
        note.t("Mauchly's ").i("W").t(f" = {apa.num(s.w)}, ").p(s.p).t("; ")
    note.i("ε").t(f" (Greenhouse-Geisser) = {apa.num(s.gg)}, ").i("ε").t(f" (Huynh-Feldt) = {apa.num(s.hf)}.")
    b.table(anova_table(f"Mixed ANOVA of {d['outcome_label']} by {d['glabel']} and {d['tlabel']}", rows, [], level,
                        note))
    b.extra_table(cell_table(f"Descriptive Statistics for {d['outcome_label']} by {d['glabel']} and {d['tlabel']}",
                             shown, d["glabel"], d["tlabel"], level))
    return b.build()
