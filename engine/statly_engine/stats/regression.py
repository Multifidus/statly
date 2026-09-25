"""Linear and hierarchical regression (SPEC §8 "Prediction"). Reference: fixtures/r/regression.R.

Shared design building (dummy coding, complete cases), OLS, GVIF and result helpers used by
regression_logistic.py as well. Conventions (see also stats/README.md, "Regression"):
- Complete cases on the outcome and every predictor; the dropped count is reported.
- A predictor is categorical when it is listed in options.categorical, its metadata says nominal (or
  text storage), or (no metadata) its column is not numeric. Categorical predictors are dummy coded
  (R's contr.treatment): one 0/1 column per non-reference level. The reference is the first level
  (value-label order, else sorted), or options.reference = {variable: value}. Terms are keyed "var"
  (numeric) and "var[level]" (dummy); `chart_data.dummy_coding` and an extra table show the coding.
- regression.linear = lm + summary.lm: b, SE, t, p, CI (t on n - p df); beta = SPSS "Beta" =
  effectsize::standardize_parameters(method = "basic") = b * SD(column) / SD(y), dummies included, CI
  scaled the same way. R², adjusted R², F, residual SE, Cohen's f² = R² / (1 - R²). R² CI: two-sided
  noncentral-F inversion of the model F (effectsize::F_to_eta2(alternative = "two.sided")); f² bounds are
  the same transform of the R² bounds.
- regression.hierarchical: blocks block_1..block_6 entered in order, all fitted on the same complete
  cases. Per block: R², ΔR², ΔF / p = anova(previous, current) (block 1 vs the intercept-only model),
  local f² = ΔR² / (1 - R²_block). Headline = the last block's ΔF. The final model is reported in full.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy import stats

from statly_engine.errors import InvalidParams
from statly_engine.stats import apa, prep
from statly_engine.stats import assumptions_regression as areg
from statly_engine.stats.apa import Rich
from statly_engine.stats.core import ResultBuilder, finite, missing_warning, warning
from statly_engine.stats.descriptives import cell
from statly_engine.stats.effect_sizes import TWO_SIDED, Estimate
from statly_engine.stats.effect_sizes_anova import pve_ci
from statly_engine.stats.registry import Role, register

INTERCEPT = "(Intercept)"
R2 = Rich().i("R").sup("2")
DR2 = Rich().t("Δ").i("R").sup("2")
F2 = Rich().i("f").sup("2")
BETA = Rich().t("β")
MAX_BLOCKS = 6
MIN_CASES_PER_PREDICTOR = 10

PRED_OPTIONS = {
    "categorical": "Predictors to treat as categories (dummy coded) even though they hold numbers.",
    "reference": "{variable: value}: the reference (comparison) category for a categorical predictor. "
                 "Default: the first category.",
}


def p_phrase(p) -> str:
    s = apa.p_value(p)
    return f"p {s}" if s[0] in "<>" else f"p = {s}"


def require_two_sided(request, what: str) -> None:
    if request.tails.value != "two_sided":
        raise InvalidParams(f"{what} uses two-sided tests for every coefficient. Set tails to two-sided.")


# ---------------------------------------------------------------------------
# Design matrix
# ---------------------------------------------------------------------------
@dataclass
class Factor:
    name: str
    label: str
    levels: list            # reference first
    level_labels: list[str]


@dataclass
class Design:
    y: np.ndarray                         # outcome (numeric, 0/1, or ordinal codes 0..J-1)
    X: np.ndarray                         # n x p, intercept first
    terms: list[str]                      # column keys
    labels: list[str]                     # display names per column
    assign: list[int]                     # 0 = intercept, i = predictors[i - 1]
    predictors: list[str]
    pred_labels: list[str]
    factors: dict[str, Factor]
    index: pd.Index                       # rows used
    n_used: int
    n_excluded: int
    outcome: str
    outcome_label: str
    outcome_levels: list = field(default_factory=list)
    outcome_level_labels: list[str] = field(default_factory=list)

    def columns_of(self, predictors: list[str]) -> list[int]:
        """Column indices (intercept + the given predictors' columns)."""
        want = {self.predictors.index(p) + 1 for p in predictors}
        return [j for j, a in enumerate(self.assign) if a == 0 or a in want]


def is_categorical(df: pd.DataFrame, name: str, meta: dict | None, forced: list) -> bool:
    if name in forced:
        return True
    v = prep.variable_meta(meta, name)
    if v:
        return v.get("level") == "nominal" or v.get("dtype") == "string"
    col = df[name]
    return not (pd.api.types.is_numeric_dtype(col) or pd.api.types.is_bool_dtype(col))


def _match(value, levels: list, what: str):
    for lv in levels:
        if prep._same(value, lv):
            return lv
    raise InvalidParams(f"{what} has no rows with the value {value!r}.")


def build_design(df: pd.DataFrame, request, meta: dict | None, outcome: str, predictors: list[str],
                 outcome_kind: str = "numeric") -> Design:
    """Complete cases + dummy-coded model matrix. outcome_kind: numeric | binary | ordinal."""
    if len(set(predictors)) != len(predictors):
        raise InvalidParams("Each predictor can be chosen only once.")
    if outcome in predictors:
        raise InvalidParams("The outcome can't also be a predictor.")
    opts = request.options or {}
    forced = list(opts.get("categorical") or [])
    refs = opts.get("reference") or {}
    if not isinstance(refs, dict):
        raise InvalidParams("options.reference must map a categorical predictor to its reference value.")

    ycol = prep.numeric(df, outcome, meta) if outcome_kind == "numeric" else prep.categorical(df, outcome, meta)
    cols, kinds = {}, {}
    for p in predictors:
        kinds[p] = is_categorical(df, p, meta, forced)
        cols[p] = prep.categorical(df, p, meta) if kinds[p] else prep.numeric(df, p, meta)
    ok = ycol.notna().to_numpy().copy()
    for p in predictors:
        ok &= cols[p].notna().to_numpy()
    n_used = int(ok.sum())
    index = df.index[ok]

    factors: dict[str, Factor] = {}
    X = [np.ones(n_used)]
    terms, labels, assign = [INTERCEPT], ["Intercept"], [0]
    for i, p in enumerate(predictors, start=1):
        lab = prep.label(meta, p)
        vals = cols[p][ok]
        if kinds[p]:
            levels = prep.level_order(vals, p, meta)
            if p in refs:
                ref = _match(refs[p], levels, f"'{lab}'")
                levels = [ref] + [lv for lv in levels if lv is not ref]
            if len(levels) < 2:
                raise InvalidParams(f"'{lab}' has only one category among the people analysed, so it can't "
                                    "predict anything. Remove it or check the filter.")
            llabs = [prep.value_label(meta, p, lv) for lv in levels]
            factors[p] = Factor(p, lab, levels, llabs)
            for lv, ll in zip(levels[1:], llabs[1:]):
                X.append(np.array([1.0 if prep._same(v, lv) else 0.0 for v in vals]))
                terms.append(f"{p}[{_key(lv)}]")
                labels.append(f"{lab}: {ll}")
                assign.append(i)
        else:
            X.append(vals.to_numpy(float))
            terms.append(p)
            labels.append(lab)
            assign.append(i)
    d = Design(y=np.empty(0), X=np.column_stack(X), terms=terms, labels=labels, assign=assign,
               predictors=list(predictors), pred_labels=[prep.label(meta, p) for p in predictors],
               factors=factors, index=index, n_used=n_used, n_excluded=int(len(df) - n_used),
               outcome=outcome, outcome_label=prep.label(meta, outcome))
    yv = ycol[ok]
    if outcome_kind == "numeric":
        d.y = yv.to_numpy(float)
    else:
        levels = prep.level_order(yv, outcome, meta)
        d.outcome_levels = levels
        d.outcome_level_labels = [prep.value_label(meta, outcome, lv) for lv in levels]
        d.y = np.array([next(k for k, lv in enumerate(levels) if prep._same(v, lv)) for v in yv], dtype=float)
    return d


def _key(v) -> str:
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def check_rank(d: Design, cols: list[int] | None = None) -> None:
    """Refuse aliased (perfectly redundant) columns, as car::vif does; lm would drop them silently."""
    cols = list(range(d.X.shape[1])) if cols is None else cols
    X = d.X[:, cols]
    n, p = X.shape
    if n <= p:
        raise InvalidParams(f"There are {n} complete cases but the model estimates {p} coefficients. A "
                            "regression needs more people than coefficients: add data or use fewer predictors.")
    Xs = X / np.where((X ** 2).sum(0) > 0, np.sqrt((X ** 2).sum(0)), 1.0)
    kept, bad = [0], []
    for j in range(1, p):  # sequential, like lm's pivoting QR (tol 1e-7): later redundant columns are flagged
        sv = np.linalg.svd(Xs[:, kept + [j]], compute_uv=False)
        (bad if sv[-1] < 1e-7 * sv[0] else kept).append(j)
    bad = [cols[j] for j in bad]
    if bad:
        names = ", ".join(d.labels[j] for j in bad)
        raise InvalidParams(f"Some predictors carry exactly the same information as others ({names}): each is "
                            "a constant or an exact combination of the other predictors, so their separate "
                            "effects can't be estimated. Remove one of the overlapping predictors.")


# ---------------------------------------------------------------------------
# OLS
# ---------------------------------------------------------------------------
def ols(y: np.ndarray, X: np.ndarray, level: float = 0.95) -> dict:
    n, p = X.shape
    Q, R = np.linalg.qr(X)
    coef = np.linalg.solve(R, Q.T @ y)
    fitted = X @ coef
    resid = y - fitted
    df_res = n - p
    rss = float(resid @ resid)
    sigma2 = rss / df_res
    Rinv = np.linalg.inv(R)
    xtx_inv = Rinv @ Rinv.T
    vcov = sigma2 * xtx_inv
    se = np.sqrt(np.diag(vcov))
    with np.errstate(divide="ignore", invalid="ignore"):
        t = coef / se
    pv = 2 * stats.t.sf(np.abs(t), df_res)
    q = stats.t.ppf(1 - (1 - level) / 2, df_res)
    tss = float(((y - y.mean()) ** 2).sum())
    r2 = 1 - rss / tss if tss > 0 else float("nan")
    df1 = p - 1
    f = ((tss - rss) / df1) / sigma2 if df1 > 0 and sigma2 > 0 else float("nan")
    fp = float(stats.f.sf(f, df1, df_res)) if finite(f) else float("nan")
    hat = (Q ** 2).sum(1)
    with np.errstate(divide="ignore", invalid="ignore"):
        cooks = resid ** 2 / (p * sigma2) * hat / (1 - hat) ** 2
    return dict(coef=coef, se=se, t=t, p=pv, lower=coef - q * se, upper=coef + q * se, fitted=fitted,
                resid=resid, rss=rss, tss=tss, df_res=df_res, sigma=math.sqrt(sigma2), vcov=vcov, r2=r2,
                adj_r2=1 - (1 - r2) * (n - 1) / df_res, f=f, df1=df1, f_p=fp, hat=hat, cooks=cooks, n=n, k=p)


def standardized(fit: dict, X: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """SPSS Beta: b * SD(column) / SD(y) (effectsize 'basic'); the intercept gets NaN."""
    sx = X.std(0, ddof=1)
    s = sx / y.std(ddof=1)
    s[0] = np.nan
    return fit["coef"] * s, fit["lower"] * s, fit["upper"] * s


def gvif(vcov_noint: np.ndarray, assign_noint: list[int], labels: list[str]) -> list[dict]:
    """car::vif: GVIF per term from the coefficient correlation matrix (intercept removed)."""
    terms = sorted(set(assign_noint))
    if len(terms) < 2:
        return []
    sd = np.sqrt(np.diag(vcov_noint))
    Rm = vcov_noint / np.outer(sd, sd)
    det = np.linalg.det(Rm)
    out = []
    a = np.array(assign_noint)
    for t in terms:
        s = np.where(a == t)[0]
        o = np.where(a != t)[0]
        g = np.linalg.det(Rm[np.ix_(s, s)]) * np.linalg.det(Rm[np.ix_(o, o)]) / det
        out.append({"term": labels[t - 1], "gvif": float(g), "df": int(len(s)),
                    "gvif_adj": float(g ** (1 / (2 * len(s))))})
    return out


def r2_estimates(r2: float, df1: float, df2: float, level: float) -> tuple[Estimate, Estimate]:
    """R² with the two-sided noncentral-F CI (as effectsize::F_to_eta2), and f² = R² / (1 - R²)."""
    e = pve_ci(r2, df1, df2, level, TWO_SIDED)

    def tf(v):
        return None if v is None else (math.inf if v >= 1 else v / (1 - v))
    return e, Estimate(tf(e.value), tf(e.lower), tf(e.upper), level)


# ---------------------------------------------------------------------------
# Result helpers (shared with regression_logistic)
# ---------------------------------------------------------------------------
def dummy_coding(b: ResultBuilder, d: Design) -> None:
    """chart_data.dummy_coding (long: one record per level x dummy column) + one extra table per factor."""
    recs = []
    for f in d.factors.values():
        cols = [f"{f.name}[{_key(lv)}]" for lv in f.levels[1:]]
        for i, (lv, ll) in enumerate(zip(f.levels, f.level_labels)):
            for j, c in enumerate(cols):
                recs.append({"variable": f.name, "variable_label": f.label, "level": _key(lv), "level_label": ll,
                             "is_reference": i == 0, "dummy": c, "dummy_label": f"{f.label}: {f.level_labels[j + 1]}",
                             "value": 1 if i == j + 1 else 0})
        columns = [apa.column("level", f.label, "left")] + [
            apa.column(f"d{j}", f.level_labels[j + 1], "center") for j in range(len(cols))]
        rows = [apa.row([apa.cell_text(ll + (" (reference)" if i == 0 else ""))] +
                        [apa.cell_int(1 if i == j + 1 else 0) for j in range(len(cols))])
                for i, ll in enumerate(f.level_labels)]
        note = (f"Each column is a 0/1 dummy variable. People in the reference group ({f.level_labels[0]}) score 0 "
                "on every column, so each coefficient compares one category with the reference group.")
        b.extra_table(apa.table(f"Dummy Coding of {f.label}", columns, rows, number=None, general_note=note))
    if recs:
        b.chart("dummy_coding", recs)


def factor_note(d: Design) -> str:
    if not d.factors:
        return ""
    return " ".join(f"{f.label} is dummy coded with {f.level_labels[0]} as the reference group." for f in d.factors.values())


def predictor_descriptives(b: ResultBuilder, d: Design, level: float, include_outcome: bool = True) -> None:
    rows = []
    if include_outcome:
        rows.append(cell(d.outcome, {}, d.outcome_label, d.y, level))
    for j, (t, a) in enumerate(zip(d.terms, d.assign)):
        if a and d.predictors[a - 1] not in d.factors:
            rows.append(cell(t, {}, d.labels[j], d.X[:, j], level))
    b.descriptives(rows)


def cases_per_predictor_warning(n: int, k: int, what: str = "people") -> dict | None:
    if k == 0 or n / k >= MIN_CASES_PER_PREDICTOR:
        return None
    return warning("small_sample", "caution",
                   f"There are only {n} {what} for {k} predictor terms (fewer than {MIN_CASES_PER_PREDICTOR} per "
                   "term). Estimates will be imprecise and may not hold up in new data; consider fewer predictors.")


def vif_warning(v: list[dict]) -> dict | None:
    hi = [r for r in v if r["gvif_adj"] ** 2 >= areg.VIF_CAUTION]
    if not hi:
        return None
    return warning("multicollinearity", "caution",
                   "Some predictors overlap strongly with the others (" + ", ".join(r["term"] for r in hi) +
                   "). Their separate coefficients are unstable and hard to interpret, even though the model "
                   "as a whole is fine.")


# ---------------------------------------------------------------------------
# Linear regression
# ---------------------------------------------------------------------------
def _fit_linear(d: Design, cols: list[int], level: float) -> dict:
    X = d.X[:, cols]
    fit = ols(d.y, X, level)
    fit["beta"], fit["beta_lower"], fit["beta_upper"] = standardized(fit, X, d.y)
    fit["cols"] = cols
    fit["r2_est"], fit["f2_est"] = r2_estimates(fit["r2"], fit["df1"], fit["df_res"], level)
    return fit


def _coef_records(d: Design, fit: dict, model: int | None = None) -> list[dict]:
    out = []
    for i, j in enumerate(fit["cols"]):
        rec = {"term": d.terms[j], "label": d.labels[j], "estimate": float(fit["coef"][i]),
               "se": float(fit["se"][i]), "statistic": float(fit["t"][i]), "df": float(fit["df_res"]),
               "p": float(fit["p"][i]), "ci_lower": float(fit["lower"][i]), "ci_upper": float(fit["upper"][i]),
               "beta": None if j == 0 else float(fit["beta"][i]),
               "beta_ci_lower": None if j == 0 else float(fit["beta_lower"][i]),
               "beta_ci_upper": None if j == 0 else float(fit["beta_upper"][i])}
        if model is not None:
            rec = {"model": model, **rec}
        out.append(rec)
    return out


def _model_record(fit: dict) -> dict:
    r2, f2 = fit["r2_est"], fit["f2_est"]
    return {"r_squared": fit["r2"], "adj_r_squared": fit["adj_r2"], "sigma": fit["sigma"], "f": fit["f"],
            "df1": float(fit["df1"]), "df2": float(fit["df_res"]), "p": fit["f_p"], "f_sq": f2.value,
            "r_squared_ci_lower": r2.lower, "r_squared_ci_upper": r2.upper, "f_sq_ci_lower": f2.lower,
            "f_sq_ci_upper": f2.upper, "n": fit["n"]}


def _linear_core(b: ResultBuilder, d: Design, fit: dict, level: float, alpha: float) -> list[dict]:
    """Coefficients (t stats + beta effects), model effects, assumptions, charts. Returns VIF records."""
    for i, j in enumerate(fit["cols"]):
        b.statistic("t", "t test of the coefficient", "t", fit["t"][i], [fit["df_res"]], fit["p"][i], term=d.terms[j])
    b.effect("r_squared", "R squared", "R²", fit["r2_est"], "eta_sq", what="amount of explained variance")
    b.effect("adj_r_squared", "Adjusted R squared", "adj. R²",
             Estimate(fit["adj_r2"], None, None, level))
    b.effect("f_sq", "Cohen's f squared", "f²", fit["f2_est"], "f_sq", what="effect")
    for i, j in enumerate(fit["cols"]):
        if j:
            b.effect("beta", "Standardized coefficient (beta)", "β",
                     Estimate(fit["beta"][i], fit["beta_lower"][i], fit["beta_upper"][i], level), "r",
                     term=d.terms[j], what="relationship")
    b.chart("coefficients", _coef_records(d, fit))
    b.chart("model_summary", [_model_record(fit)])
    X = d.X[:, fit["cols"]]
    assign = [d.assign[j] for j in fit["cols"]]
    vif = gvif(fit["vcov"][1:, 1:], assign[1:], d.predictors)
    if vif:
        b.chart("vif", vif)
    rows = [int(i) + 1 if isinstance(i, (int, np.integer)) else str(i) for i in d.index]
    b.chart("residuals_vs_fitted", [{"case": r, "fitted": float(fv), "residual": float(e)}
                                    for r, fv, e in zip(rows, fit["fitted"], fit["resid"])])
    for res in (areg.residual_normality(fit["resid"], alpha),
                areg.linearity_reset(d.y, X, fit["fitted"], alpha),
                areg.homoscedasticity_bp(fit["resid"], X, alpha),
                areg.influential_cases(fit["cooks"], rows, alpha),
                areg.multicollinearity(vif, fit["n"])):
        if res is not None:
            b.assumption(*res)
    b.warn(vif_warning(vif))
    b.warn(cases_per_predictor_warning(fit["n"], len(fit["cols"]) - 1))
    return vif


def coef_table(title: str, d: Design, fit: dict, level: float, note: Rich) -> dict:
    cols = [apa.column("term", "Predictor", "left"), apa.column("b", Rich().i("b")), apa.column("se", Rich().i("SE")),
            apa.column("ci", f"{apa.level_text(level)} CI"), apa.column("beta", BETA), apa.column("t", Rich().i("t")),
            apa.column("p", Rich().i("p"))]
    rows = []
    for rec in _coef_records(d, fit):
        rows.append(apa.row([apa.cell_text(rec["label"]), apa.cell_num(rec["estimate"]), apa.cell_num(rec["se"]),
                             apa.cell_ci(rec["ci_lower"], rec["ci_upper"]),
                             apa.cell_num(rec["beta"]) if rec["beta"] is not None else apa.cell_empty(),
                             apa.cell_num(rec["statistic"]), apa.cell_p(rec["p"])]))
    return apa.table(title, cols, rows, general_note=note)


def _model_note(fit: dict, level: float, d: Design) -> Rich:
    r2 = fit["r2_est"]
    note = (Rich().t(f"N = {fit['n']}. ").extend(R2).t(f" = {apa.no_zero(fit['r2'])}, {apa.level_text(level)} CI "
                                                        f"{apa.ci_text(r2.lower, r2.upper, bounded=True)}; adjusted ")
            .extend(R2).t(f" = {apa.no_zero(fit['adj_r2'])}; ").stat("F", [fit["df1"], fit["df_res"]], fit["f"])
            .t(", ").p(fit["f_p"]).t(f"; residual SE = {apa.num(fit['sigma'])}. ").extend(BETA)
            .t(" = standardized coefficient. "))
    fn = factor_note(d)
    return note.t(fn) if fn else note


def _strongest(d: Design, fit: dict, alpha: float) -> str:
    sig = [(abs(fit["beta"][i]), d.labels[j], fit["coef"][i]) for i, j in enumerate(fit["cols"])
           if j and fit["p"][i] < alpha and finite(fit["beta"][i])]
    if not sig:
        return " None of the predictors had a clear effect of its own once the others were taken into account."
    sig.sort(reverse=True)
    parts = [f"{lab} ({'higher' if bcoef > 0 else 'lower'} scores)" for _, lab, bcoef in sig[:3]]
    return (" Predictors with a clear effect of their own: " + ", ".join(parts) +
            f". {sig[0][1]} mattered most (largest standardized coefficient).")


@register("regression.linear", label="Linear regression",
          roles=[Role("outcome", 1, 1, "Score to predict (continuous)"),
                 Role("predictors", 1, None, "Predictors (numbers, or categories that are dummy coded)")],
          options=PRED_OPTIONS)
def linear(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    require_two_sided(request, "Linear regression")
    level, alpha = request.ci_level, request.alpha
    preds = list(request.variables["predictors"])
    d = build_design(df, request, meta, request.variables["outcome"][0], preds)
    check_rank(d)
    if np.ptp(d.y) == 0:
        raise InvalidParams(f"Every {d.outcome_label} score is the same, so there is nothing to predict.")
    fit = _fit_linear(d, list(range(d.X.shape[1])), level)
    b = ResultBuilder(request)
    b.statistic("F", "F test of the model", "F", fit["f"], [fit["df1"], fit["df_res"]], fit["f_p"])
    _linear_core(b, d, fit, level, alpha)
    predictor_descriptives(b, d, level)
    dummy_coding(b, d)
    b.warn(missing_warning(d.n_excluded))
    b.inputs(d.n_used, d.n_excluded)

    simple = len(preds) == 1 and not d.factors
    kind = "simple linear regression" if simple else "multiple linear regression"
    sig = fit["f_p"] < alpha
    who = ", ".join(d.pred_labels)
    r = (Rich().t(f"A {kind} was used to predict {d.outcome_label} from {who}. The model "
                  f"{'explained a significant' if sig else 'did not explain a significant'} share of the variance, ")
         .stat("F", [fit["df1"], fit["df_res"]], fit["f"]).t(", ").p(fit["f_p"]).t(", ")
         .es(R2, fit["r2"], fit["r2_est"].lower, fit["r2_est"].upper, level, bounded=True).t("."))
    if simple:
        r.t(f" Each one-unit increase in {d.pred_labels[0]} went with a change of {apa.num(fit['coef'][1])} in "
            f"{d.outcome_label}, ").es(BETA, fit["beta"][1], fit["beta_lower"][1], fit["beta_upper"][1], level).t(".")
    b.sentence(r)
    pct = fit["r2"] * 100
    summary = (f"Together, {who} explain about {pct:.0f}% of the differences in {d.outcome_label} "
               f"({'unlikely to be chance' if sig else 'this could easily be chance'}, {p_phrase(fit['f_p'])}).")
    if simple and sig:
        summary += (f" People with higher {d.pred_labels[0]} tended to have "
                    f"{'higher' if fit['coef'][1] > 0 else 'lower'} {d.outcome_label}.")
    elif not simple:
        summary += _strongest(d, fit, alpha)
    b.summary(summary)
    b.table(coef_table(f"Regression Coefficients Predicting {d.outcome_label}", d, fit, level,
                       _model_note(fit, level, d)))
    return b.build()


# ---------------------------------------------------------------------------
# Hierarchical regression
# ---------------------------------------------------------------------------
BLOCK_ROLES = [Role("outcome", 1, 1, "Score to predict (continuous)")] + [
    Role(f"block_{i}", 1 if i <= 2 else 0, None, f"Predictors entered at step {i}") for i in range(1, MAX_BLOCKS + 1)]


@register("regression.hierarchical", label="Hierarchical regression", roles=BLOCK_ROLES, options=PRED_OPTIONS)
def hierarchical(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    require_two_sided(request, "Hierarchical regression")
    level, alpha = request.ci_level, request.alpha
    blocks = [list(request.variables.get(f"block_{i}") or []) for i in range(1, MAX_BLOCKS + 1)]
    if any(not blk for blk in blocks[:max(i for i, blk in enumerate(blocks) if blk) + 1]):
        raise InvalidParams("Blocks must be filled in order (block 1, block 2, ...) without gaps.")
    blocks = [blk for blk in blocks if blk]
    allp = [p for blk in blocks for p in blk]
    if len(set(allp)) != len(allp):
        raise InvalidParams("Each predictor can be entered in only one block.")
    d = build_design(df, request, meta, request.variables["outcome"][0], allp)
    check_rank(d)
    if np.ptp(d.y) == 0:
        raise InvalidParams(f"Every {d.outcome_label} score is the same, so there is nothing to predict.")
    fits, recs = [], []
    prev_r2, prev_rss, prev_p = 0.0, float(((d.y - d.y.mean()) ** 2).sum()), 1
    for i, blk in enumerate(blocks, start=1):
        cols = d.columns_of([p for bb in blocks[:i] for p in bb])
        fit = _fit_linear(d, cols, level)
        q = len(cols) - prev_p
        fch = ((prev_rss - fit["rss"]) / q) / (fit["rss"] / fit["df_res"])
        pch = float(stats.f.sf(fch, q, fit["df_res"]))
        dr2 = fit["r2"] - prev_r2
        recs.append({"block": i, "predictors": ", ".join(prep.label(meta, p) for p in blk),
                     "r_squared": fit["r2"], "adj_r_squared": fit["adj_r2"], "delta_r_squared": dr2,
                     "f_change": fch, "df1": float(q), "df2": float(fit["df_res"]), "p_change": pch,
                     "f_sq_change": dr2 / (1 - fit["r2"]), "f": fit["f"], "p": fit["f_p"]})
        fits.append(fit)
        prev_r2, prev_rss, prev_p = fit["r2"], fit["rss"], len(cols)
    k = len(blocks)
    fin = fits[-1]
    b = ResultBuilder(request)
    order = [k - 1] + list(range(k - 1))
    for i in order:
        rc = recs[i]
        b.statistic("F_change", "F test of the R² change", "F", rc["f_change"], [rc["df1"], rc["df2"]],
                    rc["p_change"], term=f"Block {i + 1}")
    b.statistic("F", "F test of the final model", "F", fin["f"], [fin["df1"], fin["df_res"]], fin["f_p"])
    for i in range(k):
        b.effect("delta_r_squared", "R squared change", "ΔR²", Estimate(recs[i]["delta_r_squared"], None, None, level),
                 "eta_sq", term=f"Block {i + 1}", what="gain in explained variance")
        b.effect("f_sq_change", "Cohen's f squared for the block", "f²",
                 Estimate(recs[i]["f_sq_change"], None, None, level), "f_sq", term=f"Block {i + 1}", what="effect")
    _linear_core(b, d, fin, level, alpha)
    b.chart("blocks", recs)
    b.chart("block_coefficients", [r for i, f in enumerate(fits, start=1) for r in _coef_records(d, f, i)])
    predictor_descriptives(b, d, level)
    dummy_coding(b, d)
    b.warn(missing_warning(d.n_excluded))
    b.inputs(d.n_used, d.n_excluded)

    last = recs[-1]
    sig = last["p_change"] < alpha
    r = (Rich().t(f"A hierarchical regression predicted {d.outcome_label} in {k} steps. Adding "
                  f"{last['predictors']} in step {k} ")
         .t("significantly improved the model, " if sig else "did not significantly improve the model, ")
         .extend(DR2).t(f" = {apa.no_zero(last['delta_r_squared'])}, ").stat("F", [last["df1"], last["df2"]],
                                                                            last["f_change"])
         .t(", ").p(last["p_change"]).t(". The final model explained ")
         .es(R2, fin["r2"], fin["r2_est"].lower, fin["r2_est"].upper, level, bounded=True).t(" of the variance, ")
         .stat("F", [fin["df1"], fin["df_res"]], fin["f"]).t(", ").p(fin["f_p"]).t("."))
    b.sentence(r)
    steps = "; ".join(f"step {rc['block']} ({rc['predictors']}) added {rc['delta_r_squared'] * 100:.0f}%"
                      for rc in recs)
    b.summary(f"Predictors were added in {k} steps to see how much each step adds to explaining {d.outcome_label}: "
              f"{steps}. The last step {'added a real improvement' if sig else 'did not add a clear improvement'} "
              f"({p_phrase(last['p_change'])}). All together, the predictors explain about {fin['r2'] * 100:.0f}% "
              "of the differences.")

    cols = [apa.column("model", "Step", "left"), apa.column("r2", R2), apa.column("adj", Rich().t("Adj. ").extend(R2)),
            apa.column("dr2", DR2), apa.column("f", Rich().i("F").t(" change")), apa.column("df1", Rich().i("df").sub("1")),
            apa.column("df2", Rich().i("df").sub("2")), apa.column("p", Rich().i("p"))]
    rows = [apa.row([apa.cell_text(f"{rc['block']}: {rc['predictors']}"), apa.cell_num(rc["r_squared"], bounded=True),
                     apa.cell_num(rc["adj_r_squared"], bounded=True), apa.cell_num(rc["delta_r_squared"], bounded=True),
                     apa.cell_num(rc["f_change"]), apa.cell_df(rc["df1"]), apa.cell_df(rc["df2"]),
                     apa.cell_p(rc["p_change"])]) for rc in recs]
    b.table(apa.table(f"Hierarchical Regression Predicting {d.outcome_label}", cols, rows,
                      general_note=Rich().t(f"N = {d.n_used}. Step 1 is compared with a model with no predictors. "
                                            + factor_note(d))))
    b.extra_table(coef_table(f"Coefficients of the Final Model Predicting {d.outcome_label}", d, fin, level,
                             _model_note(fin, level, d)))
    return b.build()
