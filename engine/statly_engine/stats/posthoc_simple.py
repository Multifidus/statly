"""Simple-effects follow-up tests for two-way and mixed designs (SPEC §8). Reference: fixtures/r/factorial.R.

For each level of the `by` factor, the effect of the other factor is tested with an F test
(emmeans::joint_tests(model, by = ...)) and its levels are compared pairwise
(pairs(emmeans(model, ~ effect | by), adjust = "holm")). Matches emmeans exactly:
- Between (two `factors`): lm(y ~ A * B) with the pooled MSE, df = N - ab. Joint F = Wald test of the
  cell means at that level with covariance diag(MSE / n_ij); pair SE = sqrt(MSE (1/n_i + 1/n_j)).
- Mixed (`between` + repeated measures): afex's default emmeans_model = "multivariate" (the wide mlm):
  S = pooled within-group covariance of the raw scores, df = N - G. Time within a group: Wald F of the
  time means with covariance S / n_g, pair SE = sqrt(c' S c / n_g) (a paired comparison using the
  pooled covariance). Groups at a time point: covariance diag(S_tt / n_g), pair SE =
  sqrt(S_tt (1/n_i + 1/n_j)). The univariate alternative (afex emmeans_model = "univariate") pools the
  error strata with Satterthwaite df; Statly follows afex's default.
- p values: Holm (default) or Bonferroni (options.adjust) within each level of `by` (emmeans' family);
  CIs of the mean differences are Bonferroni-adjusted within that family, as emmeans gives for Holm.
- options.by: between designs, the name of either factor (default: the second factor, so the first
  factor's effect is tested at each level of the second). Mixed designs: "between" / the group variable
  (default: the time effect within each group) or "within" / "time" / the long-layout time variable
  (groups compared at each time point).
- Effect sizes: partial eta² implied by each joint F (effectsize::F_to_eta2), and the mean difference
  with its adjusted CI for each pair.
"""

from __future__ import annotations

import math
from itertools import combinations

import numpy as np
import pandas as pd
from scipy import stats

from statly_engine.errors import InvalidParams
from statly_engine.stats import apa, effect_sizes_anova as esa
from statly_engine.stats.anova import ETA_P, p_phrase, require_two_sided
from statly_engine.stats.anova_factorial import (FACTORIAL_ROLES, cell_table, factorial_data, factorial_descriptives,
                                                 factorial_inputs, factorial_warnings, type3)
from statly_engine.stats.anova_mixed import (MIXED_ROLES, group_means, mixed_data, mixed_descriptives, mixed_inputs,
                                             mixed_warnings, pooled_cov)
from statly_engine.stats.apa import Rich
from statly_engine.stats.core import ResultBuilder
from statly_engine.stats.effect_sizes import Estimate
from statly_engine.stats.posthoc_param import ADJUST, p_adjust
from statly_engine.stats.registry import register


def _consecutive(k: int) -> np.ndarray:
    lmat = np.zeros((k - 1, k))
    for i in range(k - 1):
        lmat[i, i], lmat[i, i + 1] = 1.0, -1.0
    return lmat


def wald_f(means: np.ndarray, cov: np.ndarray, df2: float) -> tuple[float | None, int, float, float | None]:
    """Joint test that all means are equal: F = (Lm)' (L V L')^-1 (Lm) / r (emmeans joint_tests)."""
    k = len(means)
    lmat = _consecutive(k)
    est = lmat @ means
    v = lmat @ cov @ lmat.T
    try:
        f = float(est @ np.linalg.solve(v, est)) / (k - 1)
    except np.linalg.LinAlgError:
        return None, k - 1, df2, None
    if not math.isfinite(f) or df2 <= 0:
        return None, k - 1, df2, None
    return f, k - 1, df2, float(stats.f.sf(f, k - 1, df2))


def family(level_name: str, names: list[str], means: np.ndarray, cov: np.ndarray, df2: float, adjust: str,
           ci: float) -> dict:
    """Joint F and adjusted pairwise comparisons among `means` at one level of `by`."""
    f, df1, _, p = wald_f(means, cov, df2)
    pairs = list(combinations(range(len(means)), 2))
    m = len(pairs)
    q = stats.t.ppf(1 - (1 - ci) / (2 * m), df2) if df2 > 0 else float("nan")
    comps = []
    for i, j in pairs:
        diff = float(means[i] - means[j])
        var = float(cov[i, i] + cov[j, j] - 2 * cov[i, j])
        se = math.sqrt(var) if var > 0 else 0.0
        t = pr = lo = hi = None
        if se > 0:
            t = diff / se
            pr = float(2 * stats.t.sf(abs(t), df2))
            lo, hi = diff - q * se, diff + q * se
        comps.append(dict(names=(names[i], names[j]), term=f"{names[i]} vs {names[j]} at {level_name}", t=t, p=pr,
                          df=df2, md=Estimate(diff, lo, hi, ci)))
    for c, pa in zip(comps, p_adjust([c["p"] for c in comps], adjust)):
        c["p"] = pa
    return dict(level=level_name, f=f, df=[df1, df2], p=p, comps=comps)


def _resolve_by(opt, candidates: dict[str, list[str]], default: str) -> str:
    if opt is None or opt == "":
        return default
    s = str(opt)
    for key, names in candidates.items():
        if s in names or s.lower() in [n.lower() for n in names]:
            return key
    allowed = sorted({n for names in candidates.values() for n in names})
    raise InvalidParams(f"options.by must name the factor to hold fixed: one of {', '.join(allowed)}.")


@register("posthoc.simple_effects", label="Simple-effects tests (two-way and mixed designs)",
          roles={"factorial": FACTORIAL_ROLES, **MIXED_ROLES},
          options={"by": "Factor held fixed. Two-way: either factor name (default: the second). Mixed: \"between\" "
                         "or the group variable (default: time compared within each group), or \"within\" / "
                         "\"time\" (groups compared at each time point).",
                   "adjust": "\"holm\" (default) or \"bonferroni\", within each level of `by`."})
def simple_effects(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    require_two_sided(request, "A simple-effects comparison")
    level, alpha = request.ci_level, request.alpha
    adjust = str(request.options.get("adjust") or "holm").lower()
    if adjust not in ADJUST:
        raise InvalidParams("options.adjust must be \"holm\" or \"bonferroni\".")
    by_opt = request.options.get("by")
    b = ResultBuilder(request)
    fams = []
    if "factors" in request.variables and request.variables["factors"]:
        d = factorial_data(df, request, meta)
        by = _resolve_by(by_opt, {"A": [d["aname"], d["labs"]["a"]], "B": [d["bname"], d["labs"]["b"]]}, "B")
        ka, kb = len(d["al"]), len(d["bl"])
        t = type3(d["y"], d["a"], d["b"], ka, kb)
        mse, dfe = t["error"]["ms"], t["error"]["df"]
        n = d["counts"].astype(float)
        m = np.array([[np.mean(d["y"][(d["a"] == i) & (d["b"] == j)]) for j in range(kb)] for i in range(ka)])
        if by == "B":
            eff_label, by_label = d["labs"]["a"], d["labs"]["b"]
            for j in range(kb):
                fams.append(family(d["bnames"][j], d["anames"], m[:, j], np.diag(mse / n[:, j]), dfe, adjust, level))
        else:
            eff_label, by_label = d["labs"]["b"], d["labs"]["a"]
            for i in range(ka):
                fams.append(family(d["anames"][i], d["bnames"], m[i], np.diag(mse / n[i]), dfe, adjust, level))
        shown = factorial_descriptives(b, d, level)
        factorial_warnings(b, d)
        factorial_inputs(b, d)
        yl, h1, h2 = d["labs"]["y"], d["labs"]["a"], d["labs"]["b"]
        model_note = f"Pooled error from the two-way model (df = {dfe}). "
    else:
        d = mixed_data(df, request, meta)
        y, g = d["y"], d["g"]
        (nn, k), G = y.shape, len(d["gl"])
        within_names = ["within", "time", d["tlabel"]] + ([d["time_var"]] if d["time_var"] else [])
        by = _resolve_by(by_opt, {"between": ["between", d["gname"], d["glabel"]], "within": within_names},
                         "between")
        ng, m = group_means(y, g, G)
        s = pooled_cov(y, g, G)
        dfe = nn - G
        if by == "between":
            eff_label, by_label = d["tlabel"], d["glabel"]
            for i in range(G):
                fams.append(family(d["gnames"][i], d["tnames"], m[i], s / ng[i], dfe, adjust, level))
        else:
            eff_label, by_label = d["glabel"], d["tlabel"]
            for j in range(k):
                fams.append(family(d["tnames"][j], d["gnames"], m[:, j], np.diag(s[j, j] / ng), dfe, adjust, level))
        shown = mixed_descriptives(b, d, level)
        mixed_warnings(b, d)
        mixed_inputs(b, d)
        yl, h1, h2 = d["outcome_label"], d["glabel"], d["tlabel"]
        model_note = (f"Multivariate model (pooled within-group covariance, df = {dfe}), as afex/emmeans; "
                      "comparisons over time are paired. ")

    for fm in fams:
        fm["term"] = f"{eff_label} at {fm['level']}"
        b.statistic("F", "F (simple effect)", "F", fm["f"], fm["df"] if fm["f"] is not None else [], fm["p"],
                    term=fm["term"])
    for fm in fams:
        for c in fm["comps"]:
            b.statistic("t", "t (pairwise comparison)", "t", c["t"], [c["df"]] if c["t"] is not None else [], c["p"],
                        term=c["term"])
    for fm in fams:
        f = fm["f"]
        pes = (esa.pve_ci(f * fm["df"][0] / (f * fm["df"][0] + fm["df"][1]), fm["df"][0], fm["df"][1], level)
               if f is not None else Estimate(None, None, None, level))
        fm["pes"] = pes
        b.effect("partial_eta_sq", "Partial eta squared", "η²p", pes, "eta_sq", term=fm["term"], what="effect")
        for c in fm["comps"]:
            b.effect("mean_difference", "Mean difference", "Mdiff", c["md"], term=c["term"])

    r = Rich().t(f"Simple-effects tests of {eff_label} at each level of {by_label} showed ")
    parts = []
    for n_, fm in enumerate(fams):
        if n_:
            r.t("; " if n_ < len(fams) - 1 else "; and ")
        if fm["f"] is None:
            r.t(f"no test at {fm['level']}")
            continue
        sig = fm["p"] < alpha
        r.t(f"{'a significant' if sig else 'no significant'} effect at {fm['level']}, ").stat("F", fm["df"], fm["f"]) \
            .t(", ").p(fm["p"])
        if fm["pes"].value is not None:
            r.t(", ").es(ETA_P, fm["pes"].value, fm["pes"].lower, fm["pes"].upper, level, bounded=True)
        sig_pairs = [c for c in fm["comps"] if c["p"] is not None and c["p"] < alpha]
        if sig:
            desc = "; ".join(f"{(c['names'][0] if c['md'].value > 0 else c['names'][1])} higher than "
                             f"{(c['names'][1] if c['md'].value > 0 else c['names'][0])} ({p_phrase(c['p'])})"
                             for c in sig_pairs)
            parts.append(f"At {fm['level']}, {eff_label} made a difference ({p_phrase(fm['p'])})"
                         + (f": {desc}." if desc else ", although no single pair differed clearly after adjustment."))
        else:
            parts.append(f"At {fm['level']}, there was no clear difference across {eff_label} ({p_phrase(fm['p'])}).")
    r.t(".")
    summary = (f"To follow up the interaction, {eff_label} was compared separately at each level of {by_label}. "
               + " ".join(parts))
    b.sentence(r).summary(summary)

    cols = [apa.column("comparison", "Comparison", "left"), apa.column("md", Rich().i("M").sub("diff")),
            apa.column("ci", f"{apa.level_text(level)} CI"), apa.column("t", Rich().i("t")),
            apa.column("df", Rich().i("df")), apa.column("p", Rich().i("p"))]
    body = []
    for fm in fams:
        body.append(apa.row([apa.cell_text(f"{by_label}: {fm['level']}")] + [apa.cell_empty()] * 5,
                            kind="section_header"))
        for c in fm["comps"]:
            body.append(apa.row([apa.cell_text(f"{c['names'][0]} vs {c['names'][1]}"), apa.cell_num(c["md"].value),
                                 apa.cell_ci(c["md"].lower, c["md"].upper), apa.cell_num(c["t"]),
                                 apa.cell_df(c["df"]), apa.cell_p(c["p"])], indent=1))
    note = Rich().t(model_note).i("p").t(f" values are {adjust.capitalize()}-adjusted within each level of {by_label}; "
                                         "CIs of the mean differences are Bonferroni-adjusted.")
    b.table(apa.table(f"Pairwise Comparisons of {eff_label} at Each Level of {by_label}", cols, body,
                      general_note=note))
    fcols = [apa.column("level", by_label, "left"), apa.column("f", Rich().i("F")),
             apa.column("df1", Rich().i("df").sub("1")), apa.column("df2", Rich().i("df").sub("2")),
             apa.column("p", Rich().i("p")), apa.column("eta", ETA_P), apa.column("ci", f"{apa.level_text(level)} CI")]
    fbody = [apa.row([apa.cell_text(fm["level"]), apa.cell_num(fm["f"]), apa.cell_df(fm["df"][0]),
                      apa.cell_df(fm["df"][1]), apa.cell_p(fm["p"]), apa.cell_num(fm["pes"].value, bounded=True),
                      apa.cell_ci(fm["pes"].lower, fm["pes"].upper, bounded=True)]) for fm in fams]
    b.extra_table(apa.table(f"Simple Effects of {eff_label} at Each Level of {by_label}", fcols, fbody, number=2))
    b.extra_table(cell_table(f"Descriptive Statistics for {yl} by {h1} and {h2}", shown, h1, h2, level))
    return b.build()
