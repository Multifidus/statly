"""Rank-based statistics and effect sizes for the nonparametric family (SPEC §8), matched to R.

- Exact conditional null distributions of the Wilcoxon statistics, as R >= 4.4 `wilcox.test`
  computes them (`.dsignrank` / `.dwilcox` with a score vector z): ties and zeros allowed.
- Rank-biserial correlation with effectsize 1.0's Fisher-z normal CI (`effectsize::rank_biserial`).
- r = z / sqrt(N) and its CI: the rank-biserial CI rescaled (r and r_rb are linear in U / V).
- Rank epsilon² (`effectsize::rank_epsilon_squared`) and Kendall's W (`effectsize::kendalls_w`)
  with effectsize's percentile-bootstrap CI (200 iterations, one-sided "greater" at the request's
  level, upper bound 1). The bootstrap reproduces R draw for draw: `RRandom` is R's default
  generator (Mersenne-Twister, `set.seed` scrambling, rejection-sampled `sample.int`), the resampling
  order follows `boot::boot` and effectsize's statistic, and the interval is `boot::norm.inter`.
  With the same seed (options.bootstrap_seed, default 12345) the CI equals R's to ~1e-12.
"""

from __future__ import annotations

import math

import numpy as np
from scipy import stats

from statly_engine.stats.effect_sizes import GREATER, LESS, TWO_SIDED, Estimate, adjust_level

BOOT_SEED = 12345
BOOT_ITERATIONS = 200
_I2_32M1 = 2.328306437080797e-10


# ---------------------------------------------------------------------------
# R's random number generator (for bit-identical bootstrap intervals)
# ---------------------------------------------------------------------------
class RRandom:
    """R's default RNG after `set.seed(seed)`: Mersenne-Twister + R_unif_index (sample.kind "Rejection")."""

    def __init__(self, seed: int):
        s = int(seed) & 0xFFFFFFFF
        for _ in range(50):                      # RNG_Init: initial scrambling
            s = (69069 * s + 1) & 0xFFFFFFFF
        key = np.empty(625, dtype=np.uint32)
        for j in range(625):
            s = (69069 * s + 1) & 0xFFFFFFFF
            key[j] = s
        self._bg = np.random.MT19937(0)          # dummy[0] (mti) is fixed up to 624 = regenerate
        self._bg.state = {"bit_generator": "MT19937", "state": {"key": key[1:], "pos": 624}}
        self._buf = np.empty(0)
        self._pos = 0

    def _fill(self, n: int) -> None:
        if len(self._buf) - self._pos >= n:
            return
        u = self._bg.random_raw(max(n, 4096)).astype(np.float64) * 2.3283064365386963e-10
        u[u <= 0.0] = 0.5 * _I2_32M1             # fixup(): keep strictly inside (0, 1)
        u[1.0 - u <= 0.0] = 1.0 - 0.5 * _I2_32M1
        self._buf = np.concatenate([self._buf[self._pos:], u])
        self._pos = 0

    def unif(self, n: int) -> np.ndarray:
        self._fill(n)
        out = self._buf[self._pos:self._pos + n]
        self._pos += n
        return out

    def index(self, dn: int, size: int) -> np.ndarray:
        """`size` draws of R_unif_index(dn) in [0, dn): 0-based `sample.int(dn, size, TRUE) - 1`."""
        if dn <= 0 or size <= 0:
            return np.zeros(max(size, 0), dtype=np.int64)
        bits = int(math.ceil(math.log2(dn)))
        chunks, mask = bits // 16 + 1, (1 << bits) - 1
        out, got = [], 0
        while got < size:
            attempts = int((size - got) * 2.2) + 16
            self._fill(attempts * chunks)
            u = self._buf[self._pos:self._pos + attempts * chunks].reshape(attempts, chunks)
            v = np.zeros(attempts, dtype=np.int64)
            for c in range(chunks):
                v = v * 65536 + np.floor(u[:, c] * 65536).astype(np.int64)
            v &= mask
            ok = np.flatnonzero(v < dn)[: size - got]
            used = attempts if len(ok) < size - got else int(ok[-1]) + 1
            out.append(v[ok])
            got += len(ok)
            self._pos += used * chunks
        return np.concatenate(out)


def norm_inter(t: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """boot:::norm.inter: order-statistic interpolation on the normal scale (percentile CI)."""
    t = np.sort(np.asarray(t, float)[np.isfinite(t)])
    r = len(t)
    if r == 0:
        return np.full(len(alpha), np.nan)
    rk = (r + 1) * np.asarray(alpha, float)
    k = np.trunc(rk).astype(int)
    out = np.empty(len(alpha))
    for i, (kk, rr, a) in enumerate(zip(k, rk, alpha)):
        if kk == 0:
            out[i] = t[0]
        elif kk >= r:
            out[i] = t[r - 1]
        elif kk == rr:
            out[i] = t[kk - 1]
        else:
            z1, z2, z3 = stats.norm.ppf(a), stats.norm.ppf(kk / (r + 1)), stats.norm.ppf((kk + 1) / (r + 1))
            out[i] = t[kk - 1] + (z1 - z2) / (z3 - z2) * (t[kk] - t[kk - 1])
    return out


def _perc_ci(t_star: np.ndarray, level: float) -> tuple[float, float]:
    """boot.ci(type = "perc") at `level` two-sided -> (lower, upper)."""
    lo, hi = norm_inter(t_star, np.array([(1 - level) / 2, (1 + level) / 2]))
    return float(lo), float(hi)


# ---------------------------------------------------------------------------
# Ranks and exact Wilcoxon distributions
# ---------------------------------------------------------------------------
def rank(x) -> np.ndarray:
    """Average (mid) ranks, R's rank(ties.method = "average")."""
    return stats.rankdata(np.asarray(x, float), method="average")


def tie_sum(r) -> float:
    """sum(t^3 - t) over tie groups of a rank / value vector."""
    _, counts = np.unique(np.asarray(r, float), return_counts=True)
    return float(np.sum(counts.astype(float) ** 3 - counts))


def _scaled(z) -> tuple[np.ndarray, int]:
    z = np.asarray(z, float)
    f = 1 if np.all(z == np.floor(z)) else 2
    return np.rint(f * z).astype(np.int64), f


def signrank_cdf(q: float, z, lower: bool = True) -> float:
    """R .psignrank(q, n, z): P(V <= q) (or P(V > q) if not lower) where V = sum of the scores z
    whose sign is positive, each sign equally likely (exact conditional null)."""
    zi, f = _scaled(z)
    total = int(zi.sum())
    d = np.zeros(total + 1)
    d[0] = 1.0
    for s in zi:
        nd = d * 0.5
        nd[s:] += 0.5 * d[: total + 1 - s]
        d = nd
    vals = np.arange(total + 1) / f
    p = float(d[vals < q + 1e-8].sum())
    return p if lower else 1.0 - p


def ranksum_cdf(q: float, z, m: int, lower: bool = True) -> float:
    """R .pwilcox(q, m, n, z): P(W <= q), W = (sum of m scores drawn without replacement from z)
    - m(m+1)/2, all subsets equally likely (exact conditional null of the rank-sum statistic)."""
    zi, f = _scaled(z)
    total = int(zi.sum())
    dp = np.zeros((m + 1, total + 1))
    dp[0, 0] = 1.0
    for i, s in enumerate(zi):
        for j in range(min(i + 1, m), 0, -1):
            dp[j, s:] += dp[j - 1, : total + 1 - s]
    d = dp[m] / dp[m].sum()
    vals = np.arange(total + 1) / f - m * (m + 1) / 2
    p = float(d[vals < q + 1e-8].sum())
    return p if lower else 1.0 - p


def normal_p(z: float, alternative: str) -> float:
    if alternative == LESS:
        return float(stats.norm.cdf(z))
    if alternative == GREATER:
        return float(stats.norm.sf(z))
    p = float(stats.norm.cdf(z))
    return 2 * min(p, 1 - p)


def _continuity(diff: float, alternative: str) -> float:
    if alternative == TWO_SIDED:
        return float(np.sign(diff)) * 0.5
    return 0.5 if alternative == GREATER else -0.5


def ranksum_test(x, y, alternative: str = TWO_SIDED) -> dict:
    """stats::wilcox.test(x, y) defaults (R 4.6): W, p, method; plus z without continuity correction."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    n1, n2 = len(x), len(y)
    r = rank(np.concatenate([x, y]))
    w = float(r[:n1].sum() - n1 * (n1 + 1) / 2)
    ties = len(np.unique(r)) != len(r)
    mean = n1 * n2 / 2
    sigma = math.sqrt((n1 * n2 / 12) * ((n1 + n2 + 1) - tie_sum(r) / ((n1 + n2) * (n1 + n2 - 1))))
    z_plain = (w - mean) / sigma if sigma > 0 else float("nan")
    exact = n1 < 50 and n2 < 50
    if exact:
        if alternative == LESS:
            p = ranksum_cdf(w, r, n1)
        elif alternative == GREATER:
            p = ranksum_cdf(w - 0.25, r, n1, lower=False)
        else:
            p = min(2 * ranksum_cdf(w, r, n1), 2 * ranksum_cdf(w - 0.25, r, n1, lower=False), 1.0)
        method = "exact" + (" (conditional on ties)" if ties else "")
    else:
        zc = (w - mean - _continuity(w - mean, alternative)) / sigma if sigma > 0 else float("nan")
        p = normal_p(zc, alternative) if math.isfinite(zc) else float("nan")
        method = "normal approximation with continuity correction"
    return {"w": w, "p": p, "z": z_plain, "exact": exact, "method": method, "sigma": sigma, "n": n1 + n2}


def signrank_test(d, alternative: str = TWO_SIDED) -> dict:
    """stats::wilcox.test(d) defaults (R 4.6) for differences d = x - y - mu.

    Exact (n < 50, n counting zeros): ranks of |d| over *all* differences, zeros then left out of the
    exact conditional distribution (R's exact code path). Normal approximation (n >= 50): zeros
    dropped before ranking, tie-corrected variance, continuity correction. The reported z (and r)
    always uses the zero-dropped normal approximation without continuity correction.
    """
    d = np.asarray(d, float)
    n = len(d)
    nz = d[d != 0]
    nd = len(nz)
    r_nz = rank(np.abs(nz))
    v_asym = float(r_nz[nz > 0].sum())
    mean = nd * (nd + 1) / 4
    sigma = math.sqrt(nd * (nd + 1) * (2 * nd + 1) / 24 - tie_sum(r_nz) / 48) if nd else 0.0
    z_plain = (v_asym - mean) / sigma if sigma > 0 else float("nan")
    exact = n < 50
    if exact:
        r_all = rank(np.abs(d))
        v = float(r_all[d > 0].sum())
        z = r_all[d != 0]
        mid = z.sum() / 2
        if alternative == LESS:
            p = signrank_cdf(v, z)
        elif alternative == GREATER:
            p = signrank_cdf(v - 0.25, z, lower=False)
        else:
            p = signrank_cdf(v - 0.25, z, lower=False) if v > mid else signrank_cdf(v, z)
            p = min(2 * p, 1.0)
        ties = len(np.unique(r_all)) != len(r_all)
        method = "exact" + (" (conditional on ties/zeros)" if ties or nd < n else "")
    else:
        v = v_asym
        zc = (v - mean - _continuity(v - mean, alternative)) / sigma if sigma > 0 else float("nan")
        p = normal_p(zc, alternative) if math.isfinite(zc) else float("nan")
        method = "normal approximation with continuity correction"
    return {"v": v, "p": p, "z": z_plain, "exact": exact, "method": method, "sigma": sigma, "n_nonzero": nd}


# ---------------------------------------------------------------------------
# Rank-biserial and r
# ---------------------------------------------------------------------------
def _limit(lo, hi, alternative, lb, ub):
    if alternative == GREATER:
        hi = ub
    elif alternative == LESS:
        lo = lb
    return lo, hi


def _rb_ci(rb: float, se: float, level: float, alternative: str) -> tuple[float, float]:
    a = 1 - adjust_level(level, alternative)
    q = stats.norm.ppf(1 - a / 2)
    f = math.atanh(rb) if abs(rb) < 1 else math.copysign(math.inf, rb)
    lo, hi = math.tanh(f - q * se), math.tanh(f + q * se)
    return _limit(lo, hi, alternative, -1.0, 1.0)


def rank_biserial_independent(x, y, level: float = 0.95, alternative: str = TWO_SIDED) -> Estimate:
    """effectsize::rank_biserial(x, y): (U1 - U2) / (n1 n2), CI tanh(atanh(r) ± z se),
    se = sqrt((n1 + n2 + 1) / (3 n1 n2))."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    n1, n2 = len(x), len(y)
    if n1 == 0 or n2 == 0:
        return Estimate(None, None, None, level)
    r = rank(np.concatenate([x, y]))
    u1 = r[:n1].sum() - n1 * (n1 + 1) / 2
    u2 = r[n1:].sum() - n2 * (n2 + 1) / 2
    rb = float((u1 - u2) / (n1 * n2))
    lo, hi = _rb_ci(rb, math.sqrt((n1 + n2 + 1) / (3 * n1 * n2)), level, alternative)
    return Estimate(rb, lo, hi, level)


def rank_biserial_paired(d, level: float = 0.95, alternative: str = TWO_SIDED) -> Estimate:
    """effectsize::rank_biserial(x, y, paired = TRUE) / (x, mu = mu) on d = x - y - mu: zeros dropped,
    signed ranks of the rest; (W+ - W-) / S, S = nd(nd+1)/2; se = sqrt((2nd³ + 3nd² + nd)/6) / S."""
    d = np.asarray(d, float)
    nz = d[d != 0]
    nd = len(nz)
    if nd == 0:
        return Estimate(None, None, None, level)
    r = rank(np.abs(nz))
    s = nd * (nd + 1) / 2
    rb = float((r[nz > 0].sum() - r[nz < 0].sum()) / s)
    lo, hi = _rb_ci(rb, math.sqrt((2 * nd ** 3 + 3 * nd ** 2 + nd) / 6) / s, level, alternative)
    return Estimate(rb, lo, hi, level)


def r_from_z(z: float, n: int, rb: Estimate, alternative: str = TWO_SIDED) -> Estimate:
    """r = z / sqrt(N) (z: normal approximation without continuity correction).

    r is a fixed multiple of the rank-biserial correlation (both are linear in U or V), so its CI is
    the rank-biserial CI times r / r_rb; one-sided open bounds are the parameter limits -1 / 1.
    """
    level = rb.level
    if not (math.isfinite(z) and n > 0):
        return Estimate(None, None, None, level)
    r = z / math.sqrt(n)
    if rb.value is None or rb.value == 0 or rb.lower is None or rb.upper is None:
        return Estimate(r, None, None, level)
    k = r / rb.value
    lo, hi = k * rb.lower, k * rb.upper
    lo, hi = _limit(lo, hi, alternative, -1.0, 1.0)
    return Estimate(r, lo, hi, level)


# ---------------------------------------------------------------------------
# Kruskal-Wallis H / epsilon², Friedman / Kendall's W
# ---------------------------------------------------------------------------
def kruskal_h(values: np.ndarray, codes: np.ndarray, k: int) -> float:
    """Tie-corrected H (stats::kruskal.test). NaN when every value is tied."""
    n = len(values)
    r = rank(values)
    sums = np.bincount(codes, weights=r, minlength=k)
    ns = np.bincount(codes, minlength=k).astype(float)
    ok = ns > 0
    h = 12 / (n * (n + 1)) * float(np.sum(sums[ok] ** 2 / ns[ok])) - 3 * (n + 1)
    denom = 1 - tie_sum(r) / (n ** 3 - n)
    return h / denom if denom > 0 else float("nan")


def rank_epsilon_squared(groups: list[np.ndarray], level: float = 0.95, seed: int = BOOT_SEED,
                         iterations: int = BOOT_ITERATIONS) -> Estimate:
    """effectsize::rank_epsilon_squared: E = H / ((n² - 1) / (n + 1)) = H / (n - 1).

    CI: effectsize's percentile bootstrap (values resampled with replacement within each group of size
    >= 2; groups in level order, values in row order), alternative "greater" -> two-sided (2L - 1)
    interval with the upper bound set to 1. RNG use mirrors boot::boot: first the n x R index matrix
    (unused by this statistic), then the t0 call (which also resamples), then the R replicates.
    """
    groups = [np.asarray(g, float) for g in groups]
    values = np.concatenate(groups)
    codes = np.concatenate([np.full(len(g), i) for i, g in enumerate(groups)])
    n, k = len(values), len(groups)
    h = kruskal_h(values, codes, k)
    if not math.isfinite(h):
        return Estimate(None, None, None, level)
    e = h / ((n ** 2 - 1) / (n + 1))
    rng = RRandom(seed)
    rng.index(n, n * iterations)

    def resample() -> np.ndarray:
        return np.concatenate([g if len(g) < 2 else g[rng.index(len(g), len(g))] for g in groups])

    resample()                               # boot's t0 = statistic(data, original) also resamples
    t_star = np.array([kruskal_h(resample(), codes, k) for _ in range(iterations)]) / ((n ** 2 - 1) / (n + 1))
    lo, _ = _perc_ci(t_star, adjust_level(level, GREATER))
    return Estimate(e, lo, 1.0, level)


def friedman_ranks(m: np.ndarray) -> np.ndarray:
    """Within-block average ranks (blocks = rows)."""
    return np.apply_along_axis(rank, 1, np.asarray(m, float))


def kendalls_w_value(ranks: np.ndarray) -> float:
    """effectsize:::.kendalls_w with the tie correction (identical to the untied formula without ties)."""
    m, n = ranks.shape
    rs = ranks.sum(axis=0)
    tj = sum(tie_sum(row) for row in ranks)
    denom = m ** 2 * (n ** 3 - n) - m * tj
    return (12 * float(np.sum(rs ** 2)) - 3 * m ** 2 * n * (n + 1) ** 2) / denom if denom > 0 else float("nan")


def kendalls_w(m: np.ndarray, level: float = 0.95, seed: int = BOOT_SEED,
               iterations: int = BOOT_ITERATIONS) -> Estimate:
    """effectsize::kendalls_w on a complete blocks x conditions matrix, percentile bootstrap over
    blocks (boot's index matrix, R x n, filled column-wise), one-sided "greater" (upper bound 1)."""
    ranks = friedman_ranks(m)
    w = kendalls_w_value(ranks)
    if not math.isfinite(w):
        return Estimate(None, None, None, level)
    nb = ranks.shape[0]
    idx = RRandom(seed).index(nb, nb * iterations).reshape(nb, iterations).T
    t_star = np.array([kendalls_w_value(ranks[i]) for i in idx])
    lo, _ = _perc_ci(t_star, adjust_level(level, GREATER))
    return Estimate(w, lo, 1.0, level)


# ---------------------------------------------------------------------------
# Sign test
# ---------------------------------------------------------------------------
def binom_test_half(k: int, n: int, alternative: str = TWO_SIDED) -> float:
    """stats::binom.test(k, n, 0.5)$p.value."""
    if alternative == LESS:
        return float(stats.binom.cdf(k, n, 0.5))
    if alternative == GREATER:
        return float(stats.binom.sf(k - 1, n, 0.5))
    return float(stats.binomtest(k, n, 0.5).pvalue)


def clopper_pearson(k: int, n: int, level: float = 0.95, alternative: str = TWO_SIDED) -> tuple[float, float]:
    """binom.test conf.int (one-sided intervals end at 0 / 1)."""
    def lower(a):
        return 0.0 if k == 0 else float(stats.beta.ppf(a, k, n - k + 1))

    def upper(a):
        return 1.0 if k == n else float(stats.beta.ppf(1 - a, k + 1, n - k))

    if alternative == LESS:
        return 0.0, upper(1 - level)
    if alternative == GREATER:
        return lower(1 - level), 1.0
    a = (1 - level) / 2
    return lower(a), upper(a)
