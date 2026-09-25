"""Correlations (SPEC §8 "Relationships", §9 matrix corrections). Reference: fixtures/r/correlation.R.

Conventions:
- Missing data: complete pairs for each pair of variables (the matrix is pairwise); partial
  correlation uses complete cases on x, y and every covariate.
- Pearson and point-biserial follow stats::cor.test: t = r sqrt(df / (1 - r²)), df = n - 2, and a
  Fisher-z CI with SE 1 / sqrt(n - 3) (needs n >= 4). Point-biserial is Pearson with the binary
  variable coded 0 (first level) / 1 (second level), so a positive r means the second group scores
  higher.
- Spearman follows cor.test(method = "spearman") defaults: with no ties and n <= 1290 the p-value is
  AS 89 (exact enumeration for n <= 9, Edgeworth series above); with ties (or n > 1290) the t
  approximation on n - 2 df. S = (n³ - n)(1 - rho) / 6 is reported alongside.
- Kendall's tau-b follows cor.test(method = "kendall") defaults: the exact null distribution of
  T (concordant pairs) when n < 50 and there are no ties; otherwise the tie-corrected normal
  approximation without continuity correction (statistic z).
- Rank-correlation CIs (cor.test gives none): Fisher z with the Fieller, Hartley & Pearson (1957)
  standard errors sqrt(1.06 / (n - 3)) for rho and sqrt(0.437 / (n - 4)) for tau-b.
- Partial correlation follows ppcor::pcor.test (from the inverse correlation matrix; t on
  n - 2 - k df, k covariates); Fisher-z CI with SE 1 / sqrt(n - 3 - k). options.method "spearman"
  ranks every variable first (as ppcor).
- Perfect correlation: |r| > 1 - 1e-12 is treated as exactly +/-1 (t infinite -> null, p = 0,
  CI [r, r]); R's floating-point 1 - 2e-16 would otherwise give an arbitrary t of ~1e8.
- One-sided requests (tails) use cor.test's one-sided p and a one-sided CI bounded by +/-1.
- Matrix: each pair is tested exactly as the bivariate analysis of the chosen method, then the
  p-values of the k(k-1)/2 unique pairs are adjusted with none | bonferroni | holm | fdr_bh
  (stats::p.adjust). For Pearson this equals psych::corr.test(use = "pairwise", adjust =); psych
  uses the t approximation for Spearman and Kendall too, Statly keeps the cor.test p-values so a
  pair in the matrix matches its bivariate analysis. Significance markers use the adjusted p.
"""

from __future__ import annotations

import functools
import itertools
import math
import warnings

import numpy as np
import pandas as pd
from scipy import stats

from statly_engine.errors import InvalidParams
from statly_engine.stats import apa, assumptions as asm, effect_sizes as es, prep
from statly_engine.stats.apa import Rich
from statly_engine.stats.core import (SMALL_N, ResultBuilder, constant_warning, finite, magnitude, missing_warning,
                                      small_sample_warning, ties_warning, warning)
from statly_engine.stats.descriptives import cell
from statly_engine.stats.registry import Role, register

PERFECT = 1 - 1e-12
METHODS = ("pearson", "spearman", "kendall")
CORRECTIONS = ("none", "bonferroni", "holm", "fdr_bh")
_SYM = {"pearson": "r", "spearman": "rs", "kendall": "τb"}
_KEY = {"pearson": "r", "spearman": "rho", "kendall": "tau_b"}
_NAME = {"pearson": "Pearson correlation", "spearman": "Spearman's rho", "kendall": "Kendall's tau-b"}
_STRENGTH = {"negligible": "very weak", "small": "weak", "medium": "moderate", "large": "strong"}


# ---------------------------------------------------------------------------
# Null distributions (exact R algorithms)
# ---------------------------------------------------------------------------
_AS89 = (0.2274, 0.2531, 0.1745, 0.0758, 0.1033, 0.3932, 0.0879, 0.0151, 0.0072, 0.0831, 0.0131, 4.6e-4)


@functools.lru_cache(maxsize=None)
def _spearman_s_dist(n: int) -> np.ndarray:
    """Sorted S = sum (i - p_i)² over all n! permutations (n <= 9)."""
    perms = np.array(list(itertools.permutations(range(n))), dtype=np.int32)
    return np.sort(((perms - np.arange(n, dtype=np.int32)) ** 2).sum(axis=1))


def prho(n: int, s: float, lower_tail: bool) -> float:
    """AS 89 (R stats:::C_pRho): upper tail P(S >= s), or its complement when lower_tail."""
    pv = 0.0 if lower_tail else 1.0
    if s <= 0:
        return pv
    if s > n * (n * n - 1) / 3:
        return 1 - pv
    if n <= 9:
        dist = _spearman_s_dist(n)
        nfac = len(dist)
        ifr = nfac - int(np.searchsorted(dist, s, side="left"))
        return (nfac - ifr if lower_tail else ifr) / nfac
    c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12 = _AS89
    b = 1 / n
    x = (6 * (s - 1) * b / (n * n - 1) - 1) * math.sqrt(1 / b - 1)
    y = x * x
    u = x * b * (c1 + b * (c2 + c3 * b) + y * (-c4 + b * (c5 + c6 * b) - y * b * (
        c7 + c8 * b - y * (c9 - c10 * b + y * b * (c11 - c12 * y)))))
    upper = u / math.exp(y / 2) + stats.norm.sf(x)
    pv = 1 - upper if lower_tail else upper
    return min(1.0, max(0.0, pv))


@functools.lru_cache(maxsize=None)
def _mahonian(n: int) -> np.ndarray:
    """Counts of permutations of n by number of inversions (R stats:::C_pKendall)."""
    c = np.array([1.0])
    for k in range(2, n + 1):
        new = np.zeros(len(c) + k - 1)
        for j in range(k):
            new[j:j + len(c)] += c
        c = new
    return np.cumsum(c) / c.sum()


def pkendall(q: float, n: int) -> float:
    """P(T <= q) for the number of concordant pairs T under independence, no ties."""
    cdf = _mahonian(n)
    if q < 0:
        return 0.0
    return float(cdf[min(int(q), len(cdf) - 1)])


def _r_round(x: float) -> float:
    return float(np.round(x))


def _t_p(t: float, df: float, alt: str) -> float:
    if alt == "greater":
        return float(stats.t.sf(t, df))
    if alt == "less":
        return float(stats.t.cdf(t, df))
    return float(min(1.0, 2 * min(stats.t.cdf(t, df), stats.t.sf(t, df))))


def _z_p(z: float, alt: str) -> float:
    if alt == "greater":
        return float(stats.norm.sf(z))
    if alt == "less":
        return float(stats.norm.cdf(z))
    return float(min(1.0, 2 * min(stats.norm.cdf(z), stats.norm.sf(z))))


def fisher_ci(r: float, se: float, level: float, alt: str) -> tuple[float | None, float | None]:
    """tanh(atanh(r) -/+ q SE); one-sided intervals are bounded by -1 / 1 (as cor.test)."""
    if not finite(r) or not finite(se):
        return None, None
    if abs(r) >= PERFECT:
        return float(np.sign(r)), float(np.sign(r))
    z = math.atanh(r)
    if alt == "two_sided":
        q = stats.norm.ppf(1 - (1 - level) / 2)
        return math.tanh(z - q * se), math.tanh(z + q * se)
    q = stats.norm.ppf(level)
    return (math.tanh(z - q * se), 1.0) if alt == "greater" else (-1.0, math.tanh(z + q * se))


def _snap(r: float) -> float:
    return float(np.sign(r)) if abs(r) >= PERFECT else float(r)


# ---------------------------------------------------------------------------
# Bivariate tests on complete pairs
# ---------------------------------------------------------------------------
def pearson_test(x, y, alt: str = "two_sided", level: float = 0.95) -> dict:
    n = len(x)
    r = _snap(float(np.corrcoef(x, y)[0, 1]))
    df = n - 2
    if abs(r) == 1:
        t, p = None, 0.0
    else:
        t = r * math.sqrt(df / (1 - r * r))
        p = _t_p(t, df, alt)
    lo, hi = fisher_ci(r, 1 / math.sqrt(n - 3), level, alt) if n > 3 else (None, None)
    return {"method": "pearson", "r": r, "n": n, "df": df, "p": p, "stat_key": "t", "stat": t,
            "stat_df": [df], "lower": lo, "upper": hi, "exact": None}


def _has_ties(x, y) -> bool:
    n = len(x)
    return min(len(np.unique(x)), len(np.unique(y))) < n


def spearman_test(x, y, alt: str = "two_sided", level: float = 0.95) -> dict:
    n = len(x)
    rx, ry = stats.rankdata(x), stats.rankdata(y)
    r = _snap(float(np.corrcoef(rx, ry)[0, 1]))
    q = (n ** 3 - n) * (1 - r) / 6
    exact = n <= 1290 and not _has_ties(x, y)

    def ps(qq: float, lower: bool) -> float:
        if exact:
            return prho(n, _r_round(qq) + 2 * lower, lower)
        den = n * (n * n - 1) / 6
        rr = 1 - qq / den
        with np.errstate(divide="ignore", invalid="ignore"):
            tt = rr / math.sqrt((1 - rr * rr) / (n - 2)) if abs(rr) < 1 else math.copysign(math.inf, rr)
        return float(stats.t.sf(tt, n - 2) if lower else stats.t.cdf(tt, n - 2))

    if alt == "two_sided":
        p = min(2 * (ps(q, False) if q > (n ** 3 - n) / 6 else ps(q, True)), 1.0)
    elif alt == "greater":
        p = ps(q, True)
    else:
        p = ps(q, False)
    lo, hi = fisher_ci(r, math.sqrt(1.06 / (n - 3)), level, alt) if n > 3 else (None, None)
    return {"method": "spearman", "r": r, "n": n, "df": n - 2, "p": p, "stat_key": "S", "stat": q,
            "stat_df": [], "lower": lo, "upper": hi, "exact": exact}


def _tie_sizes(v) -> np.ndarray:
    _, counts = np.unique(v, return_counts=True)
    return counts[counts > 1].astype(float)


def kendall_test(x, y, alt: str = "two_sided", level: float = 0.95) -> dict:
    n = len(x)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        r = _snap(float(stats.kendalltau(x, y, variant="b").statistic))
    exact = n < 50 and not _has_ties(x, y)
    if exact:
        q = _r_round((r + 1) * n * (n - 1) / 4)
        stat_key, stat = "T", q
        if alt == "two_sided":
            p = 1 - pkendall(q - 1, n) if q > n * (n - 1) / 4 else pkendall(q, n)
            p = min(2 * p, 1.0)
        elif alt == "greater":
            p = 1 - pkendall(q - 1, n)
        else:
            p = pkendall(q, n)
    else:
        xt, yt = _tie_sizes(x), _tie_sizes(y)
        t0 = n * (n - 1) / 2
        t1, t2 = np.sum(xt * (xt - 1)) / 2, np.sum(yt * (yt - 1)) / 2
        s = r * math.sqrt((t0 - t1) * (t0 - t2))
        v0 = n * (n - 1) * (2 * n + 5)
        vt = np.sum(xt * (xt - 1) * (2 * xt + 5))
        vu = np.sum(yt * (yt - 1) * (2 * yt + 5))
        v1 = np.sum(xt * (xt - 1)) * np.sum(yt * (yt - 1))
        v2 = np.sum(xt * (xt - 1) * (xt - 2)) * np.sum(yt * (yt - 1) * (yt - 2))
        var_s = (v0 - vt - vu) / 18 + v1 / (2 * n * (n - 1)) + v2 / (9 * n * (n - 1) * (n - 2))
        stat_key, stat = "z", s / math.sqrt(var_s)
        p = _z_p(stat, alt)
    lo, hi = fisher_ci(r, math.sqrt(0.437 / (n - 4)), level, alt) if n > 4 else (None, None)
    return {"method": "kendall", "r": r, "n": n, "df": n - 2, "p": float(p), "stat_key": stat_key,
            "stat": float(stat), "stat_df": [], "lower": lo, "upper": hi, "exact": exact}


TESTS = {"pearson": pearson_test, "spearman": spearman_test, "kendall": kendall_test}


def p_adjust(p: list[float | None], method: str) -> list[float | None]:
    """stats::p.adjust over the non-missing p-values (bonferroni, holm, fdr_bh = "BH")."""
    idx = [i for i, v in enumerate(p) if finite(v)]
    out: list[float | None] = [None] * len(p)
    m = len(idx)
    if m == 0:
        return out
    vals = np.array([p[i] for i in idx], float)
    if method == "none":
        adj = vals
    elif method == "bonferroni":
        adj = np.minimum(1.0, vals * m)
    elif method == "holm":
        o = np.argsort(vals, kind="stable")
        a = np.minimum(1.0, np.maximum.accumulate((m - np.arange(m)) * vals[o]))
        adj = np.empty(m)
        adj[o] = a
    elif method == "fdr_bh":
        o = np.argsort(vals, kind="stable")[::-1]
        a = np.minimum(1.0, np.minimum.accumulate(m / np.arange(m, 0, -1) * vals[o]))
        adj = np.empty(m)
        adj[o] = a
    else:
        raise InvalidParams(f"Unknown correction '{method}'. Use none, bonferroni, holm or fdr_bh.")
    for i, v in zip(idx, adj):
        out[i] = float(v)
    return out


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------
def _alt(request) -> str:
    return request.tails.value


def _p_phrase(p) -> str:
    s = apa.p_value(p)
    return f"p {s}" if s[0] in "<>" else f"p = {s}"


def _sym_rich(sym: str) -> Rich:
    """rs / rpb / τb with the subscript set as a subscript."""
    if len(sym) > 1 and sym[0] in "rτ":
        return Rich().i(sym[0]).sub(sym[1:])
    return Rich().i(sym)


def _strength(r) -> str:
    return _STRENGTH[magnitude(r, "r")] if finite(r) else ""


def _complete(df, names, meta):
    cols = {n: prep.numeric(df, n, meta) for n in names}
    ok = np.ones(len(df), bool)
    for s in cols.values():
        ok &= s.notna().to_numpy()
    return {n: s.to_numpy()[ok] for n, s in cols.items()}, int((~ok).sum())


def _require_n(n: int, need: int, what: str):
    if n < need:
        raise InvalidParams(f"{what} needs at least {need} people with both scores; there are {n}.")


def _tail_note(request) -> str | None:
    alt = _alt(request)
    if alt == "two_sided":
        return None
    return f"One-tailed test (alternative: correlation {'>' if alt == 'greater' else '<'} 0)."


def _stat_label(res) -> str:
    if res["method"] == "pearson":
        return "t test of r"
    if res["method"] == "spearman":
        return "Spearman's S" + (" (exact / AS 89 p)" if res["exact"] else " (t approximation)")
    return "Kendall's T (exact p)" if res["stat_key"] == "T" else "Kendall's z (normal approximation)"


def _bivariate_result(request, meta, method: str, x, y, xl: str, yl: str, xname: str, yname: str,
                      n_excluded: int, n_missing: tuple[int, int], analysis_label: str | None = None,
                      key: str | None = None, sym: str | None = None, head_label: str | None = None,
                      extra_desc: list | None = None, groups: tuple[str, str] | None = None) -> dict:
    level, alt, alpha = request.ci_level, _alt(request), request.alpha
    key, sym = key or _KEY[method], sym or _SYM[method]
    head_label = head_label or _NAME[method]
    b = ResultBuilder(request)
    n = len(x)
    b.descriptives(extra_desc or [cell(xname, {}, xl, x, level, n_missing[0]),
                                  cell(yname, {}, yl, y, level, n_missing[1])])
    constant = [lab for lab, v in ((xl, x), (yl, y)) if np.ptp(v) == 0]
    if constant:
        res = None
        for lab in constant:
            b.warn(constant_warning(lab))
        b.statistic(key, head_label, sym, None, [n - 2] if method != "kendall" else [], None)
        est = es.Estimate(None, None, None, level)
    else:
        res = TESTS[method](x, y, alt, level)
        b.statistic(key, head_label, sym, res["r"], [n - 2] if method != "kendall" else [], res["p"])
        b.statistic(res["stat_key"], _stat_label(res), res["stat_key"], res["stat"], res["stat_df"], res["p"])
        est = es.Estimate(res["r"], res["lower"], res["upper"], level)
    b.effect(key, head_label, sym, est, "r", what="relationship")

    if method == "pearson":
        for v, lab in ((x, xl), (y, yl)):
            res_a, charts = asm.shapiro_wilk(v, asm.scope("overall", lab), alpha)
            b.assumption(res_a, charts)
    b.chart("scatter", [{"x": float(a), "y": float(c)} for a, c in zip(x, y)])
    b.warn(small_sample_warning({"pairs": n}) if n < SMALL_N else None)
    if method == "pearson":
        b.warn(ties_warning(y, yl) if groups else (ties_warning(x, xl) or ties_warning(y, yl)))
    if res is not None and method != "pearson" and not res["exact"] and _has_ties(x, y):
        b.warn(warning("ties_present", "info", "Some scores are tied, so the p-value uses a large-sample "
                       "approximation (as R and SPSS do) rather than the exact distribution."))
    b.warn(missing_warning(n_excluded))
    b.inputs(n, n_excluded)

    # APA sentence + plain language
    r_run = _sym_rich(sym)
    what = "A point-biserial correlation" if groups else ("A " + head_label if method == "pearson" else head_label)
    s = Rich().t(f"{what} was computed to assess the relationship between {xl} and {yl}. ")
    if res is None:
        s.t(f"It could not be computed because {' and '.join(constant)} did not vary.")
        summary = (f"{' and '.join(constant)} had the same value for everyone, so its relationship with the other "
                   "variable can't be measured.")
    else:
        r, p = res["r"], res["p"]
        sig = p < alpha
        s.t("There was " + ("a significant " if sig else "no significant ") +
            ("positive" if r > 0 else "negative") + " correlation, ")
        s.extend(r_run)
        if method != "kendall":
            s.t(f"({n - 2})")
        s.t(" = " + apa.no_zero(r)).t(", ").p(p)
        if finite(res["lower"]) or finite(res["upper"]):
            s.t(f", {apa.level_text(level)} CI {apa.ci_text(res['lower'], res['upper'], 2, True)}")
        s.t(f", n = {n}.")
        direction = ("higher" if r > 0 else "lower")
        lead = (f"The {groups[1] if r > 0 else groups[0]} group tended to have higher {yl} than the "
                f"{groups[0] if r > 0 else groups[1]} group" if groups else
                f"People with higher {xl} tended to have {direction} {yl}")
        summary = (f"{lead}. The relationship was "
                   f"{_strength(r)}" + (" (by common benchmarks)" if magnitude(r, 'r') else "") + ". " +
                   ("It is unlikely to be due to chance alone" if sig else
                    "It could easily be due to chance, so there is no strong evidence of a real relationship")
                   + f" ({_p_phrase(p)}).")
        if abs(r) == 1:
            summary += " The two variables line up perfectly, which usually means one is computed from the other."
    b.sentence(s).summary(summary)

    cols = [apa.column("pair", "Variables", "left"), apa.column("n", Rich().i("n")),
            apa.column("r", _sym_rich(sym)), apa.column("ci", f"{apa.level_text(level)} CI"),
            apa.column("p", Rich().i("p"))]
    row = apa.row([apa.cell_text(f"{xl} and {yl}"), apa.cell_int(n),
                   apa.cell_num(res["r"] if res else None, bounded=True),
                   apa.cell_ci(est.lower, est.upper, bounded=True), apa.cell_p(res["p"] if res else None)])
    note = Rich().t("CI = confidence interval")
    if method == "pearson":
        note.t(" (Fisher z transformation).")
    elif method == "spearman":
        note.t(" (Fisher z with the Fieller et al., 1957, standard error). ")
        note.t("p-value " + ("exact (AS 89)." if res and res["exact"] else "from the t approximation (tied ranks)."))
    else:
        note.t(" (Fisher z with the Fieller et al., 1957, standard error). ")
        note.t("p-value " + ("exact." if res and res["exact"] else "from the normal approximation."))
    tail = _tail_note(request)
    if tail:
        note.t(" " + tail)
    b.table(apa.table(analysis_label or f"{head_label} Between {xl} and {yl}", cols, [row], general_note=note))
    return b.build()


def _bivariate(df, request, meta, method):
    a, c = request.variables["x"][0], request.variables["y"][0]
    xa, ya = prep.numeric(df, a, meta), prep.numeric(df, c, meta)
    ok = (xa.notna() & ya.notna()).to_numpy()
    x, y = xa.to_numpy()[ok], ya.to_numpy()[ok]
    _require_n(len(x), 3, f"{_NAME[method]}")
    return _bivariate_result(request, meta, method, x, y, prep.label(meta, a), prep.label(meta, c), a, c,
                             int((~ok).sum()), (int(xa.isna().sum()), int(ya.isna().sum())))


_XY = [Role("x", 1, 1, "First variable"), Role("y", 1, 1, "Second variable")]


@register("correlation.pearson", label="Pearson correlation", roles=_XY, options={})
def pearson(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    return _bivariate(df, request, meta, "pearson")


@register("correlation.spearman", label="Spearman's rank correlation", roles=_XY, options={})
def spearman(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    return _bivariate(df, request, meta, "spearman")


@register("correlation.kendall_tau_b", label="Kendall's tau-b", roles=_XY, options={})
def kendall(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    return _bivariate(df, request, meta, "kendall")


# ---------------------------------------------------------------------------
# Point-biserial
# ---------------------------------------------------------------------------
@register("correlation.point_biserial", label="Point-biserial correlation",
          roles=[Role("binary", 1, 1, "Variable with exactly two groups (e.g. passed / failed)"),
                 Role("outcome", 1, 1, "Scores")],
          options={"levels": "The two values of the binary variable, coded 0 and 1 in that order."})
def point_biserial(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    gname, yname = request.variables["binary"][0], request.variables["outcome"][0]
    gl, yl = prep.label(meta, gname), prep.label(meta, yname)
    g = prep.categorical(df, gname, meta)
    y = prep.numeric(df, yname, meta)
    levels = prep.level_order(g, gname, meta, request.options.get("levels"))
    if len(levels) != 2:
        raise InvalidParams(f"A point-biserial correlation needs a variable with exactly two groups, but {gl} "
                            f"has {len(levels)}.")
    names = [prep.value_label(meta, gname, lv) for lv in levels]
    in1 = g.map(lambda v: prep._same(v, levels[1])).to_numpy(bool)
    in0 = g.map(lambda v: prep._same(v, levels[0])).to_numpy(bool)
    ok = (in0 | in1) & y.notna().to_numpy()
    x, yy = in1[ok].astype(float), y.to_numpy()[ok]
    _require_n(len(x), 3, "A point-biserial correlation")
    desc = [cell(yname, {gname: levels[0]}, names[0], y.to_numpy()[in0], request.ci_level),
            cell(yname, {gname: levels[1]}, names[1], y.to_numpy()[in1], request.ci_level)]
    xl = f"{gl} ({names[1]} = 1, {names[0]} = 0)"
    return _bivariate_result(request, meta, "pearson", x, yy, xl, yl, gname, yname, int((~ok).sum()),
                             (0, 0), analysis_label=f"Point-Biserial Correlation Between {gl} and {yl}",
                             key="r_pb", sym="rpb", head_label="Point-biserial r", extra_desc=desc,
                             groups=(names[0], names[1]))


# ---------------------------------------------------------------------------
# Partial correlation
# ---------------------------------------------------------------------------
def partial_corr(data: np.ndarray, alt: str = "two_sided", level: float = 0.95) -> dict:
    """Columns: x, y, covariates... (complete cases). ppcor::pcor.test."""
    n, p = data.shape
    k = p - 2
    with np.errstate(all="ignore"):
        cor = np.corrcoef(data, rowvar=False)
    if not np.all(np.isfinite(cor)):
        raise InvalidParams("A variable in the partial correlation does not vary, so it can't be computed.")
    try:
        prec = np.linalg.inv(cor)
    except np.linalg.LinAlgError:
        raise InvalidParams("The covariates are perfectly related to each other or to x / y, so the partial "
                            "correlation can't be computed. Remove the redundant covariate.") from None
    r = _snap(float(-prec[0, 1] / math.sqrt(prec[0, 0] * prec[1, 1])))
    df = n - 2 - k
    if abs(r) == 1:
        t, pv = None, 0.0
    else:
        t = r * math.sqrt(df / (1 - r * r))
        pv = _t_p(t, df, alt)
    lo, hi = fisher_ci(r, 1 / math.sqrt(n - 3 - k), level, alt) if n - 3 - k > 0 else (None, None)
    return {"r": r, "t": t, "df": df, "p": pv, "lower": lo, "upper": hi, "zero_order": float(cor[0, 1])}


@register("correlation.partial", label="Partial correlation",
          roles=[Role("x", 1, 1, "First variable"), Role("y", 1, 1, "Second variable"),
                 Role("covariates", 1, None, "Variables to control for")],
          options={"method": "\"pearson\" (default) or \"spearman\" (ranks each variable first)."})
def partial(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    method = request.options.get("method", "pearson")
    if method not in ("pearson", "spearman"):
        raise InvalidParams("options.method must be \"pearson\" or \"spearman\" for a partial correlation.")
    a, c = request.variables["x"][0], request.variables["y"][0]
    covs = list(request.variables["covariates"])
    if len({a, c, *covs}) != 2 + len(covs):
        raise InvalidParams("x, y and the covariates must be different variables.")
    level, alt, alpha = request.ci_level, _alt(request), request.alpha
    cols, n_excl = _complete(df, [a, c, *covs], meta)
    n, k = len(cols[a]), len(covs)
    if n - 3 - k < 1:
        raise InvalidParams(f"A partial correlation with {k} covariate(s) needs at least {k + 4} complete rows; "
                            f"there are {n}.")
    data = np.column_stack([cols[v] for v in (a, c, *covs)])
    if method == "spearman":
        data = np.column_stack([stats.rankdata(data[:, j]) for j in range(data.shape[1])])
    res = partial_corr(data, alt, level)
    xl, yl = prep.label(meta, a), prep.label(meta, c)
    cl = ", ".join(prep.label(meta, v) for v in covs)
    b = ResultBuilder(request)
    b.descriptives([cell(v, {}, prep.label(meta, v), cols[v], level) for v in (a, c, *covs)])
    b.statistic("r_partial", "Partial correlation", "r", res["r"], [res["df"]], res["p"])
    b.statistic("t", "t test of the partial correlation", "t", res["t"], [res["df"]], res["p"])
    b.statistic("r_zero_order", "Zero-order correlation (no control)", "r", res["zero_order"], [], None)
    est = es.Estimate(res["r"], res["lower"], res["upper"], level)
    b.effect("r_partial", "Partial correlation", "r", est, "r", what="relationship")
    b.warn(small_sample_warning({"complete cases": n}) if n < SMALL_N else None)
    b.warn(missing_warning(n_excl))
    b.inputs(n, n_excl)

    sig = res["p"] < alpha
    s = Rich().t(f"Controlling for {cl}, there was " + ("a significant " if sig else "no significant ") +
                 ("positive" if res["r"] > 0 else "negative") + f" partial correlation between {xl} and {yl}, ")
    s.i("r").t(f"({res['df']}) = {apa.no_zero(res['r'])}, ").p(res["p"])
    s.t(f", {apa.level_text(level)} CI {apa.ci_text(res['lower'], res['upper'], 2, True)}.")
    summary = (f"After taking {cl} into account, people with higher {xl} tended to have "
               f"{'higher' if res['r'] > 0 else 'lower'} {yl}; the relationship was {_strength(res['r'])}. "
               f"Without that control the correlation was {apa.no_zero(res['zero_order'])}. " +
               ("The controlled relationship is unlikely to be due to chance alone" if sig else
                "The controlled relationship could easily be due to chance") + f" ({_p_phrase(res['p'])}).")
    b.sentence(s).summary(summary)
    cols_t = [apa.column("pair", "Variables", "left"), apa.column("r0", Rich().i("r")),
              apa.column("rp", Rich().i("r").sub("partial")), apa.column("df", Rich().i("df")),
              apa.column("ci", f"{apa.level_text(level)} CI"), apa.column("p", Rich().i("p"))]
    row = apa.row([apa.cell_text(f"{xl} and {yl}"), apa.cell_num(res["zero_order"], bounded=True),
                   apa.cell_num(res["r"], bounded=True), apa.cell_df(res["df"]),
                   apa.cell_ci(res["lower"], res["upper"], bounded=True), apa.cell_p(res["p"])])
    note = Rich().t(f"Controlling for {cl}. ").i("r").t(" = zero-order correlation. CI by Fisher z. ")
    note.t("Spearman ranks." if method == "spearman" else f"n = {n} complete cases.")
    b.table(apa.table(f"Partial Correlation Between {xl} and {yl}", cols_t, [row], general_note=note))
    return b.build()


# ---------------------------------------------------------------------------
# Correlation matrix
# ---------------------------------------------------------------------------
def _stars(p) -> str:
    if not finite(p):
        return ""
    return "**" if p < 0.01 else ("*" if p < 0.05 else "")


def _correction(request) -> str:
    for c in request.corrections or []:
        cc = c if isinstance(c, dict) else c.model_dump(mode="json")
        if cc["scope"] == "matrix":
            m = cc["method"]
            return m.value if hasattr(m, "value") else m
    m = request.options.get("adjust", request.options.get("correction", "none")) or "none"
    if m not in CORRECTIONS:
        raise InvalidParams("options.adjust must be one of none, bonferroni, holm, fdr_bh.")
    return m


_ADJ_NAME = {"none": "no correction", "bonferroni": "Bonferroni", "holm": "Holm",
             "fdr_bh": "Benjamini-Hochberg (false discovery rate)"}


@register("correlation.matrix", label="Correlation matrix",
          roles=[Role("variables", 2, None, "Two or more numeric variables")],
          options={"method": "\"pearson\" (default), \"spearman\" or \"kendall\".",
                   "adjust": "p-value correction across the pairs: none (default), bonferroni, holm, fdr_bh. "
                             "A request correction with scope \"matrix\" takes precedence."})
def matrix(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    names = list(dict.fromkeys(request.variables["variables"]))
    if len(names) < 2:
        raise InvalidParams("A correlation matrix needs at least two different variables.")
    method = request.options.get("method", "pearson")
    if method not in METHODS:
        raise InvalidParams("options.method must be \"pearson\", \"spearman\" or \"kendall\".")
    adjust = _correction(request)
    level, alt, alpha = request.ci_level, _alt(request), request.alpha
    labels = [prep.label(meta, v) for v in names]
    cols = {v: prep.numeric(df, v, meta).to_numpy() for v in names}
    k = len(names)
    b = ResultBuilder(request)
    b.descriptives([cell(v, {}, lab, cols[v], level) for v, lab in zip(names, labels)])

    pairs = []
    for i, j in itertools.combinations(range(k), 2):
        xa, ya = cols[names[i]], cols[names[j]]
        ok = np.isfinite(xa) & np.isfinite(ya)
        x, y = xa[ok], ya[ok]
        n = int(ok.sum())
        res = None
        if n >= 3 and np.ptp(x) > 0 and np.ptp(y) > 0:
            res = TESTS[method](x, y, alt, level)
        pairs.append({"i": i, "j": j, "n": n, "res": res})
    p_adj = p_adjust([q["res"]["p"] if q["res"] else None for q in pairs], adjust)
    for q, pa in zip(pairs, p_adj):
        q["p_adjusted"] = pa

    key, sym = _KEY[method], _SYM[method]
    records = []
    for q in pairs:
        res, term = q["res"], f"{labels[q['i']]} × {labels[q['j']]}"
        r = res["r"] if res else None
        b.statistic(key, _NAME[method], sym, r, [q["n"] - 2] if (method != "kendall" and res) else [],
                    res["p"] if res else None, term=term)
        b.effect(key, _NAME[method], sym, es.Estimate(r, res["lower"] if res else None,
                                                      res["upper"] if res else None, level), "r",
                 term=term, what="relationship")
        records.append({"x": names[q["i"]], "y": names[q["j"]], "x_label": labels[q["i"]],
                        "y_label": labels[q["j"]], "n": q["n"], "r": r, "p": res["p"] if res else None,
                        "p_adjusted": q["p_adjusted"], "ci_lower": res["lower"] if res else None,
                        "ci_upper": res["upper"] if res else None,
                        "significant": bool(finite(q["p_adjusted"]) and q["p_adjusted"] < alpha)})
    b.chart("correlation_pairs", records)
    lookup = {(q["i"], q["j"]): q for q in pairs}
    heat = []
    for i in range(k):
        for j in range(k):
            if i == j:
                heat.append({"row": labels[i], "column": labels[j], "r": 1.0, "p_adjusted": None, "n": None,
                             "significant": None})
                continue
            q = lookup[(min(i, j), max(i, j))]
            heat.append({"row": labels[i], "column": labels[j], "r": q["res"]["r"] if q["res"] else None,
                         "p_adjusted": q["p_adjusted"], "n": q["n"],
                         "significant": bool(finite(q["p_adjusted"]) and q["p_adjusted"] < alpha)})
    b.chart("correlation_heatmap", heat)

    # warnings + inputs
    present = np.column_stack([np.isfinite(cols[v]) for v in names]).sum(axis=1)
    n_used, n_excl = int((present >= 2).sum()), int((present < 2).sum())
    for v, lab in zip(names, labels):
        vals = cols[v][np.isfinite(cols[v])]
        if len(vals) and np.ptp(vals) == 0:
            b.warn(warning("constant_variable", "serious",
                           f"Every score in {lab} is the same, so its correlations can't be calculated."))
    ns = [q["n"] for q in pairs]
    if min(ns) < SMALL_N:
        b.warn(warning("small_sample", "caution", f"Some correlations are based on fewer than {SMALL_N} people "
                       f"(smallest n = {min(ns)}), so they are imprecise; check the confidence intervals."))
    if len(set(ns)) > 1 or n_excl:
        b.warn(warning("missing_data", "info", "Missing values were handled pairwise: each correlation uses "
                       f"everyone with both scores, so the number of people differs by pair (n = {min(ns)} to "
                       f"{max(ns)})."))
    m = len(pairs)
    if adjust == "none" and m > 1:
        b.warn(warning("multiple_comparisons", "info", f"This matrix tests {m} correlations at once, so some may "
                       "look significant by chance. You can apply a Bonferroni, Holm or Benjamini-Hochberg "
                       "correction in the options."))
    b.inputs(n_used, n_excl)

    # APA table: M, SD, lower triangle
    cols_t = [apa.column("variable", "Variable", "left"), apa.column("m", Rich().i("M")),
              apa.column("sd", Rich().i("SD"))] + [apa.column(f"c{j + 1}", str(j + 1)) for j in range(k - 1)]
    rows = []
    for i in range(k):
        vals = cols[names[i]][np.isfinite(cols[names[i]])]
        mean = float(np.mean(vals)) if len(vals) else None
        sd = float(np.std(vals, ddof=1)) if len(vals) > 1 else None
        cells = [apa.cell_text(f"{i + 1}. {labels[i]}"), apa.cell_num(mean), apa.cell_num(sd)]
        for j in range(k - 1):
            if j < i:
                q = lookup[(j, i)]
                r = q["res"]["r"] if q["res"] else None
                c = apa.cell_num(r, bounded=True)
                c["display"] = c["display"] + _stars(q["p_adjusted"])
                cells.append(c)
            elif j == i:
                cells.append(apa.cell_text(apa.EM_DASH))
            else:
                cells.append(apa.cell_empty())
        rows.append(apa.row(cells))
    ns_txt = f"n = {min(ns)}" if min(ns) == max(ns) else f"n = {min(ns)} to {max(ns)} (pairwise deletion)"
    note = Rich().t(f"{_NAME[method]} coefficients; {ns_txt}. ")
    if adjust != "none":
        note.t(f"Significance uses {_ADJ_NAME[adjust]}-adjusted p-values across the {m} pairs.")
    else:
        note.t("p-values are not adjusted for multiple comparisons.")
    tail = _tail_note(request)
    if tail:
        note.t(" " + tail)
    prob = [Rich().t("*").i("p").t(" < .05. **").i("p").t(" < .01.")]
    title = f"Means, Standard Deviations, and {'Correlations' if method == 'pearson' else _NAME[method] + ' Correlations'}"
    b.table(apa.table(title, cols_t, rows, general_note=note, probability_notes=prob))

    pcols = [apa.column("pair", "Pair", "left"), apa.column("n", Rich().i("n")), apa.column("r", _sym_rich(sym)),
             apa.column("ci", f"{apa.level_text(level)} CI"), apa.column("p", Rich().i("p")),
             apa.column("p_adj", Rich().i("p").t(" (adjusted)"))]
    prow = [apa.row([apa.cell_text(f"{rec['x_label']} and {rec['y_label']}"), apa.cell_int(rec["n"]),
                     apa.cell_num(rec["r"], bounded=True), apa.cell_ci(rec["ci_lower"], rec["ci_upper"], bounded=True),
                     apa.cell_p(rec["p"]), apa.cell_p(rec["p_adjusted"])]) for rec in records]
    b.extra_table(apa.table("Correlation Pairs", pcols, prow, number=None,
                            general_note=Rich().t(f"Adjustment: {_ADJ_NAME[adjust]}.")))

    sig = [rec for rec in records if rec["significant"]]
    strongest = max((rec for rec in records if finite(rec["r"])), key=lambda rec: abs(rec["r"]), default=None)
    summary = (f"{len(sig)} of the {m} pairs of variables were significantly related"
               + (f" after the {_ADJ_NAME[adjust]} correction" if adjust != "none" else "") + ".")
    if strongest:
        summary += (f" The strongest relationship was between {strongest['x_label']} and {strongest['y_label']} "
                    f"({sym} = {apa.no_zero(strongest['r'])}, {_strength(strongest['r'])}).")
    s = Rich().t(f"{_NAME[method]} coefficients were computed among {k} variables (Table 1). ")
    s.t(f"{len(sig)} of {m} correlations were significant at ").i("p").t(f" < {apa.no_zero(alpha)}")
    s.t(f" ({_ADJ_NAME[adjust]})." if adjust != "none" else ".")
    b.sentence(s).summary(summary)
    return b.build()
