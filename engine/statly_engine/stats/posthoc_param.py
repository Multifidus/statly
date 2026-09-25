"""Parametric post hoc comparisons (SPEC §8, §9): Tukey HSD, Games-Howell, Bonferroni/Holm pairwise t.

Each analysis returns one Statistic (key "t", term "A vs B") and two EffectSizes per pair: the mean
difference with its multiplicity-adjusted CI, and a standardized difference with an unadjusted CI
(Hedges' g, pooled over the two groups, from effect_sizes.hedges_g; d_av for repeated measures, the
paired-t convention). Direction is first level minus second (emmeans `pairs`); R's TukeyHSD and
rstatix report second minus first. Reference: fixtures/r/anova.R.

- posthoc.tukey: Tukey HSD with the one-way ANOVA MSE (df = N - k). t = diff / SE with
  SE = sqrt(MSE (1/n_i + 1/n_j)); p = P(Q > |t| sqrt 2) for the studentized range with k means and
  N - k df (scipy.stats.studentized_range); CI = diff +/- q_(level; k, N-k) SE / sqrt 2. Matches
  stats::TukeyHSD and emmeans(adjust = "tukey") (Tukey-Kramer for unequal n).
- posthoc.games_howell: per-pair Welch SE sqrt(s_i²/n_i + s_j²/n_j) and Welch-Satterthwaite df,
  then the studentized range as above with k means. Matches rstatix::games_howell_test. A pair of two
  zero-variance groups is undefined (null), as in rstatix.
- posthoc.pairwise: Student t with the pooled SD of all groups (df = N - k), p adjusted by Holm
  (default) or Bonferroni (options.adjust), matching pairwise.t.test(pool.sd = TRUE). Repeated
  measures (wide or long layout): paired t per pair with Holm/Bonferroni, matching
  pairwise.t.test(paired = TRUE). CIs are Bonferroni-adjusted (level 1 - (1 - ci)/m) for both
  methods, as emmeans does for Holm (no simultaneous Holm interval exists).
Statly never corrects across analyses automatically (SPEC §9); these corrections are the post hoc
tests' own, within one family of pairwise comparisons.
"""

from __future__ import annotations

import math
import warnings
from itertools import combinations

import numpy as np
import pandas as pd
from scipy import stats

from statly_engine.errors import InvalidParams
from statly_engine.stats import apa, effect_sizes as es
from statly_engine.stats.anova import (BETWEEN_ROLES, LEVELS_OPT, RM_ROLES, between_data, between_descriptives,
                                       between_warnings, classical_f, descriptives_table, p_phrase, require_two_sided,
                                       rm_data, rm_descriptives, rm_inputs, rm_warnings)
from statly_engine.stats.apa import Rich
from statly_engine.stats.core import ResultBuilder
from statly_engine.stats.effect_sizes import Estimate
from statly_engine.stats.registry import register

ADJUST = {"holm", "bonferroni"}


def _srange(fn: str, x: float, k: int, df: float) -> float:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return float(getattr(stats.studentized_range, fn)(x, k, df))


def p_adjust(p: list[float | None], method: str) -> list[float | None]:
    """stats::p.adjust for "bonferroni" / "holm" (None entries are skipped and not counted)."""
    idx = [i for i, v in enumerate(p) if v is not None]
    m = len(idx)
    out: list[float | None] = [None] * len(p)
    if method == "bonferroni":
        for i in idx:
            out[i] = min(1.0, m * p[i])
        return out
    running = 0.0
    for rank, i in enumerate(sorted(idx, key=lambda i: p[i])):
        running = max(running, min(1.0, (m - rank) * p[i]))
        out[i] = running
    return out


def _pairs(k: int) -> list[tuple[int, int]]:
    return list(combinations(range(k), 2))


def _row(comp: dict, level: float) -> dict:
    md, g = comp["md"], comp["es"]
    return apa.row([apa.cell_text(comp["term"]), apa.cell_num(md.value), apa.cell_ci(md.lower, md.upper),
                    apa.cell_num(comp["t"]), apa.cell_df(comp["df"]), apa.cell_p(comp["p"]),
                    apa.cell_num(g.value), apa.cell_ci(g.lower, g.upper)])


def _finish(b: ResultBuilder, comps: list[dict], title: str, method_note: Rich, es_key: str, es_label: str,
            es_sym: "str | Rich", es_sym_text: str, level: float, alpha: float, what: str) -> None:
    for c in comps:
        b.statistic("t", "t (pairwise comparison)", "t", c["t"], [c["df"]] if c["t"] is not None else [], c["p"],
                    term=c["term"])
    for c in comps:
        b.effect("mean_difference", "Mean difference", "Mdiff", c["md"], term=c["term"])
        b.effect(es_key, es_label, es_sym_text, c["es"], "d", term=c["term"])
    sig = [c for c in comps if c["p"] is not None and c["p"] < alpha]
    r = Rich()
    if not sig:
        r.t(f"{what} found no significant pairwise differences (all adjusted ").i("p").t(f"s ≥ {apa.no_zero(alpha)}).")
        summary = (f"None of the {len(comps)} pairs differed clearly: every difference could easily be due to chance "
                   "once the number of comparisons is taken into account.")
    else:
        r.t(f"{what} showed significant differences between ")
        for n_, c in enumerate(sig):
            if n_:
                r.t("; " if len(sig) > 2 else " and ")
            a, bb = c["names"]
            r.t(f"{a} and {bb} (").i("M").sub("diff").t(f" = {apa.num(c['md'].value)}, ") \
                .t(f"{apa.level_text(level)} CI {apa.ci_text(c['md'].lower, c['md'].upper)}, ").p(c["p"]).t(", ") \
                .symbol(es_sym).t(f" = {apa.num(c['es'].value)})")
        r.t(".")
        parts = []
        for c in sig:
            a, bb = c["names"]
            hi, lo = (a, bb) if c["md"].value > 0 else (bb, a)
            parts.append(f"{hi} scored higher than {lo} ({p_phrase(c['p'])})")
        summary = (f"{len(sig)} of the {len(comps)} pairs differed by more than chance would explain, after "
                   "adjusting for the number of comparisons: " + "; ".join(parts) + ".")
    b.sentence(r).summary(summary)
    cols = [apa.column("comparison", "Comparison", "left"), apa.column("md", Rich().i("M").sub("diff")),
            apa.column("ci", f"{apa.level_text(level)} CI"), apa.column("t", Rich().i("t")),
            apa.column("df", Rich().i("df")), apa.column("p", Rich().i("p")), apa.column("es", es_sym if isinstance(
                es_sym, Rich) else Rich().i(es_sym)), apa.column("es_ci", f"{apa.level_text(level)} CI")]
    b.table(apa.table(title, cols, [_row(c, level) for c in comps], general_note=method_note))


# ---------------------------------------------------------------------------
# Between-subjects post hoc tests
# ---------------------------------------------------------------------------
def _between(df: pd.DataFrame, request, meta, method: str) -> dict:
    require_two_sided(request, "A post hoc comparison")
    level, alpha = request.ci_level, request.alpha
    adjust = str(request.options.get("adjust") or "holm").lower()
    if method == "pairwise" and adjust not in ADJUST:
        raise InvalidParams("options.adjust must be \"holm\" or \"bonferroni\".")
    d = between_data(df, request, meta)
    xs, k = d["xs"], len(d["xs"])
    b = ResultBuilder(request)
    rows = between_descriptives(b, d, level)
    cf = classical_f(xs)
    mse, df_e = cf["ms_w"], cf["df2"]
    pairs = _pairs(k)
    m = len(pairs)
    comps = []
    q_tukey = _srange("ppf", level, k, df_e) if method == "tukey" and df_e > 0 else None
    t_bonf = stats.t.ppf(1 - (1 - level) / (2 * m), df_e) if method == "pairwise" and df_e > 0 else None
    for i, j in pairs:
        x, y = xs[i], xs[j]
        ni, nj = len(x), len(y)
        diff = float(np.mean(x) - np.mean(y))
        t = p = dfp = None
        lo = hi = None
        if method in ("tukey", "pairwise"):
            se = math.sqrt(mse * (1 / ni + 1 / nj)) if mse else 0.0
            dfp = df_e
            if se > 0:
                t = diff / se
                if method == "tukey":
                    p = _srange("sf", abs(t) * math.sqrt(2), k, df_e)
                    half = q_tukey / math.sqrt(2) * se
                else:
                    p = float(2 * stats.t.sf(abs(t), df_e))
                    half = t_bonf * se
                lo, hi = diff - half, diff + half
        else:  # games_howell
            vi = float(np.var(x, ddof=1)) if ni > 1 else float("nan")
            vj = float(np.var(y, ddof=1)) if nj > 1 else float("nan")
            a, c = vi / ni, vj / nj
            se = math.sqrt(a + c) if math.isfinite(a + c) else float("nan")
            if se > 0:
                dfp = (a + c) ** 2 / (a * a / (ni - 1) + c * c / (nj - 1))
                t = diff / se
                p = _srange("sf", abs(t) * math.sqrt(2), k, dfp)
                half = _srange("ppf", level, k, dfp) * se / math.sqrt(2)
                lo, hi = diff - half, diff + half
        comps.append(dict(term=f"{d['names'][i]} vs {d['names'][j]}", names=(d["names"][i], d["names"][j]),
                          t=t, p=p, df=dfp if t is not None else None,
                          md=Estimate(diff, lo, hi, level), es=es.hedges_g(x, y, True, level)))
    if method == "pairwise":
        for c, pa in zip(comps, p_adjust([c["p"] for c in comps], adjust)):
            c["p"] = pa
    between_warnings(b, d)
    b.inputs(d["n_used"], d["n_excluded"], [({d["gname"]: lv}, len(x)) for lv, x in zip(d["levels"], xs)])

    label = {"tukey": "Tukey HSD", "games_howell": "Games-Howell",
             "pairwise": f"{adjust.capitalize()}-adjusted pairwise t"}[method]
    note = Rich()
    if method == "tukey":
        note.i("p").t(" values and CIs of the mean differences are adjusted for all "
                      f"{m} comparisons (Tukey HSD, equal variances assumed). ")
    elif method == "games_howell":
        note.i("p").t(" values and CIs of the mean differences are adjusted for all "
                      f"{m} comparisons (Games-Howell; equal variances not assumed). ")
    else:
        note.i("p").t(f" values are {adjust.capitalize()}-adjusted for {m} comparisons (pooled SD); CIs of the mean "
                      "differences are Bonferroni-adjusted. ")
    note.i("g").t(" = Hedges' g with an unadjusted CI.")
    _finish(b, comps, f"{label} Comparisons of {d['vl']} by {d['gl']}", note, "hedges_g", "Hedges' g", "g", "g",
            level, alpha, f"{label} comparisons of {d['vl']}")
    b.extra_table(descriptives_table(f"Descriptive Statistics for {d['vl']} by {d['gl']}", rows, d["gl"], level))
    return b.build()


@register("posthoc.tukey", label="Tukey HSD post hoc test", roles=BETWEEN_ROLES, options=LEVELS_OPT)
def tukey(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    return _between(df, request, meta, "tukey")


@register("posthoc.games_howell", label="Games-Howell post hoc test", roles=BETWEEN_ROLES, options=LEVELS_OPT)
def games_howell(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    return _between(df, request, meta, "games_howell")


# ---------------------------------------------------------------------------
# Pairwise t (between or repeated measures)
# ---------------------------------------------------------------------------
def _within(df: pd.DataFrame, request, meta) -> dict:
    require_two_sided(request, "A post hoc comparison")
    level, alpha = request.ci_level, request.alpha
    adjust = str(request.options.get("adjust") or "holm").lower()
    if adjust not in ADJUST:
        raise InvalidParams("options.adjust must be \"holm\" or \"bonferroni\".")
    d = rm_data(df, request, meta)
    y = d["y"]
    n, k = y.shape
    b = ResultBuilder(request)
    rows = rm_descriptives(b, d, level)
    pairs = _pairs(k)
    m = len(pairs)
    comps = []
    for i, j in pairs:
        diffs = y[:, i] - y[:, j]
        md = float(np.mean(diffs))
        t = p = None
        lo = hi = None
        if np.ptp(diffs) > 0:
            res = stats.ttest_rel(y[:, i], y[:, j])
            t, p = float(res.statistic), float(res.pvalue)
            ci = res.confidence_interval(1 - (1 - level) / m)
            lo, hi = float(ci.low), float(ci.high)
        comps.append(dict(term=f"{d['names'][i]} vs {d['names'][j]}", names=(d["names"][i], d["names"][j]),
                          t=t, p=p, df=n - 1, md=Estimate(md, lo, hi, level), es=es.d_av(y[:, i], y[:, j], level)))
    for c, pa in zip(comps, p_adjust([c["p"] for c in comps], adjust)):
        c["p"] = pa
    rm_warnings(b, d)
    rm_inputs(b, d)
    note = Rich().i("p").t(f" values are {adjust.capitalize()}-adjusted for {m} paired comparisons; CIs of the mean "
                           "differences are Bonferroni-adjusted. ").i("d").sub("av") \
        .t(" = mean difference divided by the average SD of the two time points (unadjusted CI).")
    sym = Rich().i("d").sub("av")
    _finish(b, comps, f"Pairwise Comparisons of {d['outcome_label']} Across Time Points", note, "d_av",
            "Cohen's d_av", sym, "d_av", level, alpha, f"{adjust.capitalize()}-adjusted paired t tests")
    b.extra_table(descriptives_table(f"Descriptive Statistics for {d['outcome_label']} at Each Time Point", rows,
                                     "Time point", level))
    return b.build()


@register("posthoc.pairwise", label="Pairwise t tests (Bonferroni/Holm)",
          roles={"between": BETWEEN_ROLES, **RM_ROLES},
          options={"adjust": "\"holm\" (default) or \"bonferroni\".", **LEVELS_OPT})
def pairwise(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    if "group" in request.variables and request.variables["group"]:
        return _between(df, request, meta, "pairwise")
    return _within(df, request, meta)
