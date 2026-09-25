"""ANOVA effect sizes (SPEC §8): eta², partial eta², generalized eta², omega², Cohen's f, with CIs.

Matched to R effectsize 1.0 (`eta_squared`, `omega_squared`, `cohens_f`, `F_to_eta2`, ...) called with
``ci = .95, alternative = "two.sided"``. SPEC §8 asks for 95% CIs, so Statly reports a two-sided
interval at the request's ci_level. (effectsize's own default for this family is a one-sided
"greater" interval, i.e. the lower bound of a two-sided 90% interval with the upper bound fixed at 1;
`effect_sizes.partial_pve` reproduces that default if it is ever needed.)

CI convention (effectsize:::.es_aov_simple / .es_aov_strata): whatever the estimate (eta², partial
eta², generalized eta², omega²), its interval is built from the F that the *estimate* implies,
``F* = (ES / df1) / ((1 - ES) / df2)``, by inverting the noncentral F (`effect_sizes.ncf_ci`) and mapping
the noncentrality bounds back as ``lambda / (lambda + df2)``. Cohen's f = sqrt(ES / (1 - ES)) and its
bounds are the same transform of the eta² bounds. df1 / df2 are the effect and error df of the
term (the uncorrected df for repeated measures, as effectsize uses).
"""

from __future__ import annotations

import math

from statly_engine.stats.effect_sizes import TWO_SIDED, Estimate, adjust_level, ncf_ci


def _clean(x):
    return float(x) if x is not None and math.isfinite(x) else None


def pve_ci(value: float | None, df1: float, df2: float, level: float = 0.95,
           alternative: str = TWO_SIDED) -> Estimate:
    """A proportion-of-variance estimate with effectsize's noncentral-F CI (see module docstring)."""
    if value is None or not math.isfinite(value) or not (df1 > 0 and df2 > 0):
        return Estimate(None, None, None, level)
    v = max(0.0, value)
    if v >= 1:
        return Estimate(float(value), None, None, level)
    f_star = (v / df1) / ((1 - v) / df2)
    lam_lo, lam_hi = ncf_ci(f_star, df1, df2, adjust_level(level, alternative))
    lo, hi = lam_lo / (lam_lo + df2), lam_hi / (lam_hi + df2)
    if alternative == "greater":
        hi = 1.0
    elif alternative == "less":
        lo = 0.0
    return Estimate(float(value), _clean(lo), _clean(hi), level)


def cohens_f(eta: Estimate) -> Estimate:
    """Cohen's f = sqrt(eta² / (1 - eta²)) with the eta² CI transformed (effectsize::cohens_f)."""
    def tf(e):
        if e is None:
            return None
        return math.inf if e >= 1 else math.sqrt(max(0.0, e) / (1 - e))
    return Estimate(_clean(tf(eta.value)), _clean(tf(eta.lower)), _clean(tf(eta.upper)), eta.level)


def one_way(ss_between: float, ss_within: float, df1: float, df2: float, level: float = 0.95) -> dict[str, Estimate]:
    """Between-subjects one-way design (effectsize::eta_squared / omega_squared(partial = FALSE)).

    eta² = SS_b / SS_total (equal to partial eta² with one factor);
    omega² = max(0, (SS_b - df_b MS_w) / (SS_total + MS_w)); Cohen's f from eta².
    """
    ss_t = ss_between + ss_within
    if not (ss_t > 0 and df2 > 0):
        none = Estimate(None, None, None, level)
        return {"eta_sq": none, "omega_sq": none, "cohens_f": none}
    ms_w = ss_within / df2
    eta = pve_ci(ss_between / ss_t, df1, df2, level)
    omega = pve_ci(max(0.0, (ss_between - df1 * ms_w) / (ss_t + ms_w)), df1, df2, level)
    return {"eta_sq": eta, "omega_sq": omega, "cohens_f": cohens_f(eta)}


def from_f(f: float | None, df1: float, df2: float, level: float = 0.95) -> dict[str, Estimate]:
    """From a test statistic (effectsize::F_to_eta2 / F_to_omega2 / F_to_f), e.g. Welch's F.

    eta² = F df1 / (F df1 + df2); omega² = max(0, (F - 1) df1 / (F df1 + df2 + 1)).
    """
    if f is None or not math.isfinite(f) or df2 is None or not math.isfinite(df2):
        none = Estimate(None, None, None, level)
        return {"eta_sq": none, "omega_sq": none, "cohens_f": none}
    eta = pve_ci(f * df1 / (f * df1 + df2), df1, df2, level)
    omega = pve_ci(max(0.0, (f - 1) * df1 / (f * df1 + df2 + 1)), df1, df2, level)
    return {"eta_sq": eta, "omega_sq": omega, "cohens_f": cohens_f(eta)}


def repeated_measures(ss_effect: float, ss_subjects: float, ss_error: float, df1: float, df2: float,
                      n_subjects: int, level: float = 0.95) -> dict[str, Estimate]:
    """One within-subjects factor (effectsize on an afex::aov_ez model; afex's `ges`).

    partial eta² = SS_A / (SS_A + SS_err)                       (SPSS "partial eta squared")
    generalized eta² = SS_A / (SS_A + SS_subjects + SS_err)     (Olejnik & Algina 2003; afex ges;
                                                                 equals plain eta² here)
    partial omega² = max(0, (SS_A - df_A MS_err) / (SS_A + SS_err + SS_subjects + MS_subjects))
    Cohen's f from partial eta². All CIs use df1 = k - 1, df2 = (n - 1)(k - 1).
    """
    none = Estimate(None, None, None, level)
    if not (ss_effect + ss_error > 0 and df2 > 0 and n_subjects > 1):
        return {"partial_eta_sq": none, "generalized_eta_sq": none, "omega_sq": none, "cohens_f": none}
    ms_err = ss_error / df2
    ms_subj = ss_subjects / (n_subjects - 1)
    pes = pve_ci(ss_effect / (ss_effect + ss_error), df1, df2, level)
    ges = pve_ci(ss_effect / (ss_effect + ss_subjects + ss_error), df1, df2, level)
    omega = pve_ci(max(0.0, (ss_effect - df1 * ms_err) / (ss_effect + ss_error + ss_subjects + ms_subj)),
                   df1, df2, level)
    return {"partial_eta_sq": pes, "generalized_eta_sq": ges, "omega_sq": omega, "cohens_f": cohens_f(pes)}
