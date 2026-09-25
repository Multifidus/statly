"""Sphericity for one within-subjects factor (SPEC §8): Mauchly's test and the Greenhouse-Geisser and
Huynh-Feldt epsilon corrections, implemented in-house and matched to R car / afex (fixtures/r/anova.R).

With Y the n x k complete-case score matrix and C a k x (k - 1) orthonormal contrast matrix, the
contrast covariance is S = C' cov(Y) C (p = k - 1 columns). Every quantity below is invariant to
the choice of orthonormal C.

- Mauchly's W = det(S) / (tr(S) / p)^p, chi-square approximation with the second-order correction
  of stats::mauchly.test (used by car::Anova and afex): error df n_e = n - 1,
  rho = 1 - (2p² + p + 2) / (6 p n_e), z = -n_e rho log W, f = p(p + 1)/2 - 1,
  p-value = P1 + w2 (P2 - P1) with P1 = P(chi²_f > z), P2 = P(chi²_{f+4} > z),
  w2 = (p + 2)(p - 1)(p - 2)(2p³ + 6p² + 3p + 2) / (288 (n_e p rho)²).
- Greenhouse-Geisser epsilon = tr(S)² / (p tr(S²)), bounded in [1/p, 1].
- Huynh-Feldt epsilon, as car/afex compute it: ((n_e + 1) p GG - 2) / (p (n_e - p GG)). car's form
  is the Huynh-Feldt-Lecoutre correction (it uses N - g + 1 for g between-subject groups). With no
  between-subject factor (g = 1) it is identical to the original Huynh-Feldt (1976) formula that SPSS
  prints, so Statly, afex and SPSS agree here; they differ only in mixed designs. The raw value can
  exceed 1; like afex (and SPSS), the value used and reported is min(1, HF).
- With k = 2 there is one contrast, sphericity holds by definition: W = 1 and both epsilons = 1,
  and Mauchly's test is not run (as in car / afex / SPSS). It also cannot be run when n - 1 < p.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy import stats

from statly_engine.stats.apa import p_value


@dataclass(frozen=True)
class Sphericity:
    w: float | None          # Mauchly's W (None when not testable)
    chi2: float | None
    df: int | None
    p: float | None
    gg: float                # Greenhouse-Geisser epsilon
    hf: float                # Huynh-Feldt epsilon, capped at 1 (used for the correction)
    hf_raw: float            # uncapped Huynh-Feldt epsilon (car's value)


def orthonormal_contrasts(k: int) -> np.ndarray:
    """k x (k - 1) orthonormal contrasts (normalized Helmert), each column summing to 0."""
    c = np.zeros((k, k - 1))
    for j in range(1, k):
        c[:j, j - 1] = 1.0
        c[j, j - 1] = -float(j)
        c[:, j - 1] /= math.sqrt(j * (j + 1))
    return c


def epsilons(y: np.ndarray) -> tuple[float, float, float]:
    """(GG, HF capped at 1, HF raw) for an n x k complete-case matrix."""
    n, k = y.shape
    p = k - 1
    if p < 2:
        return 1.0, 1.0, 1.0
    c = orthonormal_contrasts(k)
    s = c.T @ np.cov(y, rowvar=False, ddof=1) @ c
    tr = float(np.trace(s))
    tr2 = float(np.trace(s @ s))
    if not (tr > 0 and tr2 > 0):
        return float("nan"), float("nan"), float("nan")
    gg = tr * tr / (p * tr2)
    n_e = n - 1
    denom = p * (n_e - p * gg)
    hf_raw = ((n_e + 1) * p * gg - 2) / denom if denom != 0 else float("nan")
    return gg, (min(1.0, hf_raw) if math.isfinite(hf_raw) else float("nan")), hf_raw


def mauchly(y: np.ndarray) -> tuple[float, float, int, float] | None:
    """(W, chi2, df, p) as stats::mauchly.test / car / afex; None when k < 3 or n - 1 < k - 1."""
    n, k = y.shape
    p = k - 1
    n_e = n - 1
    if p < 2 or n_e < p:
        return None
    c = orthonormal_contrasts(k)
    s = c.T @ np.cov(y, rowvar=False, ddof=1) @ c
    tr = float(np.trace(s))
    if not tr > 0:
        return None
    sign, logdet = np.linalg.slogdet(s)
    if sign <= 0:
        return 0.0, math.inf, p * (p + 1) // 2 - 1, 0.0
    log_w = logdet - p * math.log(tr / p)
    rho = 1 - (2 * p * p + p + 2) / (6 * p * n_e)
    w2 = (p + 2) * (p - 1) * (p - 2) * (2 * p ** 3 + 6 * p * p + 3 * p + 2) / (288 * (n_e * p * rho) ** 2)
    z = -n_e * rho * log_w
    f = p * (p + 1) // 2 - 1
    pr1 = stats.chi2.sf(z, f)
    pr2 = stats.chi2.sf(z, f + 4)
    return math.exp(log_w), z, f, float(min(1.0, max(0.0, pr1 + w2 * (pr2 - pr1))))


def sphericity(y: np.ndarray) -> Sphericity:
    gg, hf, hf_raw = epsilons(y)
    m = mauchly(y)
    if m is None:
        return Sphericity(None, None, None, None, gg, hf, hf_raw)
    return Sphericity(m[0], m[1], m[2], m[3], gg, hf, hf_raw)


def assumption(sph: Sphericity, k: int, n: int, alpha: float, correction: str) -> dict:
    """AssumptionResult for Mauchly's test. `correction` is the one used for the headline F."""
    sc = {"kind": "overall", "label": "all time points", "group": None, "n": n}
    base = {"schema_version": 1, "assumption": "sphericity", "label": "Sphericity",
            "test_used": {"key": "mauchly", "label": "Mauchly's test"}, "applies_to": sc, "chart_refs": []}
    eps = (f" The Greenhouse-Geisser epsilon is {_eps(sph.gg)} and the Huynh-Feldt epsilon is {_eps(sph.hf)} "
           "(1 means no correction is needed).")
    if k < 3:
        return {**base, "statistic": None, "p": None, "verdict": "passed",
                "explanation": "With only two time points, sphericity always holds, so there is nothing to test."}
    if sph.w is None:
        return {**base, "statistic": None, "p": None, "verdict": "caution",
                "explanation": ("Mauchly's test needs more people than time points, so sphericity can't be "
                                "tested here. The Greenhouse-Geisser corrected result is the safer one to report."
                                + eps)}
    ptxt = p_value(sph.p)
    ptxt = f"p {ptxt}" if ptxt[0] in "<>" else f"p = {ptxt}"
    stat = {"symbol": "W", "value": float(sph.w), "df": [float(sph.df)]}
    if sph.p >= alpha:
        text = ("Mauchly's test found no clear sign that the differences between time points vary unevenly "
                f"({ptxt}), so sphericity looks reasonable and the uncorrected F test can be used." + eps)
        verdict = "passed"
    else:
        used = {"gg": "Greenhouse-Geisser", "hf": "Huynh-Feldt"}.get(correction)
        text = (f"Mauchly's test suggests the differences between time points vary unevenly ({ptxt}). This "
                "makes the uncorrected F test too likely to find an effect, so the degrees of freedom are "
                "adjusted" + (f" (the {used} correction is used)." if used else
                              ". You chose the uncorrected test; the corrected results are also shown.") + eps)
        verdict = "failed"
    return {**base, "statistic": stat, "p": float(sph.p), "verdict": verdict, "explanation": text}


def _eps(v: float) -> str:
    return "not available" if not math.isfinite(v) else f"{v:.2f}".lstrip("0") if v < 1 else f"{v:.2f}"
