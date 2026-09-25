"""Linear-model helpers and model-based assumption checks for ANCOVA / MANOVA / MANCOVA (SPEC §8).

Reference: fixtures/r/ancova_manova.R. Each check returns an AssumptionResult dict (same shape as
stats/assumptions.py builds). Linear models are fitted by least squares on an explicit design matrix
(intercept, covariates, sum-to-zero group contrasts = R's contr.sum), so every sum of squares is the R
`lm` one.

Checks:
- homogeneity of regression slopes: nested F test of the group × covariate interactions (all covariates
  jointly), anova(lm(y ~ cov + g), lm(y ~ cov + g + g:cov)); for several outcomes, Pillai's approximate F of
  the same comparison (anova.mlm(test = "Pillai")).
- linearity: within each group and covariate, the F test for adding x² to y ~ x
  (anova(lm(y ~ x), lm(y ~ x + I(x^2)))). A clear curve means a straight-line adjustment is off.
- residual normality: Shapiro-Wilk on the model residuals (stats::shapiro.test(residuals(fit))).
- Box's M (equal covariance matrices): heplots::boxM chi-square approximation,
  M = (N - k) ln|S_pooled| - sum (n_i - 1) ln|S_i|, c = (sum 1/(n_i - 1) - 1/(N - k)) (2p² + 3p - 1) /
  (6 (p + 1)(k - 1)), X² = M (1 - c), df = p (p + 1)(k - 1) / 2. Judged at .001 (Box's M flags trivial
  differences; Tabachnick & Fidell).
- multivariate outliers: Mahalanobis D² of each case's residual vector with S = SSPE / df_error
  (stats::mahalanobis(residuals(fit), 0, S)); flagged when D² > the chi-square (df = p) .999 quantile.
- multicollinearity between outcomes: largest |r| among the outcomes; above .9 is flagged.
"""

from __future__ import annotations

import math

import numpy as np
from scipy import linalg, stats

from statly_engine.stats import assumptions as asm
from statly_engine.stats.apa import p_value

BOX_M_ALPHA = 0.001
OUTLIER_P = 0.001
COLLINEAR_R = 0.9


# ---------------------------------------------------------------------------
# Linear-model helpers (shared by ancova.py, quade.py, manova.py)
# ---------------------------------------------------------------------------
def sum_contrasts(codes: np.ndarray, k: int) -> np.ndarray:
    """N × (k - 1) contr.sum coding: level j < k-1 -> e_j, last level -> -1 everywhere."""
    z = np.zeros((len(codes), k - 1))
    for j in range(k - 1):
        z[codes == j, j] = 1.0
    z[codes == k - 1, :] = -1.0
    return z


def design(blocks: list[np.ndarray]) -> tuple[np.ndarray, list[slice]]:
    """[1 | block_1 | block_2 ...] and the column slice of every block."""
    n = len(blocks[0]) if blocks else 0
    cols, slices, at = [np.ones((n, 1))], [], 1
    for b in blocks:
        b = np.asarray(b, float).reshape(n, -1)
        cols.append(b)
        slices.append(slice(at, at + b.shape[1]))
        at += b.shape[1]
    return np.hstack(cols), slices


def fit(X: np.ndarray, Y: np.ndarray) -> dict:
    """Least squares. Returns coefficients, residuals, rank and (X'X)^-1."""
    beta, _, rank, _ = np.linalg.lstsq(X, Y, rcond=None)
    resid = Y - X @ beta
    return {"beta": beta, "resid": resid, "rank": int(rank), "xtx_inv": np.linalg.pinv(X.T @ X)}


def rss(X: np.ndarray, Y: np.ndarray) -> np.ndarray:
    """Residual SSCP matrix (or residual SS for a vector y)."""
    r = fit(X, Y)["resid"]
    return r.T @ r


def drop(X: np.ndarray, sl: slice) -> np.ndarray:
    return np.delete(X, np.arange(sl.start, sl.stop), axis=1)


def multivariate_tests(H: np.ndarray, E: np.ndarray, q: float, df_e: float) -> dict[str, tuple]:
    """Pillai, Wilks, Hotelling-Lawley, Roy: (statistic, approx F, df1, df2, p), as car:::Pillai etc.

    Eigenvalues of E^-1 H (all p of them, as car uses length(eig) = number of outcomes).
    """
    eig = np.clip(np.real(linalg.eigvals(np.linalg.solve(E, H))), 0.0, None)
    p = len(eig)
    s = min(p, q)
    m = 0.5 * (abs(p - q) - 1)
    n = 0.5 * (df_e - p - 1)
    out = {}
    v = float(np.sum(eig / (1 + eig)))
    t1, t2 = 2 * m + s + 1, 2 * n + s + 1
    out["pillai"] = (v, (t2 / t1 * v) / (s - v) if s - v > 0 else math.inf, s * t1, s * t2)
    lam = float(np.prod(1 / (1 + eig)))
    w1 = df_e - 0.5 * (p - q + 1)
    w2 = (p * q - 2) / 4
    w3 = p * p + q * q - 5
    w3 = math.sqrt(((p * q) ** 2 - 4) / w3) if w3 > 0 else 1.0
    out["wilks"] = (lam, ((lam ** (-1 / w3) - 1) * (w1 * w3 - 2 * w2)) / p / q, p * q, w1 * w3 - 2 * w2)
    hl = float(np.sum(eig))
    h2 = 2 * (s * n + 1)
    out["hotelling_lawley"] = (hl, (h2 * hl) / s / s / t1, s * t1, h2)
    roy = float(np.max(eig))
    r1 = max(p, q)
    r2 = df_e - r1 + q
    out["roy"] = (roy, (r2 * roy) / r1, r1, r2)
    return {k: (st, f, d1, d2, float(stats.f.sf(f, d1, d2)) if math.isfinite(f) else 0.0)
            for k, (st, f, d1, d2) in out.items()}


# ---------------------------------------------------------------------------
# Result helpers
# ---------------------------------------------------------------------------
def _pp(p) -> str:
    s = p_value(p)
    return f"p {s}" if s[0] in "<>" else f"p = {s}"


def _res(assumption, label, key, test_label, symbol, value, df, p, verdict, text, sc, refs=None) -> dict:
    stat = None if value is None or not math.isfinite(value) else {"symbol": symbol, "value": float(value),
                                                                  "df": [float(d) for d in df]}
    return {"schema_version": 1, "assumption": assumption, "label": label,
            "test_used": {"key": key, "label": test_label} if key else None, "statistic": stat,
            "p": None if p is None or not math.isfinite(p) else float(min(max(p, 0.0), 1.0)),
            "verdict": verdict, "explanation": text, "applies_to": sc, "chart_refs": refs or []}


def slopes_result(f, df1, df2, p, n: int, alpha: float, multivariate: bool = False) -> dict:
    sc = asm.scope("overall", "all groups", None, n)
    args = ("homogeneity_of_regression_slopes", "Equal slopes (homogeneity of regression slopes)",
            "slopes_interaction", "Group × covariate interaction" + (" (Pillai)" if multivariate else ""), "F")
    if f is None or not math.isfinite(f):
        return _res(*args, None, [], None, "caution", "The equal-slopes check could not be computed (too few "
                    "people per group for the extra interaction terms).", sc)
    if p >= alpha:
        return _res(*args, f, [df1, df2], p, "passed", "The link between the covariate and the outcome looks "
                    f"about the same in every group ({_pp(p)}), so adjusting all groups the same way is reasonable.", sc)
    return _res(*args, f, [df1, df2], p, "failed", "The link between the covariate and the outcome differs "
                f"between groups ({_pp(p)}). The adjusted means then depend on which covariate value you pick, "
                "so describe the groups separately (or model the interaction) rather than relying on one "
                "adjusted comparison.", sc)


def slopes_test(y: np.ndarray, covs: np.ndarray, contr: np.ndarray, alpha: float) -> dict:
    """Joint F for all group × covariate interactions (one outcome) or Pillai's F (several)."""
    n = len(y)
    X0, _ = design([covs, contr])
    inter = np.hstack([contr * covs[:, [c]] for c in range(covs.shape[1])])
    X1, _ = design([covs, contr, inter])
    df2 = n - np.linalg.matrix_rank(X1)
    df1 = np.linalg.matrix_rank(X1) - np.linalg.matrix_rank(X0)
    if df2 <= 0 or df1 <= 0:
        return slopes_result(None, None, None, None, n, alpha, y.ndim > 1)
    E1, E0 = rss(X1, y), rss(X0, y)
    if y.ndim == 1:
        if E1 <= 0:
            return slopes_result(None, None, None, None, n, alpha)
        f = ((E0 - E1) / df1) / (E1 / df2)
        return slopes_result(float(f), df1, df2, float(stats.f.sf(f, df1, df2)), n, alpha)
    if np.linalg.matrix_rank(E1) < E1.shape[0]:
        return slopes_result(None, None, None, None, n, alpha, True)
    _, f, d1, d2, p = multivariate_tests(E0 - E1, E1, df1, df2)["pillai"]
    return slopes_result(f, d1, d2, p, n, alpha, True)


def linearity(x: np.ndarray, y: np.ndarray, label: str, group: dict, alpha: float) -> dict:
    """Within one group: F for adding x² to y ~ x (curvature)."""
    n = len(x)
    sc = asm.scope("group", label, group, n)
    args = ("linearity", "Linearity (covariate and outcome)", "quadratic_term", "Curvature (quadratic term) F", "F")
    xc = x - np.mean(x)
    if n < 4 or len(np.unique(x)) < 3:
        return _res(*args, None, [], None, "caution", f"Linearity can't be checked for {label}: it needs at least "
                    "4 people and 3 different covariate values. Look at the scatterplot instead.", sc)
    X1, _ = design([xc])
    X2, _ = design([xc, xc ** 2])
    r1, r2 = float(rss(X1, y)), float(rss(X2, y))
    df2 = n - 3
    if r2 <= 1e-12 * max(1.0, r1):
        return _res(*args, None, [], None, "caution", f"Linearity can't be tested for {label} (the points fit a "
                    "curve exactly).", sc)
    f = (r1 - r2) / (r2 / df2)
    p = float(stats.f.sf(f, 1, df2))
    if p >= alpha:
        return _res(*args, f, [1, df2], p, "passed", f"In {label} the covariate and outcome follow a roughly "
                    f"straight-line pattern ({_pp(p)}).", sc)
    return _res(*args, f, [1, df2], p, "failed", f"In {label} the covariate-outcome pattern bends ({_pp(p)}). "
                "A straight-line adjustment may not fit well there; check the scatterplot.", sc)


def residual_normality(resid: np.ndarray, label: str, alpha: float, chart_prefix: str = "resid") -> tuple[dict, dict]:
    """Shapiro-Wilk on model residuals (scope kind = residuals)."""
    res, charts = asm.shapiro_wilk(resid, asm.scope("overall", label), alpha, chart_prefix=chart_prefix)
    res = {**res, "applies_to": {**res["applies_to"], "kind": "residuals"},
           "explanation": res["explanation"].replace("the scores", f"the {label} (what the model leaves unexplained)")}
    return res, charts


def box_m(Y: np.ndarray, codes: np.ndarray, k: int, names: list[str]) -> dict:
    """Box's M test of equal covariance matrices (heplots::boxM chi-square approximation)."""
    n, p = Y.shape
    sc = asm.scope("overall", "all groups", None, n)
    args = ("equal_covariance_matrices", "Equal covariance matrices", "box_m", "Box's M", "χ²")
    ns = np.array([int(np.sum(codes == j)) for j in range(k)])
    covs = [np.cov(Y[codes == j], rowvar=False) if ns[j] > 1 else None for j in range(k)]
    small = [nm for nm, nj in zip(names, ns) if nj <= p]
    if small:
        return _res(*args, None, [], None, "caution", "Box's M needs more people than outcomes in every group; "
                    f"too few in: {', '.join(small)}.", sc)
    dets = [np.linalg.slogdet(c) for c in covs]
    pooled = sum((nj - 1) * c for nj, c in zip(ns, covs)) / (n - k)
    sp, ldp = np.linalg.slogdet(pooled)
    if sp <= 0 or any(s <= 0 for s, _ in dets):
        return _res(*args, None, [], None, "caution", "Box's M can't be computed because an outcome has no "
                    "spread (or is an exact combination of the others) in some group.", sc)
    m = (n - k) * ldp - sum((nj - 1) * ld for nj, (_, ld) in zip(ns, dets))
    c1 = (np.sum(1 / (ns - 1)) - 1 / (n - k)) * (2 * p * p + 3 * p - 1) / (6 * (p + 1) * (k - 1))
    x2 = float(m * (1 - c1))
    df = p * (p + 1) * (k - 1) / 2
    pv = float(stats.chi2.sf(x2, df))
    if pv >= BOX_M_ALPHA:
        return _res(*args, x2, [df], pv, "passed", "The outcomes vary and relate to each other in similar ways in "
                    f"every group ({_pp(pv)}; Box's M is judged at .001 because it flags tiny differences).", sc)
    return _res(*args, x2, [df], pv, "failed", f"The groups' covariance patterns differ ({_pp(pv)}, below the usual "
                ".001 cut-off for Box's M). Pillai's trace, the headline result, holds up best when this happens, "
                "especially with similar group sizes.", sc)


def mahalanobis(resid: np.ndarray, df_e: float) -> tuple[dict, np.ndarray]:
    """Multivariate outliers: D² of each residual vector with S = SSPE / df_error; chi-square cut-off p < .001."""
    n, p = resid.shape
    sc = asm.scope("residuals", "residuals", None, n)
    args = ("outliers", "Multivariate outliers", "mahalanobis", "Mahalanobis distance", "D²")
    S = resid.T @ resid / df_e
    d2 = np.einsum("ij,ij->i", resid @ np.linalg.pinv(S), resid)
    cut = float(stats.chi2.ppf(1 - OUTLIER_P, p))
    mx = float(np.max(d2))
    pv = float(stats.chi2.sf(mx, p))
    k = int(np.sum(d2 > cut))
    if k == 0:
        return _res(*args, mx, [p], pv, "passed", "No one's combination of scores is extreme (largest Mahalanobis "
                    f"distance {mx:.2f}, below the p < .001 cut-off of {cut:.2f}).", sc), d2
    return _res(*args, mx, [p], pv, "failed", f"{k} {'person has' if k == 1 else 'people have'} an unusual "
                f"combination of scores (Mahalanobis distance above {cut:.2f}, p < .001). Check them for data-entry "
                "errors; a few extreme cases can drive a MANOVA.", sc), d2


def outcome_correlations(Y: np.ndarray, names: list[str]) -> dict:
    """Largest |r| among the outcomes; above .9 the outcomes are nearly redundant."""
    n = Y.shape[0]
    sc = asm.scope("overall", "outcomes", None, n)
    args = ("multicollinearity", "Outcomes not too highly correlated", "outcome_correlations",
            "Largest correlation between outcomes", "r")
    with np.errstate(all="ignore"):
        r = np.corrcoef(Y, rowvar=False)
    iu = np.triu_indices(len(names), 1)
    vals = np.abs(r[iu])
    if not np.all(np.isfinite(vals)):
        return _res(*args, None, [], None, "caution", "An outcome has no spread, so correlations can't be checked.", sc)
    j = int(np.argmax(vals))
    a, b = names[iu[0][j]], names[iu[1][j]]
    mx = float(vals[j])
    if mx <= COLLINEAR_R:
        return _res(*args, mx, [], None, "passed", f"The most closely related outcomes are {a} and {b} "
                    f"(|r| = {mx:.2f}), below the .90 level where outcomes become redundant.", sc)
    return _res(*args, mx, [], None, "failed", f"{a} and {b} are almost the same measure (|r| = {mx:.2f} > .90). "
                "Consider combining them or dropping one; nearly redundant outcomes make MANOVA unstable.", sc)
