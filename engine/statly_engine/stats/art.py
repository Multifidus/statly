"""Aligned rank transform (ART) ANOVA, the nonparametric factorial option (SPEC §8).
Reference: fixtures/r/factorial.R (ARTool::art + anova, matched exactly).

Conventions (see also stats/README.md, "Factorial, mixed, ART, simple effects"):
- Alignment (Wobbrock et al. 2011, ARTool::art): for every effect, aligned = (y - cell mean) + the
  effect's estimate, built from observation-weighted means by inclusion-exclusion: main effect
  A: mean_A - grand; A x B: cell - mean_A - mean_B + grand. The aligned values are ranked (average
  ranks for ties) over all observations, and a full factorial model is fitted to the ranks; only the
  effect the ranks were aligned for is kept.
- Between designs (`outcome` + two `factors`): lm with sum-to-zero contrasts, Type III F
  (ARTool's default; the same Type III engine as anova.factorial).
- Mixed designs (`between` + repeated measures, wide or long): ARTool's `Error(id)` model is an aov with
  error strata, whose F tests are sequential (Type I): group on the between-subjects stratum; time then
  group x time on the within stratum. With equal group sizes this equals Type III. Statly reproduces
  ARTool (Type I) so results agree with published ART analyses.
- Effect size: partial eta² implied by each ART F, F df1 / (F df1 + df2) (as ARTool's vignette computes
  from the ANOVA table), with the two-sided noncentral-F CI (effect_sizes_anova.pve_ci).
- Data handling, descriptives and warnings are those of anova.factorial / anova.mixed (complete cases,
  empty cells refused). ART-C contrasts (ARTool::art.con) are not provided.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats

from statly_engine.stats import apa, effect_sizes_anova as esa
from statly_engine.stats.anova import ETA_P, require_two_sided
from statly_engine.stats.anova_factorial import (FACTORIAL_ROLES, TIMES, cell_table, factorial_data,
                                                 factorial_descriptives, factorial_inputs, factorial_warnings,
                                                 term_labels, term_sentence, term_summary, type3)
from statly_engine.stats.anova_mixed import (MIXED_ROLES, mixed_data, mixed_descriptives, mixed_inputs,
                                             mixed_term_labels, mixed_warnings)
from statly_engine.stats.apa import Rich
from statly_engine.stats.core import ResultBuilder, warning
from statly_engine.stats.registry import register


def _cell_means(y: np.ndarray, *codes: np.ndarray) -> np.ndarray:
    """Observation-weighted mean of y within each combination of `codes`, broadcast back to rows."""
    key = np.zeros(len(y), np.int64)
    for c in codes:
        key = key * (int(c.max()) + 1) + c
    _, inv = np.unique(key, return_inverse=True)
    sums = np.bincount(inv, weights=y)
    cnt = np.bincount(inv)
    return (sums / cnt)[inv]


# ARTool::art(rank.comparison.digits = -floor(log10(sqrt(.Machine$double.eps)))): aligned values are rounded
# to 8 decimals before ranking, so values that are equal in exact arithmetic tie despite rounding noise.
RANK_DIGITS = 8


def aligned(y: np.ndarray, a: np.ndarray, b: np.ndarray) -> dict[str, np.ndarray]:
    """ARTool alignment for a two-factor model: residual + estimated effect, for A, B and A:B."""
    grand = float(np.mean(y))
    ma, mb, mab = _cell_means(y, a), _cell_means(y, b), _cell_means(y, a, b)
    resid = y - mab
    eff = {"A": ma - grand, "B": mb - grand, "AB": mab - ma - mb + grand}
    return {k: resid + v for k, v in eff.items()}


def aligned_ranks(y: np.ndarray, a: np.ndarray, b: np.ndarray) -> dict[str, np.ndarray]:
    """Average ranks of the aligned responses (ARTool's aligned.ranks)."""
    return {k: stats.rankdata(np.round(v, RANK_DIGITS), method="average") for k, v in aligned(y, a, b).items()}


def strata_type1(r: np.ndarray, g: np.ndarray, G: int) -> dict:
    """aov(rank ~ group * time + Error(id)) for complete n x k data: sequential SS within each stratum."""
    n, k = r.shape
    ng = np.bincount(g, minlength=G).astype(float)
    rs = r.mean(axis=1)
    mg = np.array([rs[g == i].mean() for i in range(G)])
    ss_g = k * float(np.sum(ng * (mg - rs.mean()) ** 2))
    ss_eb = k * float(np.sum((rs - mg[g]) ** 2))
    w = r - rs[:, None]
    mt = w.mean(axis=0)
    ss_t = n * float(np.sum(mt ** 2))
    cellw = np.vstack([w[g == i].mean(axis=0) for i in range(G)])
    ss_gt = float(np.sum(ng[:, None] * (cellw - mt) ** 2))
    ss_ew = float(np.sum((w - cellw[g]) ** 2))
    dfb, dfw = n - G, (n - G) * (k - 1)

    def test(ss, df1, sse, dfe):
        if not (dfe > 0 and sse > 0):
            return dict(ss=ss, df=df1, dfe=dfe, f=None, p=None)
        f = (ss / df1) / (sse / dfe)
        return dict(ss=ss, df=df1, dfe=dfe, f=f, p=float(stats.f.sf(f, df1, dfe)))

    return {"G": test(ss_g, G - 1, ss_eb, dfb), "T": test(ss_t, k - 1, ss_ew, dfw),
            "GT": test(ss_gt, (G - 1) * (k - 1), ss_ew, dfw)}


def _pes(f, df1, df2, level):
    if f is None:
        return esa.Estimate(None, None, None, level)
    return esa.pve_ci(f * df1 / (f * df1 + df2), df1, df2, level)


@register("anova.art", label="Aligned rank transform (ART) ANOVA",
          roles={"factorial": FACTORIAL_ROLES, **MIXED_ROLES}, options={})
def art(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    require_two_sided(request, "An aligned rank transform ANOVA")
    level, alpha = request.ci_level, request.alpha
    b = ResultBuilder(request)
    rows = []
    if "factors" in request.variables and request.variables["factors"]:
        d = factorial_data(df, request, meta)
        ka, kb = len(d["al"]), len(d["bl"])
        labels = term_labels(d["labs"]["a"], d["labs"]["b"])
        shown = factorial_descriptives(b, d, level)
        ranks = aligned_ranks(d["y"], d["a"], d["b"])
        for key in ("A", "B", "AB"):
            tt = type3(ranks[key], d["a"], d["b"], ka, kb)
            rows.append(dict(label=labels[key], df=[tt[key]["df"], tt["error"]["df"]], f=tt[key]["f"],
                             p=tt[key]["p"], interaction=key == "AB"))
        design = f"{ka} {TIMES} {kb} between-subjects"
        yl, al, bl = d["labs"]["y"], d["labs"]["a"], d["labs"]["b"]
        factorial_warnings(b, d)
        factorial_inputs(b, d)
        n_used = d["n_used"]
    else:
        d = mixed_data(df, request, meta)
        y, g = d["y"], d["g"]
        (n, k), G = y.shape, len(d["gl"])
        labels = mixed_term_labels(d)
        shown = mixed_descriptives(b, d, level)
        yl_ = y.ravel()
        gg = np.repeat(g, k)
        tt_ = np.tile(np.arange(k), n)
        ranks = aligned_ranks(yl_, gg, tt_)
        for key, rk in (("G", "A"), ("T", "B"), ("GT", "AB")):
            tt = strata_type1(ranks[rk].reshape(n, k), g, G)[key]
            rows.append(dict(label=labels[key], df=[tt["df"], tt["dfe"]], f=tt["f"], p=tt["p"],
                             interaction=key == "GT"))
        design = f"{G} {TIMES} {k} mixed"
        yl, al, bl = d["outcome_label"], d["glabel"], d["tlabel"]
        mixed_warnings(b, d, sequential=True)
        mixed_inputs(b, d)
        n_used = n
    for row in rows:
        b.statistic("F", "F (aligned ranks)", "F", row["f"], row["df"] if row["f"] is not None else [], row["p"],
                    term=row["label"])
    for row in rows:
        row["pes"] = _pes(row["f"], row["df"][0], row["df"][1], level)
        b.effect("partial_eta_sq", "Partial eta squared (aligned ranks)", "η²p", row["pes"], "eta_sq",
                 term=row["label"], what="effect")
    if any(r["f"] is None for r in rows):
        b.warn(warning("constant_variable", "serious", f"The {yl} ranks do not vary within the groups for at least "
                       "one effect, so its test can't be calculated."))
    b.warn(warning("art_method", "info", "The aligned rank transform tests each effect on ranks after removing the "
                   "other effects, so it does not assume bell-shaped scores. It still assumes independent people "
                   "and similar spread across groups."))

    r = Rich().t(f"An aligned rank transform ANOVA ({design}) of {yl} showed ")
    term_sentence(r, rows, alpha, level)
    summary = (f"Ranks of {yl} for {n_used} people were compared across {al} and {bl} with the aligned rank "
               "transform, a rank-based version of the two-way ANOVA. " + term_summary(rows, alpha))
    b.sentence(r).summary(summary)
    cols = [apa.column("source", "Source", "left"), apa.column("f", Rich().i("F")),
            apa.column("df1", Rich().i("df").sub("1")), apa.column("df2", Rich().i("df").sub("2")),
            apa.column("p", Rich().i("p")), apa.column("eta", ETA_P), apa.column("ci", f"{apa.level_text(level)} CI")]
    body = [apa.row([apa.cell_text(row["label"]), apa.cell_num(row["f"]), apa.cell_df(row["df"][0]),
                     apa.cell_df(row["df"][1]), apa.cell_p(row["p"]), apa.cell_num(row["pes"].value, bounded=True),
                     apa.cell_ci(row["pes"].lower, row["pes"].upper, bounded=True)]) for row in rows]
    note = Rich().t("Each effect is tested on its own aligned-and-ranked scores (ARTool). ")
    note.t("Type I (sequential) tests within error strata for mixed designs; " if "factors" not in request.variables
           else "Type III tests (sum-to-zero contrasts); ")
    note.extend(ETA_P).t(" = partial eta squared implied by each F.")
    b.table(apa.table(f"Aligned Rank Transform ANOVA of {yl} by {al} and {bl}", cols, body, general_note=note))
    b.extra_table(cell_table(f"Descriptive Statistics for {yl} by {al} and {bl}", shown, al, bl, level))
    return b.build()
