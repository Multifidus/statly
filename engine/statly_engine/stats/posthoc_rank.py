"""Rank-based post hoc tests (SPEC §8): Dunn after Kruskal-Wallis; Conover and Nemenyi after Friedman.
Reference: fixtures/r/nonparametric.R (PMCMRplus 1.9).

Conventions:
- Every pair of levels / conditions (a, b), a listed first; statistics are signed as a minus b
  (PMCMRplus prints Dunn's and Nemenyi's as absolute values; p-values are unaffected).
- posthoc.dunn = PMCMRplus::kwAllPairsDunnTest: z = (mean rank a - mean rank b) / SE with the tie
  correction, two-sided normal p, adjusted by options.adjust = "holm" (default), "bonferroni",
  "bh" (Benjamini-Hochberg FDR) or "none".
- posthoc.conover = PMCMRplus::frdAllPairsConoverTest: t on the within-block rank sums with
  df = (n - 1)(k - 1), adjusted by options.adjust (default "holm"; also "bonferroni", "bh", "none", or
  "single-step" = PMCMRplus's default Tukey-type q = sqrt(2) t with ptukey(df = Inf)).
- posthoc.nemenyi = PMCMRplus::frdAllPairsNemenyiTest: q = sqrt(2) |mean rank difference| /
  sqrt(k(k + 1) / (6n)), single-step studentized-range p (df = Inf); no tie correction, as in R.
- Friedman post hocs use complete cases (wide or long layout, as `friedman`).
- Each pair also reports a rank-biserial correlation (independent for Dunn, paired for Conover /
  Nemenyi) with effectsize's CI; the p in `statistics` is the adjusted one.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy import stats

from statly_engine.errors import InvalidParams
from statly_engine.stats import apa, effect_sizes_rank as esr
from statly_engine.stats.apa import Rich
from statly_engine.stats.core import ResultBuilder, finite, missing_warning, warning
from statly_engine.stats.descriptives import cell
from statly_engine.stats.nonparametric import REPEATED_ROLES, dropped_warning, groups_data, repeated_data
from statly_engine.stats.registry import Role, register

ADJUST = {"holm": "Holm", "bonferroni": "Bonferroni", "bh": "Benjamini-Hochberg (FDR)", "none": "no adjustment",
          "single-step": "single-step (Tukey-type studentized range)"}
_ALIASES = {"fdr": "bh", "benjamini-hochberg": "bh", "single_step": "single-step"}


def _adjust_method(request, allowed: tuple[str, ...]) -> str:
    raw = str(request.options.get("adjust", "holm")).strip().lower()
    method = _ALIASES.get(raw, raw)
    if method not in allowed:
        raise InvalidParams("options.adjust must be one of: " + ", ".join(f'"{a}"' for a in allowed) + ".")
    return method


def p_adjust(p: list[float], method: str) -> list[float]:
    """stats::p.adjust for holm / bonferroni / BH / none."""
    p = np.asarray(p, float)
    m = len(p)
    if method in ("none", "single-step") or m == 0:
        return p.tolist()
    if method == "bonferroni":
        return np.minimum(1.0, m * p).tolist()
    if method == "holm":
        o = np.argsort(p, kind="stable")
        adj = np.minimum(1.0, np.maximum.accumulate((m - np.arange(m)) * p[o]))
    else:  # bh
        o = np.argsort(-p, kind="stable")
        i = np.arange(m, 0, -1)
        adj = np.minimum(1.0, np.minimum.accumulate(m / i * p[o]))
    out = np.empty(m)
    out[o] = adj
    return out.tolist()


def _pairs(k: int) -> list[tuple[int, int]]:
    return [(i, j) for i in range(k - 1) for j in range(i + 1, k)]


def _build(b: ResultBuilder, request, names, pairs, key, label, sym, stat_vals, df, p_raw, p_adj, rbs,
           method_text: str, family_text: str, title: str) -> None:
    level, alpha = request.ci_level, request.alpha
    for (i, j), s, pa in zip(pairs, stat_vals, p_adj):
        b.statistic(key, label, sym, s, df, pa, term=f"{names[i]} - {names[j]}")
    for (i, j), rb in zip(pairs, rbs):
        b.effect("rank_biserial", "Rank-biserial correlation", "r_rb", rb, "r", term=f"{names[i]} - {names[j]}")
    sig = [(names[i], names[j]) for (i, j), pa in zip(pairs, p_adj) if finite(pa) and pa < alpha]
    if sig:
        listing = "; ".join(f"{a} and {c}" for a, c in sig)
        summary = (f"After adjusting for making {len(pairs)} comparisons ({method_text}), these pairs differed: "
                   f"{listing}." + (" The other pairs did not differ significantly." if len(sig) < len(pairs) else ""))
    else:
        summary = (f"After adjusting for making {len(pairs)} comparisons ({method_text}), no pair of {family_text} "
                   "differed significantly.")
    b.summary(summary)
    r = Rich().t(f"Pairwise comparisons ({title}, {method_text}) ")
    if sig:
        (i, j), s, pa, rb = next(((ij, s, pa, rb) for ij, s, pa, rb in zip(pairs, stat_vals, p_adj, rbs)
                                  if finite(pa) and pa < alpha))
        r.t(f"showed that {names[i]} and {names[j]} differed, ").stat(sym, df, s).t(", ").p(pa)
        if rb.value is not None:
            r.t(", ").es(Rich().i("r").sub("rb"), rb.value, rb.lower, rb.upper, level, bounded=True)
        r.t(f"; {len(sig)} of {len(pairs)} pairs differed significantly.")
    else:
        r.t(f"showed no significant differences among the {len(names)} {family_text}.")
    b.sentence(r)
    cols = [apa.column("pair", "Comparison", "left"), apa.column("stat", Rich().i(sym))]
    if df:
        cols.append(apa.column("df", Rich().i("df")))
    cols += [apa.column("p", Rich().i("p")), apa.column("p_adj", Rich().i("p").sub("adj", italic=False)),
             apa.column("rb", Rich().i("r").sub("rb")), apa.column("ci", f"{apa.level_text(level)} CI")]
    rows = []
    for (i, j), s, pr, pa, rb in zip(pairs, stat_vals, p_raw, p_adj, rbs):
        cells = [apa.cell_text(f"{names[i]} vs {names[j]}"), apa.cell_num(s)]
        if df:
            cells.append(apa.cell_df(df[0]))
        cells += [apa.cell_p(pr), apa.cell_p(pa), apa.cell_num(rb.value, bounded=True),
                  apa.cell_ci(rb.lower, rb.upper, bounded=True)]
        rows.append(apa.row(cells))
    note = Rich().t(f"Statistics are signed as the first minus the second. ").i("p").sub("adj", italic=False) \
        .t(f" = {method_text}. ").i("r").sub("rb").t(" = rank-biserial correlation for the pair.")
    b.table(apa.table(f"Pairwise Comparisons: {title}", cols, rows, general_note=note))


@register("posthoc.dunn", label="Dunn's test (after Kruskal-Wallis)",
          roles=[Role("outcome", 1, 1, "Scores to compare"), Role("group", 1, 1, "Grouping variable (2+ groups)")],
          options={"adjust": "\"holm\" (default), \"bonferroni\", \"bh\" (false discovery rate) or \"none\".",
                   "levels": "Group values to include, in display order."})
def dunn(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    method = _adjust_method(request, ("holm", "bonferroni", "bh", "none"))
    g = groups_data(df, request, meta, None, "Dunn's test")
    names, clean, level = g["names"], g["clean"], request.ci_level
    k = len(names)
    values = np.concatenate(clean)
    codes = np.concatenate([np.full(len(a), i) for i, a in enumerate(clean)])
    n = len(values)
    ranks = esr.rank(values)
    rbar = [float(ranks[codes == i].mean()) for i in range(k)]
    ns = [len(a) for a in clean]
    c = esr.tie_sum(ranks) / (12 * (n - 1)) if n > 1 else 0.0
    a = n * (n + 1) / 12
    pairs = _pairs(k)
    z = []
    for i, j in pairs:
        se2 = (a - c) * (1 / ns[i] + 1 / ns[j])
        z.append((rbar[i] - rbar[j]) / math.sqrt(se2) if se2 > 0 else float("nan"))
    p_raw = [float(2 * stats.norm.sf(abs(v))) if finite(v) else float("nan") for v in z]
    p_adj = p_adjust(p_raw, method)
    rbs = [esr.rank_biserial_independent(clean[i], clean[j], level) for i, j in pairs]

    b = ResultBuilder(request)
    b.descriptives([cell(g["yname"], {g["gname"]: lv}, nm, raw, level)
                    for lv, nm, raw in zip(g["levels"], names, g["raw"])])
    _build(b, request, names, pairs, "z", "Dunn's z", "z", z, [], p_raw, p_adj, rbs, ADJUST[method], "groups",
           f"Dunn's Test of {g['vl']} by {g['gl']}")
    b.warn(missing_warning(g["n_excluded"]))
    b.inputs(n, g["n_excluded"], [({g["gname"]: lv}, len(x)) for lv, x in zip(g["levels"], clean)])
    return b.build()


def _friedman_posthoc(df, request, meta, which: str) -> dict:
    level = request.ci_level
    data = repeated_data(df, request, meta, None, "This post hoc test")
    m, names = data["m"], data["names"]
    n, k = m.shape
    if n < 2:
        raise InvalidParams(f"This post hoc test needs at least 2 people with every score; there are {n}.")
    ranks = esr.friedman_ranks(m)
    pairs = _pairs(k)
    if which == "conover":
        method = _adjust_method(request, ("holm", "bonferroni", "bh", "none", "single-step"))
        rsum = ranks.sum(axis=0)
        s2 = 1 / (k - 1) * (float(np.sum(ranks ** 2)) - k * n * (k + 1) ** 2 / 4)
        t2 = float(np.sum((rsum - n * (k + 1) / 2) ** 2)) / s2 if s2 > 0 else float("nan")
        dfe = (n - 1) * (k - 1)
        aa = s2 * 2 * n * (k - 1) / dfe
        bb = 1 - t2 / (n * (k - 1))
        se = math.sqrt(aa * bb) if finite(aa) and finite(bb) and aa * bb > 0 else float("nan")
        t = [(rsum[i] - rsum[j]) / se if finite(se) else float("nan") for i, j in pairs]
        if method == "single-step":
            key, sym, df_, label = "q", "q", [], "Conover's q (single-step)"
            stat_vals = [math.sqrt(2) * v for v in t]
            p_raw = [float(stats.studentized_range.sf(abs(v), k, np.inf)) if finite(v) else float("nan")
                     for v in stat_vals]
        else:
            key, sym, df_, label = "t", "t", [dfe], "Conover's t"
            stat_vals = t
            p_raw = [float(2 * stats.t.sf(abs(v), dfe)) if finite(v) else float("nan") for v in t]
        p_adj = p_adjust(p_raw, method)
        title, method_text = "Conover Test After Friedman", ADJUST[method]
    else:
        mr = ranks.mean(axis=0)
        se = math.sqrt(k * (k + 1) / (6 * n))
        key, sym, df_, label = "q", "q", [], "Nemenyi q"
        stat_vals = [math.sqrt(2) * (mr[i] - mr[j]) / se for i, j in pairs]
        p_raw = [float(stats.studentized_range.sf(abs(v), k, np.inf)) for v in stat_vals]
        p_adj = list(p_raw)
        title, method_text = "Nemenyi Test After Friedman", ADJUST["single-step"]
    rbs = [esr.rank_biserial_paired(m[:, i] - m[:, j], level) for i, j in pairs]

    b = ResultBuilder(request)
    b.descriptives([cell(v, gr, nm, m[:, j], level, nmiss) for j, (v, gr, nm, nmiss) in
                    enumerate(zip(data["variables"], data["groups"], names, data["n_missing"]))])
    _build(b, request, names, pairs, key, label, sym, stat_vals, df_, p_raw, p_adj, rbs, method_text,
           "time points", title)
    b.warn(dropped_warning(data["notes"], n))
    if which == "nemenyi" and any(esr.tie_sum(row) > 0 for row in ranks):
        b.warn(warning("ties_present", "info", "Some people have tied scores across time points. The Nemenyi test "
                       "does not correct for ties (as in R's PMCMRplus), so its p-values are slightly conservative."))
    b.inputs(n, data["n_excluded"], [(gr, n) for gr in data["groups"]] if data["groups"][0] else [])
    return b.build()


@register("posthoc.conover", label="Conover's test (after Friedman)", roles=REPEATED_ROLES,
          options={"adjust": "\"holm\" (default), \"bonferroni\", \"bh\", \"none\", or \"single-step\" "
                             "(PMCMRplus default).",
                   "levels": "Long layout: time values to include, in order."})
def conover(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    return _friedman_posthoc(df, request, meta, "conover")


@register("posthoc.nemenyi", label="Nemenyi test (after Friedman)", roles=REPEATED_ROLES,
          options={"levels": "Long layout: time values to include, in order."})
def nemenyi(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    return _friedman_posthoc(df, request, meta, "nemenyi")
