"""Standardized effect sizes with confidence intervals (SPEC §8), matched to R `effectsize` 1.0.

All intervals default to the request's `ci_level` (95%). One-sided requests follow effectsize:
the interval is computed two-sided at level ``2 * ci_level - 1`` and the open side is set to
+/-infinity (reported as null) — or to the parameter bound (+/-1 for r, 0/1 for eta squared).

Noncentral-distribution CIs use the pivot / test-inversion method: find the noncentrality
parameters whose distributions put the observed statistic at the upper and lower tail
probabilities, then map those parameters back to the effect-size scale. effectsize finds the
same roots with Nelder-Mead (`optim`, abstol 1e-9); we use Brent's method (xtol 1e-12), so our
bounds are the exact roots and agree with R to ~1e-8.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy import optimize, stats

TWO_SIDED, GREATER, LESS = "two_sided", "greater", "less"


@dataclass(frozen=True)
class Estimate:
    """A point estimate with a (possibly one-sided / missing) confidence interval."""

    value: float | None
    lower: float | None
    upper: float | None
    level: float


def _clean(x) -> float | None:
    return float(x) if x is not None and np.isfinite(x) else None


def _est(value, lower, upper, level) -> Estimate:
    v = _clean(value)
    if v is None:
        return Estimate(None, None, None, level)
    return Estimate(v, _clean(lower), _clean(upper), level)


def adjust_level(level: float, alternative: str) -> float:
    """effectsize:::.adjust_ci — a one-sided level-L interval is one side of a (2L - 1) interval."""
    return level if alternative == TWO_SIDED else 2 * level - 1


def hedges_j(df: float) -> float:
    """Exact small-sample correction J(df) = Γ(df/2) / (sqrt(df/2) Γ((df-1)/2)) (effectsize:::.J)."""
    return math.exp(math.lgamma(df / 2) - math.log(math.sqrt(df / 2)) - math.lgamma((df - 1) / 2))


# ---------------------------------------------------------------------------
# Generic noncentral CI helpers
# ---------------------------------------------------------------------------
def _root(f, target: float, start: float, step: float, lower_limit: float | None = None) -> float:
    """Solve f(x) = target for f monotone decreasing in x, bracketing outward from `start`."""
    g = lambda x: f(x) - target  # noqa: E731
    lo, hi = start - step, start + step
    if lower_limit is not None:
        lo = max(lo, lower_limit)
    for _ in range(200):
        glo, ghi = g(lo), g(hi)
        if glo >= 0 >= ghi:
            return optimize.brentq(g, lo, hi, xtol=1e-12, rtol=4 * np.finfo(float).eps, maxiter=500)
        if glo < 0:
            if lower_limit is not None and lo <= lower_limit:
                return lower_limit
            lo = lo - step if lower_limit is None else max(lower_limit, lo - step)
        if ghi > 0:
            hi += step
        step *= 2
    return float("nan")


def nct_ci(t: float, df: float, level: float = 0.95, alternative: str = TWO_SIDED) -> tuple[float, float]:
    """CI for the noncentrality parameter of a noncentral t, by inversion.

    Matches effectsize:::.get_ncp_t(t, df, conf.level): the lower bound is the ncp for which the
    observed t is the (1 - a/2) quantile, the upper bound the ncp for which it is the a/2 quantile.
    One-sided alternatives set the open bound to -inf / +inf. Multiply by sqrt(1/n) etc. to get d.
    """
    if not (np.isfinite(t) and np.isfinite(df)):
        return float("nan"), float("nan")
    a = 1 - adjust_level(level, alternative)
    cdf = lambda ncp: stats.nct.cdf(t, df, ncp)  # noqa: E731  (decreasing in ncp)
    step = max(2.0, abs(t) / 2)
    lo = _root(cdf, 1 - a / 2, t, step)
    hi = _root(cdf, a / 2, t, step)
    if alternative == GREATER:
        hi = math.inf
    elif alternative == LESS:
        lo = -math.inf
    return lo, hi


def ncf_ci(f: float, df1: float, df2: float, level: float = 0.90) -> tuple[float, float]:
    """Two-sided CI for the noncentrality parameter lambda of a noncentral F, by inversion.

    Matches effectsize:::.get_ncp_F(f, df, df_error, conf.level): bounds are clipped at 0 when the
    observed F is at or below the central F's a/2 (upper bound) or 1 - a/2 (lower bound) quantile.
    Note effectsize's eta-squared family default is ci = .95 one-sided ("greater"), i.e. call this
    with level = .90 and set the upper bound to 1 — see `partial_pve`.
    """
    if not (np.isfinite(f) and np.isfinite(df1) and np.isfinite(df2)):
        return float("nan"), float("nan")
    a = 1 - level
    cdf = lambda lam: stats.ncf.cdf(f, df1, df2, lam) if lam > 0 else stats.f.cdf(f, df1, df2)  # noqa: E731
    lam0 = f * df1
    step = max(2.0, lam0 / 2)
    lo = _root(cdf, 1 - a / 2, lam0, step, lower_limit=0.0)
    hi = _root(cdf, a / 2, lam0, step, lower_limit=0.0)
    if f <= stats.f.ppf(a / 2, df1, df2):
        hi = 0.0
    if f <= stats.f.ppf(1 - a / 2, df1, df2):
        lo = 0.0
    return lo, hi


def partial_pve(f: float, df1: float, df2: float, kind: str = "eta2", level: float = 0.95,
                alternative: str = GREATER) -> Estimate:
    """Partial eta² / epsilon² / omega² from F with a noncentral-F CI.

    Matches effectsize::F_to_eta2 / F_to_epsilon2 / F_to_omega2 (internal .F_to_pve), including
    its defaults (alternative = "greater": one-sided CI whose upper bound is 1) and its convention
    that the CI endpoints are eta²-transformed noncentrality bounds of the F implied by the
    point estimate:  eta² = F df1 / (F df1 + df2);  eps² = max(0, (F-1) df1 / (F df1 + df2));
    omega² = max(0, (F-1) df1 / (F df1 + df2 + 1)).
    """
    if kind == "eta2":
        value = f * df1 / (f * df1 + df2)
    elif kind == "epsilon2":
        value = max(0.0, (f - 1) * df1 / (f * df1 + df2))
    elif kind == "omega2":
        value = max(0.0, (f - 1) * df1 / (f * df1 + df2 + 1))
    else:
        raise ValueError(kind)
    f_equiv = max(0.0, (value / df1) / ((1 - value) / df2))
    lam_lo, lam_hi = ncf_ci(f_equiv, df1, df2, adjust_level(level, alternative))

    def to_eta2(lam):
        fs = lam / df1
        return fs * df1 / (fs * df1 + df2)

    lo, hi = to_eta2(lam_lo), to_eta2(lam_hi)
    if alternative == GREATER:
        hi = 1.0
    elif alternative == LESS:
        lo = 0.0
    return _est(value, lo, hi, level)


# ---------------------------------------------------------------------------
# Standardized mean differences
# ---------------------------------------------------------------------------
def _smd(diff: float, s: float, se: float, hn: float, df: float, level: float, alternative: str,
         adjust: bool, mu: float = 0.0) -> Estimate:
    """Core of effectsize:::.effect_size_difference: d = (diff - mu) / s, CI = ncp bounds * sqrt(hn)."""
    if not (s > 0 and se > 0 and np.isfinite(df) and df > 0):
        return Estimate(None, None, None, level)
    d = (diff - mu) / s
    lo, hi = nct_ci((diff - mu) / se, df, level, alternative)
    lo, hi = lo * math.sqrt(hn), hi * math.sqrt(hn)
    if adjust:
        j = hedges_j(df)
        d, lo, hi = d * j, lo * j, hi * j
    return _est(d, lo, hi, level)


def cohens_d_one_sample(x, mu: float = 0.0, level: float = 0.95, alternative: str = TWO_SIDED,
                        adjust: bool = False) -> Estimate:
    """d = (M - mu) / SD. R: effectsize::cohens_d(x, mu = mu) (hedges_g with adjust=True).

    CI: noncentral t with t = (M - mu) / (SD / sqrt(n)), df = n - 1, scaled by sqrt(1/n).
    """
    x = np.asarray(x, float)
    n = len(x)
    if n < 2:
        return Estimate(None, None, None, level)
    s = float(np.std(x, ddof=1))
    return _smd(float(np.mean(x)), s, s / math.sqrt(n), 1 / n, n - 1, level, alternative, adjust, mu)


def cohens_d(x, y, pooled: bool = True, level: float = 0.95, alternative: str = TWO_SIDED,
             adjust: bool = False) -> Estimate:
    """Two independent samples, d = (M_x - M_y) / s.

    R: effectsize::cohens_d(x, y, pooled_sd = TRUE/FALSE, paired = FALSE); hedges_g = adjust=True
    (d * J(df)). pooled: s = sqrt(((n1-1)s1² + (n2-1)s2²) / (n1+n2-2)), df = n1+n2-2,
    hn = 1/n1 + 1/n2. Unpooled: s = sqrt((s1² + s2²)/2), Welch-Satterthwaite df,
    hn = 2 (n2 s1² + n1 s2²) / (n1 n2 (s1² + s2²)).
    """
    x, y = np.asarray(x, float), np.asarray(y, float)
    n1, n2 = len(x), len(y)
    if n1 < 2 or n2 < 2:
        return Estimate(None, None, None, level)
    diff = float(np.mean(x) - np.mean(y))
    v1, v2 = float(np.var(x, ddof=1)), float(np.var(y, ddof=1))
    if pooled:
        s = math.sqrt(((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2))
        hn = 1 / n1 + 1 / n2
        se = s * math.sqrt(hn)
        df = n1 + n2 - 2
    else:
        s = math.sqrt((v1 + v2) / 2)
        if v1 + v2 == 0:
            return Estimate(None, None, None, level)
        hn = 2 * (n2 * v1 + n1 * v2) / (n1 * n2 * (v1 + v2))
        se1, se2 = v1 / n1, v2 / n2
        se = math.sqrt(se1 + se2)
        df = (se1 + se2) ** 2 / (se1 ** 2 / (n1 - 1) + se2 ** 2 / (n2 - 1))
    return _smd(diff, s, se, hn, df, level, alternative, adjust)


def hedges_g(x, y, pooled: bool = True, level: float = 0.95, alternative: str = TWO_SIDED) -> Estimate:
    """Hedges' g = d * J(df) (exact gamma correction). R: effectsize::hedges_g(x, y, pooled_sd = TRUE)."""
    return cohens_d(x, y, pooled, level, alternative, adjust=True)


def glass_delta(x, y, level: float = 0.95, alternative: str = TWO_SIDED, adjust: bool = False) -> Estimate:
    """Glass's delta = (M_x - M_y) / SD_y, y = the reference (control) group.

    R: effectsize::glass_delta(x, y, adjust = FALSE) (effectsize's default is adjust = TRUE; we report
    the classical unadjusted delta). CI: noncentral t with se = s2 sqrt(hn), df = n2 - 1,
    hn = 1/n2 + s1² / (n1 s2²).
    """
    x, y = np.asarray(x, float), np.asarray(y, float)
    n1, n2 = len(x), len(y)
    if n1 < 2 or n2 < 2:
        return Estimate(None, None, None, level)
    s1, s2 = float(np.std(x, ddof=1)), float(np.std(y, ddof=1))
    if s2 == 0:
        return Estimate(None, None, None, level)
    hn = 1 / n2 + s1 ** 2 / (n1 * s2 ** 2)
    return _smd(float(np.mean(x) - np.mean(y)), s2, s2 * math.sqrt(hn), hn, n2 - 1, level, alternative, adjust)


def d_z(x, y, level: float = 0.95, alternative: str = TWO_SIDED, adjust: bool = False) -> Estimate:
    """Paired d_z = M_diff / SD_diff (diff = x - y). R: effectsize::cohens_d(x, y, paired = TRUE).

    Noncentral-t CI with df = n - 1 and hn = 1/n (identical to a one-sample d on the differences).
    """
    diffs = np.asarray(x, float) - np.asarray(y, float)
    return cohens_d_one_sample(diffs, 0.0, level, alternative, adjust)


def d_av(x, y, level: float = 0.95, alternative: str = TWO_SIDED) -> Estimate:
    """Paired d_av = M_diff / sqrt((SD_x² + SD_y²)/2) (Cumming, 2012; Lakens, 2013).

    R: effectsize::repeated_measures_d(x, y, method = "av", adjust = FALSE). effectsize has no
    noncentral-t CI for d_av; it uses the normal approximation d ± z * se with
    se = sqrt(var(x - y) / n) / s_av, which we match.
    """
    x, y = np.asarray(x, float), np.asarray(y, float)
    n = len(x)
    if n < 2:
        return Estimate(None, None, None, level)
    s = math.sqrt((np.var(x, ddof=1) + np.var(y, ddof=1)) / 2)
    if s == 0:
        return Estimate(None, None, None, level)
    diffs = x - y
    d = float(np.mean(diffs)) / s
    se = math.sqrt(np.var(diffs, ddof=1) / n) / s
    a = 1 - adjust_level(level, alternative)
    z = stats.norm.ppf(1 - a / 2)
    lo, hi = d - z * se, d + z * se
    if alternative == GREATER:
        hi = math.inf
    elif alternative == LESS:
        lo = -math.inf
    return _est(d, lo, hi, level)


def r_from_t(t: float, df: float, level: float = 0.95, alternative: str = TWO_SIDED) -> Estimate:
    """r = t / sqrt(t² + df), CI from the noncentral-t bounds mapped the same way.

    R: effectsize::t_to_r(t, df_error). One-sided open bounds are limited to -1 / 1.
    """
    if not (np.isfinite(t) and np.isfinite(df)):
        return Estimate(None, None, None, level)
    r = t / math.sqrt(t * t + df)
    lo, hi = nct_ci(t, df, level, alternative)
    to_r = lambda v: v / math.sqrt(v * v + df) if np.isfinite(v) else math.copysign(1.0, v)  # noqa: E731
    return _est(r, to_r(lo), to_r(hi), level)


def mean_difference_ci(diff: float, se: float, df: float, level: float = 0.95,
                       alternative: str = TWO_SIDED) -> Estimate:
    """Unstandardized difference with the t-based CI printed by stats::t.test (conf.int)."""
    if not (np.isfinite(se) and se > 0 and np.isfinite(df)):
        return _est(diff, None, None, level)
    if alternative == TWO_SIDED:
        q = stats.t.ppf(1 - (1 - level) / 2, df)
        return _est(diff, diff - q * se, diff + q * se, level)
    q = stats.t.ppf(level, df)
    if alternative == GREATER:
        return _est(diff, diff - q * se, None, level)
    return _est(diff, None, diff + q * se, level)
