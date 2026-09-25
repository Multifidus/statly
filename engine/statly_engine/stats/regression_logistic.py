"""Binary logistic and ordinal (proportional-odds) regression (SPEC §8). Reference: fixtures/r/regression.R.

Conventions (see also stats/README.md, "Regression"):
- Design, complete cases and dummy coding as regression.py.
- regression.logistic = glm(family = binomial). The outcome must have exactly two values; the modelled
  event is the second level (value-label order, else sorted: 1 for 0/1) or options.event. Fitted by IRLS
  exactly as glm.fit (R's logit link clamps at |eta| > 30), converged to |Δdeviance| / (|dev| + 0.1) < 1e-12.
  Wald z and p (summary.glm); odds ratios with profile-likelihood CIs (what confint() profiles), found as the
  exact roots of dev(b fixed) - dev_min = qchisq(level, 1) rather than R's spline interpolation. Model chi²
  = null deviance - deviance on k df; Cox-Snell R² = 1 - exp(-chi²/n); Nagelkerke = CS / (1 - exp(-null dev/n)).
  Classification table at p >= .5. Hosmer-Lemeshow (g = 10), VIF and Cook's distance as assumptions.
  Separation: when fitted probabilities reach 0 or 1 (within 1e-8) or IRLS does not converge, the estimates are
  still reported but flagged with a serious `perfect_separation` warning and CIs that can't be found are null.
- regression.ordinal = MASS::polr(method = "logistic", Hess = TRUE): logit P(Y <= j) = zeta_j - x'b, so a positive
  b means higher categories. Fitted by Newton-Raphson with the analytic Hessian (polr's optim result refined to
  reltol 1e-14 in the fixtures). SEs = the inverse Hessian (vcov.polr); p-values use the normal approximation to
  t = b / SE (summary.polr prints t without p; this is the usual choice, e.g. SPSS PLUM's Wald test). ORs with exact
  profile-likelihood CIs; thresholds with SEs; model chi² vs the thresholds-only model; pseudo-R² as logistic.
  Brant test of proportional odds (brant::brant) and VIF as assumptions. Requires 3+ outcome levels.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy import optimize, stats
from scipy.special import expit

from statly_engine.errors import InvalidParams
from statly_engine.stats import apa, prep
from statly_engine.stats import assumptions_regression as areg
from statly_engine.stats.apa import Rich
from statly_engine.stats.core import ResultBuilder, finite, missing_warning, warning
from statly_engine.stats.effect_sizes import Estimate
from statly_engine.stats.registry import Role, register
from statly_engine.stats.regression import (PRED_OPTIONS, Design, build_design, cases_per_predictor_warning,
                                            check_rank, dummy_coding, factor_note, gvif, p_phrase,
                                            predictor_descriptives, require_two_sided, vif_warning)

EPS = np.finfo(float).eps
THRESH = 30.0
SEPARATION_P = 1e-8
TOL = 1e-12
OR = Rich().i("OR")


# ---------------------------------------------------------------------------
# Binary logit (glm.fit, binomial / logit)
# ---------------------------------------------------------------------------
def _linkinv(eta):
    tmp = np.where(eta < -THRESH, EPS, np.where(eta > THRESH, 1 / EPS, np.exp(np.clip(eta, -THRESH, THRESH))))
    return tmp / (1 + tmp)


def _mu_eta(eta):
    opexp = 1 + np.exp(np.clip(eta, -THRESH, THRESH))
    return np.where(np.abs(eta) > THRESH, EPS, (opexp - 1) / opexp ** 2)


def _binom_dev(y, mu) -> float:
    with np.errstate(divide="ignore", invalid="ignore"):
        t = np.where(y > 0, np.log(mu), np.log1p(-mu))
    return float(-2 * t.sum())


def fit_logit(X: np.ndarray, y: np.ndarray, offset: np.ndarray | None = None, maxit: int = 100,
              tol: float = TOL, start: np.ndarray | None = None) -> dict:
    """IRLS as stats::glm.fit(family = binomial()) with control epsilon = tol."""
    n, p = X.shape
    off = np.zeros(n) if offset is None else offset
    if start is not None and p:
        eta = X @ start + off
    else:
        eta = np.log(((y + 0.5) / 2) / (1 - (y + 0.5) / 2))
    mu = _linkinv(eta)
    dev_old = _binom_dev(y, mu)
    coef = np.zeros(p)
    converged = False
    for it in range(1, maxit + 1):
        me = _mu_eta(eta)
        var = mu * (1 - mu)
        z = (eta - off) + (y - mu) / me
        w = np.sqrt(me ** 2 / var)
        if p:
            coef = np.linalg.lstsq(X * w[:, None], z * w, rcond=None)[0]
            eta = X @ coef + off
        else:
            eta = off.copy()
        mu = _linkinv(eta)
        dev = _binom_dev(y, mu)
        if abs(dev - dev_old) / (abs(dev) + 0.1) < tol:
            converged = True
            break
        dev_old = dev
    wt = mu * (1 - mu)
    vcov = np.linalg.inv(X.T @ (X * wt[:, None])) if p else np.zeros((0, 0))
    return {"coef": coef, "vcov": vcov, "mu": mu, "eta": eta, "deviance": dev, "converged": converged, "iter": it}


def profile_ci(dev_at, b: float, se: float, dev0: float, level: float) -> tuple[float | None, float | None]:
    """Exact profile-likelihood bounds: dev_at(v) - dev0 = qchisq(level, 1) on each side of b."""
    crit = stats.chi2.ppf(level, 1)

    def f(v):
        return dev_at(v) - dev0 - crit

    out = []
    for sign in (-1, 1):
        step = 2 * se if finite(se) and se > 0 else 1.0
        far = b + sign * step
        found = False
        for _ in range(12):
            val = f(far)
            if math.isfinite(val) and val > 0:
                found = True
                break
            step *= 2
            far = b + sign * step
        if not found:
            out.append(None)
            continue
        lo, hi = (far, b) if sign < 0 else (b, far)
        out.append(float(optimize.brentq(f, lo, hi, xtol=1e-11, rtol=1e-13, maxiter=500)))
    return out[0], out[1]


def _cooks_glm(X, y, mu):
    w = mu * (1 - mu)
    Xw = X * np.sqrt(w)[:, None]
    h = np.einsum("ij,jk,ik->i", Xw, np.linalg.inv(Xw.T @ Xw), Xw)
    pr = (y - mu) / np.sqrt(w)
    return (pr / (1 - h)) ** 2 * h / X.shape[1]


def _pseudo_r2(chi2: float, null_dev: float, n: int) -> tuple[float, float]:
    cs = 1 - math.exp(-chi2 / n)
    return cs, cs / (1 - math.exp(-null_dev / n))


def _case_rows(d: Design) -> list:
    return [int(i) + 1 if isinstance(i, (int, np.integer)) else str(i) for i in d.index]


def _or_table(title, rows_data, level, note, thresholds=None, stat_symbol="z") -> dict:
    cols = [apa.column("term", "Predictor", "left"), apa.column("b", Rich().i("B")), apa.column("se", Rich().i("SE")),
            apa.column("z", Rich().i(stat_symbol)), apa.column("p", Rich().i("p")), apa.column("or", OR),
            apa.column("ci", Rich().t(f"{apa.level_text(level)} CI for ").i("OR"))]
    rows = []
    for r in rows_data:
        is_int = r["term"] == "(Intercept)"
        rows.append(apa.row([apa.cell_text(r["label"]), apa.cell_num(r["estimate"]), apa.cell_num(r["se"]),
                             apa.cell_num(r["statistic"]), apa.cell_p(r["p"]),
                             apa.cell_empty() if is_int else apa.cell_num(r["or"]),
                             apa.cell_empty() if is_int else apa.cell_ci(r["or_ci_lower"], r["or_ci_upper"])]))
    if thresholds:
        rows.append(apa.row([apa.cell_text("Thresholds")] + [apa.cell_empty()] * 6, kind="section_header"))
        for t in thresholds:
            rows.append(apa.row([apa.cell_text(t["label"]), apa.cell_num(t["estimate"]), apa.cell_num(t["se"]),
                                 apa.cell_num(t["statistic"]), apa.cell_empty(), apa.cell_empty(), apa.cell_empty()],
                                indent=1))
    return apa.table(title, cols, rows, general_note=note)


def _or_phrase(recs, alpha, outcome_phrase) -> str:
    sig = [r for r in recs if r["term"] != "(Intercept)" and r["p"] < alpha and finite(r["or"])]
    if not sig:
        return " None of the predictors had a clear effect of its own once the others were taken into account."
    parts = []
    for r in sig[:3]:
        o = r["or"]
        word = "raised" if o > 1 else "lowered"
        parts.append(f"{r['label']} {word} the odds of {outcome_phrase} (odds ratio {o:.2f})")
    return " " + "; ".join(parts) + "."


def _coef_rows(d: Design, cols_idx, coef, se, dev_at, dev0, level, zkey="z"):
    recs = []
    for i, j in enumerate(cols_idx):
        z = coef[i] / se[i]
        lo, hi = profile_ci(dev_at(i), coef[i], se[i], dev0, level)
        recs.append({"term": d.terms[j], "label": d.labels[j], "estimate": float(coef[i]), "se": float(se[i]),
                     "statistic": float(z), "p": float(2 * stats.norm.sf(abs(z))), "ci_lower": lo, "ci_upper": hi,
                     "or": float(math.exp(coef[i])) if abs(coef[i]) < 700 else None,
                     "or_ci_lower": math.exp(lo) if lo is not None and abs(lo) < 700 else None,
                     "or_ci_upper": math.exp(hi) if hi is not None and abs(hi) < 700 else None})
    return recs


# ---------------------------------------------------------------------------
# regression.logistic
# ---------------------------------------------------------------------------
@register("regression.logistic", label="Binary logistic regression",
          roles=[Role("outcome", 1, 1, "Yes/no outcome (exactly two values)"),
                 Role("predictors", 1, None, "Predictors (numbers, or categories that are dummy coded)")],
          options={**PRED_OPTIONS, "event": "The outcome value whose odds are modelled. Default: the second value "
                                            "(e.g. 1 for 0/1)."})
def logistic(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    require_two_sided(request, "Logistic regression")
    level, alpha = request.ci_level, request.alpha
    d = build_design(df, request, meta, request.variables["outcome"][0], list(request.variables["predictors"]),
                     "binary")
    if len(d.outcome_levels) != 2:
        raise InvalidParams(f"Logistic regression needs an outcome with exactly two values; '{d.outcome_label}' has "
                            f"{len(d.outcome_levels)} among the people analysed. Use ordinal regression for ordered "
                            "categories.")
    ev = request.options.get("event") if request.options else None
    ev_idx = 1
    if ev is not None:
        hits = [k for k, lv in enumerate(d.outcome_levels) if prep._same(ev, lv)]
        if not hits:
            raise InvalidParams(f"'{d.outcome_label}' has no rows with the value {ev!r}.")
        ev_idx = hits[0]
    y = (d.y == ev_idx).astype(float)
    ev_label = d.outcome_level_labels[ev_idx]
    other_label = d.outcome_level_labels[1 - ev_idx]
    check_rank(d)
    X = d.X
    n, p = X.shape
    fit = fit_logit(X, y)
    coef, vcov, mu = fit["coef"], fit["vcov"], fit["mu"]
    se = np.sqrt(np.diag(vcov))
    separated = (not fit["converged"]) or bool(np.any(mu < SEPARATION_P) or np.any(mu > 1 - SEPARATION_P))
    dev0 = fit["deviance"]
    null_dev = fit_logit(X[:, :1], y)["deviance"]

    def dev_at(i):
        keep = [k for k in range(p) if k != i]

        def g(v):  # default (y-based) start, as glm.fit: warm starts can diverge far from the MLE
            return fit_logit(X[:, keep], y, offset=v * X[:, i])["deviance"]
        return g

    if separated:
        recs = _coef_rows(d, range(p), coef, se, lambda i: (lambda v: math.nan), dev0, level)
    else:
        recs = _coef_rows(d, range(p), coef, se, dev_at, dev0, level)
    chi2 = null_dev - dev0
    df_m = p - 1
    p_m = float(stats.chi2.sf(chi2, df_m))
    cs, nk = _pseudo_r2(chi2, null_dev, n)
    pred = (mu >= 0.5).astype(float)
    cls = {"tn": int(((pred == 0) & (y == 0)).sum()), "fp": int(((pred == 1) & (y == 0)).sum()),
           "fn": int(((pred == 0) & (y == 1)).sum()), "tp": int(((pred == 1) & (y == 1)).sum())}
    cls["percent_correct"] = 100 * (cls["tn"] + cls["tp"]) / n
    cls["sensitivity"] = 100 * cls["tp"] / max(1, cls["tp"] + cls["fn"])
    cls["specificity"] = 100 * cls["tn"] / max(1, cls["tn"] + cls["fp"])

    b = ResultBuilder(request)
    b.statistic("chi2", "Likelihood-ratio chi-square of the model", "χ²", chi2, [df_m], p_m)
    for r in recs:
        b.statistic("z", "Wald z test of the coefficient", "z", r["statistic"], [], r["p"], term=r["term"])
    b.effect("nagelkerke_r2", "Nagelkerke R squared", "R²N", Estimate(nk, None, None, level))
    b.effect("cox_snell_r2", "Cox-Snell R squared", "R²CS", Estimate(cs, None, None, level))
    for r in recs[1:]:
        b.effect("odds_ratio", "Odds ratio", "OR", Estimate(r["or"], r["or_ci_lower"], r["or_ci_upper"], level),
                 term=r["term"])
    b.chart("coefficients", recs)
    b.chart("model_summary", [{"chi2": chi2, "df": float(df_m), "p": p_m, "deviance": dev0, "null_deviance": null_dev,
                               "cox_snell_r2": cs, "nagelkerke_r2": nk, "n": n, "n_events": int(y.sum()),
                               "event": ev_label, "converged": fit["converged"]}])
    b.chart("classification", [{"observed": other_label, "predicted_no": cls["tn"], "predicted_yes": cls["fp"]},
                                {"observed": ev_label, "predicted_no": cls["fn"], "predicted_yes": cls["tp"]},
                                {"observed": "summary", "percent_correct": cls["percent_correct"],
                                 "sensitivity": cls["sensitivity"], "specificity": cls["specificity"]}])
    rows = _case_rows(d)
    vif = gvif(vcov[1:, 1:], d.assign[1:], d.predictors)
    if vif:
        b.chart("vif", vif)
    hl = areg.hosmer_lemeshow(y, mu, alpha)
    for res in (hl, areg.influential_cases(_cooks_glm(X, y, mu), rows, alpha), areg.multicollinearity(vif, n)):
        if res is not None:
            b.assumption(*res)
    if separated:
        b.warn(warning("perfect_separation", "serious",
                       f"Some predictor (or combination) separates the {ev_label} and {other_label} groups almost "
                       "perfectly, so the model could not settle on finite estimates. The coefficients, odds ratios "
                       "and their p-values are not trustworthy. Remove or combine the predictor, collect more data, or "
                       "use a penalized (Firth) logistic regression."))
    b.warn(vif_warning(vif))
    events = int(min(y.sum(), n - y.sum()))
    if df_m and events / df_m < 10:
        b.warn(warning("few_events", "caution",
                       f"The rarer outcome occurs only {events} times for {df_m} predictor terms (fewer than 10 per "
                       "term). Estimates may be unstable and too extreme; consider fewer predictors."))
    predictor_descriptives(b, d, level, include_outcome=False)
    dummy_coding(b, d)
    b.warn(missing_warning(d.n_excluded))
    b.inputs(d.n_used, d.n_excluded, [({d.outcome: lv}, int((d.y == k).sum())) for k, lv in enumerate(d.outcome_levels)])

    sig = p_m < alpha
    phrase = f"{d.outcome_label} = {ev_label}"
    r = (Rich().t(f"A binary logistic regression predicted {phrase} from {', '.join(d.pred_labels)}. The model "
                  f"{'was' if sig else 'was not'} significantly better than one with no predictors, ")
         .stat("χ²", [df_m], chi2).t(", ").p(p_m).t(", Nagelkerke ").extend(Rich().i("R").sup("2"))
         .t(f" = {apa.no_zero(nk)}, and classified {cls['percent_correct']:.1f}% of cases correctly."))
    b.sentence(r)
    b.summary(f"The model estimates each person's chance of {phrase} ({int(y.sum())} of {n} people). "
              f"{'Together the predictors clearly help' if sig else 'The predictors do not clearly help'} to predict "
              f"it ({p_phrase(p_m)}), and the model sorts {cls['percent_correct']:.0f}% of people into the right "
              "group." + ("" if separated else _or_phrase(recs, alpha, phrase))
              + (" Warning: the groups are almost perfectly separated, so the estimates are unreliable."
                 if separated else ""))
    note = (Rich().t(f"N = {n}. Event: {phrase}. ").i("OR").t(" = odds ratio (profile-likelihood CI). Model ")
            .stat("χ²", [df_m], chi2).t(", ").p(p_m).t(f"; Cox-Snell R² = {apa.no_zero(cs)}; Nagelkerke R² = "
                                                      f"{apa.no_zero(nk)}. {factor_note(d)}"))
    b.table(_or_table(f"Logistic Regression Predicting {phrase}", recs, level, note))
    cols = [apa.column("obs", "Observed", "left"), apa.column("no", f"Predicted {other_label}"),
            apa.column("yes", f"Predicted {ev_label}"), apa.column("pct", "% correct")]
    body = [apa.row([apa.cell_text(other_label), apa.cell_int(cls["tn"]), apa.cell_int(cls["fp"]),
                     apa.cell_num(cls["specificity"], 1)]),
            apa.row([apa.cell_text(ev_label), apa.cell_int(cls["fn"]), apa.cell_int(cls["tp"]),
                     apa.cell_num(cls["sensitivity"], 1)]),
            apa.row([apa.cell_text("Overall"), apa.cell_empty(), apa.cell_empty(),
                     apa.cell_num(cls["percent_correct"], 1)], kind="total")]
    b.extra_table(apa.table("Classification Table", cols, body, number=None,
                            general_note="A person is predicted to have the event when their predicted chance is .50 "
                                         "or higher."))
    return b.build()


# ---------------------------------------------------------------------------
# Proportional-odds logit (MASS::polr)
# ---------------------------------------------------------------------------
def _ord_parts(theta, X, y, off, J, need_hess=True):
    n, k = X.shape
    beta, zeta = theta[:k], theta[k:]
    eta = X @ beta + off
    up = y < J - 1
    lo = y > 0
    a = np.where(up, zeta[np.minimum(y, J - 2)] - eta, np.inf)
    bb = np.where(lo, zeta[np.maximum(y - 1, 0)] - eta, -np.inf)
    Fa = np.where(up, expit(a), 1.0)
    Fb = np.where(lo, expit(bb), 0.0)
    # pr = F(a) - F(b), computed without cancellation near 1
    pr = np.where(up & lo, Fa - Fb, np.where(up, Fa, 1 - Fb))
    if np.any(pr <= 0) or not np.all(np.isfinite(pr)):
        return -np.inf, None, None
    ll = float(np.log(pr).sum())
    fa = np.where(up, Fa * (1 - Fa), 0.0)
    fb = np.where(lo, Fb * (1 - Fb), 0.0)
    P = k + J - 1
    A = np.zeros((n, P))
    B = np.zeros((n, P))
    A[:, :k] = -X
    B[:, :k] = -X
    A[~up, :k] = 0
    B[~lo, :k] = 0
    rows = np.arange(n)
    A[rows[up], k + y[up]] = 1
    B[rows[lo], k + y[lo] - 1] = 1
    G = (fa[:, None] * A - fb[:, None] * B) / pr[:, None]
    grad = G.sum(0)
    if not need_hess:
        return ll, grad, None
    dfa = fa * (1 - 2 * Fa)
    dfb = fb * (1 - 2 * Fb)
    H = (A.T * (dfa / pr)) @ A - (B.T * (dfb / pr)) @ B - G.T @ G
    return ll, grad, H


def fit_polr(X: np.ndarray, y: np.ndarray, J: int, offset: np.ndarray | None = None,
             start: np.ndarray | None = None, maxit: int = 200) -> dict:
    """Maximum likelihood of the cumulative logit model by damped Newton-Raphson. y codes 0..J-1."""
    n, k = X.shape
    off = np.zeros(n) if offset is None else offset
    y = y.astype(int)
    if start is None:
        cum = np.cumsum(np.bincount(y, minlength=J))[:-1] / n
        cum = np.clip(cum, 1e-6, 1 - 1e-6)
        theta = np.concatenate([np.zeros(k), np.log(cum / (1 - cum))])
    else:
        theta = np.asarray(start, float).copy()
    ll, g, H = _ord_parts(theta, X, y, off, J)
    converged = False
    for _ in range(maxit):
        try:
            step = -np.linalg.solve(H, g)
        except np.linalg.LinAlgError:
            break
        t = 1.0
        while t > 1e-10:
            cand = theta + t * step
            if np.all(np.diff(cand[k:]) > 0):
                ll_c, g_c, H_c = _ord_parts(cand, X, y, off, J)
                if ll_c >= ll - 1e-12 * abs(ll):
                    break
            t /= 2
        else:
            break
        done = np.max(np.abs(t * step)) < 1e-11 or abs(ll_c - ll) < 1e-15 * max(1, abs(ll))
        theta, ll, g, H = cand, ll_c, g_c, H_c
        if done:
            converged = True
            break
    vcov = np.linalg.inv(-H)
    return {"theta": theta, "beta": theta[:k], "zeta": theta[k:], "vcov": vcov, "deviance": -2 * ll,
            "converged": converged}


@register("regression.ordinal", label="Ordinal logistic regression",
          roles=[Role("outcome", 1, 1, "Ordered categories (3 or more), e.g. a rating scale"),
                 Role("predictors", 1, None, "Predictors (numbers, or categories that are dummy coded)")],
          options=PRED_OPTIONS)
def ordinal(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    require_two_sided(request, "Ordinal regression")
    level, alpha = request.ci_level, request.alpha
    d = build_design(df, request, meta, request.variables["outcome"][0], list(request.variables["predictors"]),
                     "ordinal")
    J = len(d.outcome_levels)
    if J < 3:
        raise InvalidParams(f"Ordinal regression needs an outcome with 3 or more ordered values; "
                            f"'{d.outcome_label}' has {J}. Use binary logistic regression instead.")
    check_rank(d)
    X = d.X[:, 1:]
    y = d.y.astype(int)
    n, k = X.shape
    fit = fit_polr(X, y, J)
    if not fit["converged"]:
        raise InvalidParams("The ordinal model did not converge, usually because a predictor separates the outcome "
                            "categories perfectly or some categories are nearly empty. Combine sparse categories or "
                            "remove a predictor.")
    beta, zeta, vcov = fit["beta"], fit["zeta"], fit["vcov"]
    se = np.sqrt(np.diag(vcov))
    dev0 = fit["deviance"]
    null = fit_polr(np.zeros((n, 0)), y, J)
    null_dev = null["deviance"]

    def dev_at(i):
        keep = [c for c in range(k) if c != i]
        start = np.concatenate([beta[keep], zeta])

        def g(v):
            f = fit_polr(X[:, keep], y, J, offset=v * X[:, i], start=start)
            return f["deviance"]
        return g

    recs = _coef_rows(d, range(1, k + 1), beta, se[:k], dev_at, dev0, level)
    lvl = d.outcome_level_labels
    thr = [{"threshold": f"{_key(d.outcome_levels[j])}|{_key(d.outcome_levels[j + 1])}",
            "label": f"{lvl[j]} | {lvl[j + 1]}", "estimate": float(zeta[j]), "se": float(se[k + j]),
            "statistic": float(zeta[j] / se[k + j])} for j in range(J - 1)]
    chi2 = null_dev - dev0
    p_m = float(stats.chi2.sf(chi2, k))
    cs, nk = _pseudo_r2(chi2, null_dev, n)

    b = ResultBuilder(request)
    b.statistic("chi2", "Likelihood-ratio chi-square of the model", "χ²", chi2, [k], p_m)
    for r in recs:
        b.statistic("z", "Wald z test of the coefficient", "z", r["statistic"], [], r["p"], term=r["term"])
    b.effect("nagelkerke_r2", "Nagelkerke R squared", "R²N", Estimate(nk, None, None, level))
    b.effect("cox_snell_r2", "Cox-Snell R squared", "R²CS", Estimate(cs, None, None, level))
    for r in recs:
        b.effect("odds_ratio", "Odds ratio", "OR", Estimate(r["or"], r["or_ci_lower"], r["or_ci_upper"], level),
                 term=r["term"])
    b.chart("coefficients", recs)
    b.chart("thresholds", thr)
    b.chart("model_summary", [{"chi2": chi2, "df": float(k), "p": p_m, "deviance": dev0, "null_deviance": null_dev,
                               "cox_snell_r2": cs, "nagelkerke_r2": nk, "n": n}])
    vif = gvif(vcov[:k, :k], d.assign[1:], d.predictors)
    if vif:
        b.chart("vif", vif)
    for res in (areg.brant(X, y, J, d.terms[1:], alpha), areg.multicollinearity(vif, n)):
        if res is not None:
            b.assumption(*res)
    counts = np.bincount(y, minlength=J)
    if counts.min() < 5:
        b.warn(warning("sparse_categories", "caution",
                       "Some outcome categories have fewer than 5 people ("
                       + ", ".join(f"{lvl[j]}: {counts[j]}" for j in range(J) if counts[j] < 5)
                       + "). Estimates may be unstable; consider combining neighbouring categories."))
    b.warn(vif_warning(vif))
    b.warn(cases_per_predictor_warning(n, k))
    predictor_descriptives(b, d, level, include_outcome=False)
    dummy_coding(b, d)
    b.warn(missing_warning(d.n_excluded))
    b.inputs(d.n_used, d.n_excluded, [({d.outcome: lv}, int(c)) for lv, c in zip(d.outcome_levels, counts)])

    sig = p_m < alpha
    r = (Rich().t(f"An ordinal (proportional-odds) logistic regression predicted {d.outcome_label} from "
                  f"{', '.join(d.pred_labels)}. The model {'was' if sig else 'was not'} significantly better than one "
                  "with no predictors, ").stat("χ²", [k], chi2).t(", ").p(p_m).t(", Nagelkerke ")
         .extend(Rich().i("R").sup("2")).t(f" = {apa.no_zero(nk)}."))
    b.sentence(r)
    b.summary(f"The model looks at what makes people more likely to be in a higher {d.outcome_label} category "
              f"({lvl[0]} to {lvl[-1]}). {'Together the predictors clearly help' if sig else 'The predictors do not clearly help'} "
              f"({p_phrase(p_m)})." + _or_phrase(recs, alpha, f"a higher {d.outcome_label}"))
    note = (Rich().t(f"N = {n}. ").i("OR").t(f" > 1 means higher {d.outcome_label} categories are more likely "
                                              "(profile-likelihood CI). Thresholds are the cut-points on the logit "
                                              "scale. Model ").stat("χ²", [k], chi2).t(", ").p(p_m)
            .t(f"; Nagelkerke R² = {apa.no_zero(nk)}. {factor_note(d)}"))
    b.table(_or_table(f"Ordinal Logistic Regression Predicting {d.outcome_label}", recs, level, note, thresholds=thr))
    return b.build()


def _key(v) -> str:
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)
