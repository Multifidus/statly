"""Effect sizes for contingency tables (SPEC §8): Cramér's V, phi, Cohen's w, Fei, odds ratios,
Cohen's g. Reference: fixtures/r/categorical.R.

Chi-square-based coefficients follow R `effectsize` 1.0 with adjust = FALSE (the classical,
unadjusted V and phi) and its default one-sided interval (alternative = "greater"): the lower bound
comes from the noncentral chi-square whose ncp puts the observed statistic at the 95th percentile,
and the upper bound is fixed at the largest possible value (1 for V, phi and Fei; sqrt(1/min(p) - 1)
for Cohen's w). effectsize finds that ncp with Nelder-Mead; we solve it exactly (Brent), which
agrees with R's uniroot to ~1e-10. A two-sided interval is available with ``alternative``.
"""

from __future__ import annotations

import math

import numpy as np
from scipy import optimize, stats

from statly_engine.stats.effect_sizes import Estimate, adjust_level

TWO_SIDED, GREATER, LESS = "two_sided", "greater", "less"


def _ncp_for(chisq: float, df: float, prob: float) -> float:
    """ncp >= 0 with P(X <= chisq; df, ncp) = prob (0 when even ncp = 0 is below prob)."""
    if stats.chi2.cdf(chisq, df) <= prob:
        return 0.0
    f = lambda ncp: stats.ncx2.cdf(chisq, df, ncp) - prob  # noqa: E731
    hi = chisq + 10 * math.sqrt(chisq + df) + 50
    while f(hi) > 0:
        hi *= 2
    return float(optimize.brentq(f, 0.0, hi, xtol=1e-14, rtol=1e-14, maxiter=1000))


def chisq_ncp_ci(chisq: float, df: float, level: float = 0.95,
                 alternative: str = GREATER) -> tuple[float, float]:
    """Bounds on the noncentrality parameter; one-sided upper bound = inf."""
    lvl = adjust_level(level, alternative)
    a = 1 - lvl
    lo = _ncp_for(chisq, df, 1 - a / 2)
    hi = _ncp_for(chisq, df, a / 2)
    if alternative == GREATER:
        hi = math.inf
    elif alternative == LESS:
        lo = 0.0
    return lo, hi


def _w_estimate(chisq: float, n: int, df: float, level: float, alternative: str, scale: float,
                upper_max: float) -> Estimate:
    if not (np.isfinite(chisq) and n > 0):
        return Estimate(None, None, None, level)
    lo, hi = chisq_ncp_ci(chisq, df, level, alternative)
    value = math.sqrt(chisq / n) / scale
    lower = math.sqrt(lo / n) / scale
    upper = upper_max if not np.isfinite(hi) else min(math.sqrt(hi / n) / scale, upper_max)
    return Estimate(value, lower, upper, level)


def cramers_v(chisq: float, n: int, nrow: int, ncol: int, level: float = 0.95,
              alternative: str = GREATER) -> Estimate:
    """effectsize::cramers_v(adjust = FALSE): sqrt(chi² / (n (min(r, c) - 1)))."""
    df = (nrow - 1) * (ncol - 1)
    return _w_estimate(chisq, n, df, level, alternative, math.sqrt(min(nrow, ncol) - 1), 1.0)


def phi(chisq: float, n: int, level: float = 0.95, alternative: str = GREATER) -> Estimate:
    """effectsize::phi(adjust = FALSE) for a 2 x 2 table: sqrt(chi² / n), unsigned."""
    return _w_estimate(chisq, n, 1, level, alternative, 1.0, 1.0)


def cohens_w_gof(chisq: float, n: int, p, level: float = 0.95, alternative: str = GREATER) -> Estimate:
    """effectsize::cohens_w for goodness of fit; upper bound sqrt(1/min(p) - 1)."""
    p = np.asarray(p, float) / np.sum(p)
    wmax = math.sqrt(1 / p.min() - 1)
    return _w_estimate(chisq, n, len(p) - 1, level, alternative, 1.0, wmax)


def fei(chisq: float, n: int, p, level: float = 0.95, alternative: str = GREATER) -> Estimate:
    """effectsize::fei: Cohen's w divided by its maximum, so it runs from 0 to 1."""
    p = np.asarray(p, float) / np.sum(p)
    return _w_estimate(chisq, n, len(p) - 1, level, alternative, math.sqrt(1 / p.min() - 1), 1.0)


def odds_ratio_woolf(table, level: float = 0.95) -> Estimate:
    """Sample odds ratio ad / bc with Woolf's CI exp(log OR +/- z SE) (effectsize::oddsratio).
    CI is null when any cell is 0 (log OR undefined)."""
    (a, b), (c, d) = np.asarray(table, float)
    with np.errstate(divide="ignore", invalid="ignore"):
        orr = (a * d) / (b * c)
    if min(a, b, c, d) == 0:
        return Estimate(float(orr) if np.isfinite(orr) else None, None, None, level)
    se = math.sqrt(1 / a + 1 / b + 1 / c + 1 / d)
    q = stats.norm.ppf(1 - (1 - level) / 2)
    return Estimate(float(orr), math.exp(math.log(orr) - q * se), math.exp(math.log(orr) + q * se), level)


def odds_ratio_conditional(table, level: float = 0.95, alternative: str = TWO_SIDED) -> Estimate:
    """Conditional MLE odds ratio with the exact CI, as stats::fisher.test (2 x 2)."""
    from scipy.stats.contingency import odds_ratio
    alt = {"two_sided": "two-sided", "greater": "greater", "less": "less"}[alternative]
    res = odds_ratio(np.asarray(table, int), kind="conditional")
    ci = res.confidence_interval(confidence_level=level, alternative=alt)
    val = float(res.statistic)
    lo, hi = float(ci.low), float(ci.high)
    return Estimate(val if np.isfinite(val) else None, lo if np.isfinite(lo) else None,
                    hi if np.isfinite(hi) else None, level)


def wilson_ci(k: float, n: int, level: float = 0.95) -> tuple[float, float]:
    """Two-sided Wilson score interval (stats::prop.test(correct = FALSE))."""
    z = stats.norm.ppf(1 - (1 - level) / 2)
    p = k / n
    z2 = z * z
    center = p + z2 / (2 * n)
    half = z * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))
    return max((center - half) / (1 + z2 / n), 0.0), min((center + half) / (1 + z2 / n), 1.0)


def cohens_g(b: int, c: int, level: float = 0.95) -> Estimate:
    """effectsize::cohens_g for McNemar: P - 0.5, P = max(b, c) / (b + c), Wilson CI."""
    n = b + c
    if n == 0:
        return Estimate(None, None, None, level)
    p = max(b, c) / n
    lo, hi = wilson_ci(p * n, n, level)
    return Estimate(p - 0.5, lo - 0.5, hi - 0.5, level)


def paired_odds_ratio(b: int, c: int, level: float = 0.95) -> Estimate:
    """McNemar odds ratio b / c with the exact conditional CI (Clopper-Pearson on b of b + c)."""
    n = b + c
    if n == 0:
        return Estimate(None, None, None, level)
    ci = stats.binomtest(int(b), int(n)).proportion_ci(confidence_level=level, method="exact")
    to_or = lambda p: p / (1 - p) if p < 1 else math.inf  # noqa: E731
    val = b / c if c > 0 else math.inf
    lo, hi = to_or(ci.low), to_or(ci.high)
    fin = lambda x: float(x) if np.isfinite(x) else None  # noqa: E731
    return Estimate(fin(val), fin(lo), fin(hi), level)
