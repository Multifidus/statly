"""Regression assumption checks (SPEC §7.2, §8). Each returns ``(AssumptionResult dict, chart_data dict)``.

R references (fixtures/r/regression.R):
- Residual normality: Shapiro-Wilk on the raw residuals (shapiro.test(residuals(m))) + residual Q-Q.
- Linearity: Ramsey's RESET, lmtest::resettest(m, power = 2:3, type = "fitted"): F for adding fitted² and
  fitted³. Chart: residuals vs fitted.
- Homoscedasticity: studentized (Koenker) Breusch-Pagan, lmtest::bptest(m) default: n R² of e² on the
  predictors, chi² on p - 1 df.
- Multicollinearity: car::vif (GVIF for multi-column terms). Statistic = the largest GVIF^(1/Df) (i.e.
  (GVIF^(1/(2 Df)))², equal to the VIF for one-column terms): < 5 passed, 5-10 caution, >= 10 failed.
- Influential cases: Cook's distance (stats::cooks.distance for lm and glm), cutoff 4/n. Statistic = the
  largest D: none above 4/n passed; some above 4/n caution; any above 1 failed.
- Hosmer-Lemeshow (logistic): ResourceSelection::hoslem.test(y, fitted, g = 10): type-7 decile breaks
  (duplicates removed), df = occupied groups - 2.
- Brant (ordinal): brant::brant(polr): separate binary logits per cut-point, omnibus Wald chi² on (J-2)K df
  plus one test per coefficient on J-2 df.
"""

from __future__ import annotations

import math

import numpy as np
from scipy import stats

from statly_engine.stats import assumptions as asm
from statly_engine.stats.apa import p_value

VIF_CAUTION = 5.0
VIF_FAILED = 10.0
RESID_VS_FITTED = "residuals_vs_fitted"


def _ptxt(p) -> str:
    s = p_value(p)
    return f"p {s}" if s[0] in "<>" else f"p = {s}"


def _res(assumption, label, key, test_label, symbol, value, df, p, verdict, text, n, refs,
         scope_kind="residuals", scope_label="Residuals") -> dict:
    stat = None if value is None or not math.isfinite(value) else {"symbol": symbol, "value": float(value),
                                                                  "df": [float(x) for x in df]}
    return {"schema_version": 1, "assumption": assumption, "label": label,
            "test_used": {"key": key, "label": test_label}, "statistic": stat,
            "p": None if p is None or not math.isfinite(p) else float(min(max(p, 0.0), 1.0)),
            "verdict": verdict, "explanation": text,
            "applies_to": {"kind": scope_kind, "label": scope_label, "group": None, "n": int(n)}, "chart_refs": refs}


RVF_REF = {"chart_type": "scatter", "title": "Residuals vs predicted values", "data_key": RESID_VS_FITTED}


def residual_normality(resid, alpha: float = 0.05) -> tuple[dict, dict]:
    res, charts = asm.shapiro_wilk(resid, asm.scope("residuals", "Residuals"), alpha, chart_prefix="residuals")
    res["assumption"], res["label"] = "normality_of_residuals", "Normality of residuals"
    p, n = res["p"], res["applies_to"]["n"]
    if p is not None:
        if res["verdict"] == "passed":
            res["explanation"] = (f"The prediction errors (residuals) look roughly bell-shaped ({_ptxt(p)}), so "
                                  "the p-values and confidence intervals can be trusted.")
        elif res["verdict"] == "caution":
            res["explanation"] = (f"The residuals are not perfectly bell-shaped ({_ptxt(p)}), but with {n} people "
                                  "this test flags tiny differences and regression holds up well. Check the Q-Q plot.")
        else:
            res["explanation"] = (f"The residuals are not bell-shaped ({_ptxt(p)}). With a sample this size the "
                                  "p-values and confidence intervals may be off. Check the Q-Q plot for outliers or "
                                  "a skewed outcome.")
    return res, charts


def linearity_reset(y, X, fitted, alpha: float = 0.05) -> tuple[dict, dict]:
    """Ramsey RESET (lmtest::resettest, power 2:3, type fitted)."""
    n, p = X.shape
    args = ("linearity", "Linearity", "reset", "Ramsey RESET", "F")
    Z = np.column_stack([X, fitted ** 2, fitted ** 3])
    s = np.linalg.svd(Z / np.sqrt((Z ** 2).sum(0)), compute_uv=False)
    if n - p - 2 <= 0 or s[-1] < 1e-7 * s[0]:
        return _res(*args, None, [], None, "caution",
                    "This check can't be run for this model (too few people, or the predicted values take only a "
                    "few distinct values). Look at the residuals-vs-predicted plot instead: the dots should show "
                    "no curve.", n, [RVF_REF]), {}
    rss0 = float(((y - fitted) ** 2).sum())
    beta = np.linalg.lstsq(Z, y, rcond=None)[0]
    rss1 = float(((y - Z @ beta) ** 2).sum())
    df2 = n - p - 2
    f = ((rss0 - rss1) / 2) / (rss1 / df2)
    pv = float(stats.f.sf(f, 2, df2))
    if pv >= alpha:
        v, t = "passed", (f"There is no clear sign of a curved relationship ({_ptxt(pv)}): a straight-line model "
                          "fits. The residuals-vs-predicted plot should show a flat, even band.")
    else:
        v, t = "failed", (f"The relationship looks curved rather than straight ({_ptxt(pv)}). Look at the "
                          "residuals-vs-predicted plot; a transformed or squared predictor may fit better.")
    return _res(*args, f, [2, df2], pv, v, t, n, [RVF_REF]), {}


def homoscedasticity_bp(resid, X, alpha: float = 0.05) -> tuple[dict, dict]:
    """Studentized Breusch-Pagan (lmtest::bptest default)."""
    n, p = X.shape
    e2 = resid ** 2
    beta = np.linalg.lstsq(X, e2, rcond=None)[0]
    fit = X @ beta
    tss = float(((e2 - e2.mean()) ** 2).sum())
    args = ("homoscedasticity", "Equal spread of residuals (homoscedasticity)", "breusch_pagan",
            "Breusch-Pagan (studentized)", "χ²")
    if tss <= 0 or p < 2:
        return _res(*args, None, [], None, "caution", "This check can't be run for this model.", n, [RVF_REF]), {}
    r2 = 1 - float(((e2 - fit) ** 2).sum()) / tss
    bp = n * r2
    pv = float(stats.chi2.sf(bp, p - 1))
    if pv >= alpha:
        v, t = "passed", (f"The prediction errors are spread out by similar amounts at every predicted value "
                          f"({_ptxt(pv)}), so this assumption looks reasonable.")
    else:
        v, t = "failed", (f"The prediction errors are more spread out for some predicted values than others "
                          f"({_ptxt(pv)}). The coefficients are still fine, but their p-values and confidence "
                          "intervals may be too optimistic.")
    return _res(*args, bp, [p - 1], pv, v, t, n, [RVF_REF]), {}


def multicollinearity(vif: list[dict], n: int) -> tuple[dict, dict] | None:
    if not vif:
        return None
    worst = max(vif, key=lambda r: r["gvif_adj"])
    s = worst["gvif_adj"] ** 2
    args = ("multicollinearity", "Multicollinearity", "vif", "Variance inflation factor (VIF)", "VIF")
    if s < VIF_CAUTION:
        v, t = "passed", (f"The predictors don't overlap too much (largest VIF = {s:.2f}, for {worst['term']}; "
                          f"values under {VIF_CAUTION:g} are fine).")
    elif s < VIF_FAILED:
        v, t = "caution", (f"{worst['term']} overlaps quite a lot with the other predictors (VIF = {s:.2f}). Its "
                           "coefficient is less precise; consider whether both overlapping predictors are needed.")
    else:
        v, t = "failed", (f"{worst['term']} overlaps heavily with the other predictors (VIF = {s:.2f}, "
                          f"{VIF_FAILED:g} or more). The separate coefficients are unstable: drop or combine "
                          "the overlapping predictors.")
    return _res(*args, s, [], None, v, t, n, [], "overall", "Predictors"), {}


def cooks_records(cooks, rows) -> list[dict]:
    n = len(cooks)
    return [{"case": r, "cooks_d": float(c), "influential": bool(c > 4 / n)} for r, c in zip(rows, cooks)]


def influential_cases(cooks, rows, alpha: float = 0.05) -> tuple[dict, dict]:
    cooks = np.asarray(cooks, float)
    n = len(cooks)
    over = int((cooks > 4 / n).sum())
    mx = float(np.nanmax(cooks))
    refs = [{"chart_type": "bar", "title": "Cook's distance for each person", "data_key": "cooks_distance"}]
    args = ("influential_cases", "Influential cases", "cooks_distance", "Cook's distance (cutoff 4/n)", "D")
    if over == 0:
        v, t = "passed", f"No single person has an outsized influence on the results (largest Cook's D = {mx:.2f})."
    elif mx <= 1:
        v, t = "caution", (f"{over} {'person has' if over == 1 else 'people have'} more influence than usual "
                           f"(Cook's D above 4/n = {4 / n:.3f}; largest = {mx:.2f}). None is extreme (above 1), "
                           "but check that their data were entered correctly.")
    else:
        v, t = "failed", (f"At least one person strongly changes the results on their own (Cook's D = {mx:.2f}, "
                          "above 1). Check their data, and see whether the conclusions change without them.")
    return _res(*args, mx, [], None, v, t, n, refs, "overall", "All cases"), {"cooks_distance": cooks_records(cooks, rows)}


def hosmer_lemeshow(y, fitted, alpha: float = 0.05, g: int = 10) -> tuple[dict, dict]:
    """ResourceSelection::hoslem.test(y, fitted, g)."""
    y = np.asarray(y, float)
    fitted = np.asarray(fitted, float)
    n = len(y)
    qq = np.unique(np.quantile(fitted, np.linspace(0, 1, g + 1)))
    args = ("goodness_of_fit", "Model fit (Hosmer-Lemeshow)", "hosmer_lemeshow", "Hosmer-Lemeshow", "χ²")
    if len(qq) < 3:
        return _res(*args, None, [], None, "caution", "The predicted probabilities take too few distinct values "
                    "for this check.", n, [], "overall", "Model"), {}
    # cut(include.lowest = TRUE, right = TRUE): bin i = (qq[i-1], qq[i]], first bin closed
    bins = np.searchsorted(qq, fitted, side="left")
    bins[bins == 0] = 1
    chi, groups, recs = 0.0, 0, []
    for k in range(1, len(qq)):
        m = bins == k
        if not m.any():
            continue
        groups += 1
        o1, e1 = y[m].sum(), fitted[m].sum()
        o0, e0 = m.sum() - o1, m.sum() - e1
        chi += (o1 - e1) ** 2 / e1 + (o0 - e0) ** 2 / e0
        recs.append({"group": groups, "n": int(m.sum()), "observed": float(o1), "expected": float(e1)})
    df = groups - 2
    pv = float(stats.chi2.sf(chi, df)) if df > 0 else float("nan")
    if not math.isfinite(pv):
        return _res(*args, None, [], None, "caution", "Too few groups for this check.", n, [], "overall", "Model"), {}
    if pv >= alpha:
        v, t = "passed", (f"The predicted chances match the observed outcomes well across the range ({_ptxt(pv)}).")
    else:
        v, t = "failed", (f"The predicted chances don't match the observed outcomes well in some groups "
                          f"({_ptxt(pv)}). The model may be missing a predictor or a curved relationship.")
    return _res(*args, chi, [df], pv, v, t, n, [], "overall", "Model"), {"hosmer_lemeshow": recs}


def brant(X: np.ndarray, y: np.ndarray, J: int, terms: list[str], alpha: float = 0.05) -> tuple[dict, dict]:
    """brant::brant(polr): X without intercept (n x K), y ordinal codes 0..J-1."""
    from statly_engine.stats.regression_logistic import fit_logit  # local: avoid an import cycle

    n, K = X.shape
    X1 = np.column_stack([np.ones(n), X])
    args = ("proportional_odds", "Proportional odds (parallel lines)", "brant", "Brant test", "χ²")
    betas, vcovs, pis = [], [], []
    for m in range(J - 1):
        z = (y > m).astype(float)
        f = fit_logit(X1, z)
        betas.append(f["coef"][1:])
        vcovs.append(f["vcov"])
        pis.append(f["mu"])
    V = np.zeros(((J - 1) * K, (J - 1) * K))
    for m in range(J - 1):
        V[m * K:(m + 1) * K, m * K:(m + 1) * K] = vcovs[m][1:, 1:]
        for l in range(m + 1, J - 1):
            wm = pis[m] * (1 - pis[m])
            wl = pis[l] * (1 - pis[l])
            wml = pis[l] - pis[m] * pis[l]
            blk = (np.linalg.inv(X1.T @ (X1 * wm[:, None])) @ (X1.T @ (X1 * wml[:, None]))
                   @ np.linalg.inv(X1.T @ (X1 * wl[:, None])))[1:, 1:]
            V[m * K:(m + 1) * K, l * K:(l + 1) * K] = blk
            V[l * K:(l + 1) * K, m * K:(m + 1) * K] = blk
    bstar = np.concatenate(betas)
    D = np.zeros(((J - 2) * K, (J - 1) * K))
    for i in range(J - 2):
        D[i * K:(i + 1) * K, 0:K] = np.eye(K)
        D[i * K:(i + 1) * K, (i + 1) * K:(i + 2) * K] = -np.eye(K)

    def wald(Dm, idx):
        Dm = Dm[~np.all(Dm == 0, axis=1)]
        v = Dm @ bstar[idx]
        return float(v @ np.linalg.solve(Dm @ V[np.ix_(idx, idx)] @ Dm.T, v))

    allidx = np.arange((J - 1) * K)
    x2 = wald(D, allidx)
    df = (J - 2) * K
    recs = [{"term": "Omnibus", "statistic": x2, "df": float(df), "p": float(stats.chi2.sf(x2, df))}]
    for k in range(K):
        s = np.arange(k, (J - 1) * K, K)
        xk = wald(D[:, s], s)
        recs.append({"term": terms[k], "statistic": xk, "df": float(J - 2), "p": float(stats.chi2.sf(xk, J - 2))})
    pv = recs[0]["p"]
    if pv >= alpha:
        v, t = "passed", (f"Each predictor seems to have the same effect at every step of the outcome scale "
                          f"({_ptxt(pv)}), as this model assumes.")
    else:
        bad = [r["term"] for r in recs[1:] if r["p"] < alpha]
        v, t = "failed", (f"The effect of at least one predictor differs across the steps of the outcome scale "
                          f"({_ptxt(pv)}{'; ' + ', '.join(bad) if bad else ''}). The single odds ratio is an "
                          "average; consider separate logistic regressions or a multinomial model.")
    return _res(*args, x2, [df], pv, v, t, n, [], "overall", "Model"), {"brant": recs}
