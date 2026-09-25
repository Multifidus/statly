"""Confirmatory factor analysis (SPEC §8 "Validity"). Reference: fixtures/r/factor.R (lavaan::cfa).

In-house maximum likelihood (semopy was evaluated: MIT and permissive dependencies, but its default
SLSQP fit stops ~4e-4 away from lavaan's estimates and it has no SRMR / RMSEA CI / standardized SEs, so
it would not meet the 1e-4 fixture tolerance; see stats/README.md).

Conventions = lavaan::cfa defaults:
- options.model = {"Factor": ["item", ...], ...} (default: one factor with every item). Scale set by the
  first item of each factor (marker, loading fixed to 1; std.lv = FALSE). Factor variances and
  covariances, loadings and residual variances are free; nothing is bounded (negative variances are
  reported with a Heywood warning, as lavaan does).
- Complete cases on the model's items (missing = "listwise"); S = covariance with divisor N
  (likelihood "normal"). F_ML = log|Sigma| + tr(S Sigma^-1) - log|S| - p, solved by Fisher scoring.
- SEs from the expected information (N/2 tr(Sigma^-1 dSigma_a Sigma^-1 dSigma_b))^-1; z tests two-sided.
- Standardized = standardizedSolution (std.all) with delta-method SEs (numerical Jacobian).
- Fit: chi2 = N F_ML on p(p+1)/2 - q df; baseline = independence model; CFI and TLI (lavaan formulas,
  TLI not truncated); RMSEA = sqrt(max(chi2 - df, 0) / (N df)) with the 90% CI from the noncentral chi2;
  SRMR = lavaan "srmr" (Bentler: residual covariances scaled by the observed SDs, diagonal included).
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy import optimize, stats

from statly_engine.errors import InvalidParams
from statly_engine.stats import apa, prep
from statly_engine.stats import factor_utils as fu
from statly_engine.stats.apa import Rich
from statly_engine.stats.core import ResultBuilder, finite, warning
from statly_engine.stats.registry import Role, register

FACTOR_N = 100
GOOD = {"cfi": 0.95, "tli": 0.95, "rmsea": 0.06, "srmr": 0.08}   # Hu & Bentler (1999)
OK = {"cfi": 0.90, "tli": 0.90, "rmsea": 0.08, "srmr": 0.10}


# ---------------------------------------------------------------------------
# Model and estimation
# ---------------------------------------------------------------------------
class CfaModel:
    """Parameter layout: free loadings (model order, markers fixed at 1), residual variances (item order),
    factor (co)variances (lower triangle, row by row)."""

    def __init__(self, factors: list[str], spec: dict[str, list[str]], items: list[str]):
        self.factors, self.items = factors, items
        self.p, self.m = len(items), len(factors)
        pos = {v: i for i, v in enumerate(items)}
        self.markers = [(pos[spec[f][0]], j) for j, f in enumerate(factors)]
        self.free_lam = [(pos[v], j) for j, f in enumerate(factors) for v in spec[f][1:]]
        self.lam_order = [(pos[v], j) for j, f in enumerate(factors) for v in spec[f]]
        self.phi_idx = [(a, c) for a in range(self.m) for c in range(a + 1)]
        self.q = len(self.free_lam) + self.p + len(self.phi_idx)
        self.df = self.p * (self.p + 1) // 2 - self.q

    def unpack(self, th: np.ndarray):
        lam = np.zeros((self.p, self.m))
        for i, j in self.markers:
            lam[i, j] = 1.0
        k = len(self.free_lam)
        for (i, j), v in zip(self.free_lam, th[:k]):
            lam[i, j] = v
        theta = th[k:k + self.p]
        phi = np.zeros((self.m, self.m))
        for (a, c), v in zip(self.phi_idx, th[k + self.p:]):
            phi[a, c] = phi[c, a] = v
        return lam, theta, phi

    def sigma(self, th):
        lam, theta, phi = self.unpack(th)
        return lam @ phi @ lam.T + np.diag(theta)

    def dsigma(self, th) -> np.ndarray:
        lam, _, phi = self.unpack(th)
        out = np.zeros((self.q, self.p, self.p))
        lp = lam @ phi
        a = 0
        for i, j in self.free_lam:
            d = np.zeros((self.p, self.p))
            d[i, :] += lp[:, j]
            d[:, i] += lp[:, j]
            out[a] = d
            a += 1
        for i in range(self.p):
            out[a, i, i] = 1.0
            a += 1
        for c1, c2 in self.phi_idx:
            e = np.zeros((self.m, self.m))
            e[c1, c2] = e[c2, c1] = 1.0
            out[a] = lam @ e @ lam.T
            a += 1
        return out


def _fml(model: CfaModel, th, s, logdet_s) -> float:
    sig = model.sigma(th)
    sign, logdet = np.linalg.slogdet(sig)
    if sign <= 0:
        return math.inf
    return float(logdet + np.trace(np.linalg.solve(sig, s)) - logdet_s - model.p)


def _start(model: CfaModel, spec, s: np.ndarray, x: np.ndarray) -> np.ndarray:
    sd = np.sqrt(np.diag(s))
    r = s / np.outer(sd, sd)
    pos = {v: i for i, v in enumerate(model.items)}
    std = np.full(model.p, np.nan)
    for f in model.factors:
        idx = [pos[v] for v in spec[f]]
        rf = r[np.ix_(idx, idx)]
        if len(idx) >= 3:
            l1 = np.abs(fu.fit_minres(rf, 1)["loadings"][:, 0])
        else:
            l1 = np.full(len(idx), math.sqrt(abs(rf[0, 1])))
        for i, v in zip(idx, l1):
            if not np.isfinite(std[i]):
                std[i] = min(max(v, 0.2), 0.95)
    phi_sd = np.array([std[i] * sd[i] for i, _ in model.markers])
    lam = [std[i] * sd[i] / phi_sd[j] for i, j in model.free_lam]
    theta = [max(s[i, i] * (1 - std[i] ** 2), 0.05 * s[i, i]) for i in range(model.p)]
    scores = np.column_stack([x[:, [pos[v] for v in spec[f]]].sum(axis=1) for f in model.factors])
    rs = np.atleast_2d(np.corrcoef(scores, rowvar=False)) if model.m > 1 else np.ones((1, 1))
    phi = [(phi_sd[a] ** 2 if a == c else 0.8 * rs[a, c] * phi_sd[a] * phi_sd[c]) for a, c in model.phi_idx]
    return np.array(lam + theta + phi, float)


def _information(model: CfaModel, th) -> np.ndarray:
    """H_ab = tr(Sigma^-1 dSigma_a Sigma^-1 dSigma_b) (= expected Hessian of F_ML)."""
    si = np.linalg.inv(model.sigma(th))
    a = np.einsum("ij,ajk->aik", si, model.dsigma(th))
    return np.einsum("aij,bji->ab", a, a)


def _gradient(model: CfaModel, th, s) -> np.ndarray:
    si = np.linalg.inv(model.sigma(th))
    w = si - si @ s @ si
    return np.einsum("ij,aji->a", w, model.dsigma(th))


def fit_ml(model: CfaModel, spec, s: np.ndarray, x: np.ndarray) -> dict:
    logdet_s = np.linalg.slogdet(s)[1]
    th = _start(model, spec, s, x)
    f = _fml(model, th, s, logdet_s)
    converged = False
    for _ in range(500):
        g = _gradient(model, th, s)
        try:
            step = np.linalg.solve(_information(model, th), g)
        except np.linalg.LinAlgError:
            break
        t = 1.0
        while t > 1e-10:
            new = th - t * step
            fn = _fml(model, new, s, logdet_s)
            if fn <= f + 1e-15 * max(1.0, abs(f)):
                break
            t /= 2
        else:
            break
        done = np.max(np.abs(new - th)) < 1e-11
        th, f = new, fn
        if done:
            converged = True
            break
    if not converged:   # Fisher scoring stalled: finish with BFGS on the same objective
        res = optimize.minimize(lambda v: _fml(model, v, s, logdet_s), th, jac=lambda v: _gradient(model, v, s),
                                method="BFGS", options={"gtol": 1e-10, "maxiter": 5000})
        th, f = res.x, res.fun
        converged = bool(np.max(np.abs(_gradient(model, th, s))) < 1e-6)
    return {"theta": th, "fmin": f, "converged": converged}


def _std(model: CfaModel, th) -> np.ndarray:
    """std.all: loadings (lam_order), residual variances, factor correlations (a > c)."""
    lam, theta, phi = model.unpack(th)
    sig = np.diag(lam @ phi @ lam.T) + theta
    out = [lam[i, j] * math.sqrt(abs(phi[j, j])) / math.sqrt(abs(sig[i])) for i, j in model.lam_order]
    out += list(theta / sig)
    out += [phi[a, c] / math.sqrt(abs(phi[a, a] * phi[c, c])) for a, c in model.phi_idx if a != c]
    return np.array(out)


def _jacobian(fn, th) -> np.ndarray:
    base = fn(th)
    jac = np.empty((len(base), len(th)))
    for k in range(len(th)):
        h = 1e-6 * max(1.0, abs(th[k]))
        up, dn = th.copy(), th.copy()
        up[k] += h
        dn[k] -= h
        jac[:, k] = (fn(up) - fn(dn)) / (2 * h)
    return jac


def _rmsea_ci(x2: float, df: int, n: int, level: float = 0.90) -> tuple[float | None, float | None]:
    if df <= 0:
        return None, None
    hi_p, lo_p = (1 + level) / 2, (1 - level) / 2

    def cdf(lam):
        return stats.chi2.cdf(x2, df) if lam <= 0 else stats.ncx2.cdf(x2, df, lam)

    def solve(target):
        if cdf(0.0) < target:
            return 0.0
        hi = max(n, x2 * 4, 10.0)
        while cdf(hi) > target:
            hi *= 2
        return optimize.brentq(lambda lam: cdf(lam) - target, 0.0, hi, xtol=1e-14, rtol=1e-14)

    return math.sqrt(solve(hi_p) / (n * df)), math.sqrt(solve(lo_p) / (n * df))


def cfa_compute(x: np.ndarray, factors: list[str], spec: dict, items: list[str]) -> dict:
    model = CfaModel(factors, spec, items)
    n, p = x.shape
    if model.df < 0:
        raise InvalidParams(f"This model has more unknowns than the data can identify ({model.q} parameters from "
                            f"{p * (p + 1) // 2} variances and covariances). Add items or use fewer factors.")
    s = np.cov(x, rowvar=False, ddof=0)
    if np.linalg.eigvalsh(s)[0] <= 1e-12:
        raise InvalidParams("The items' covariance matrix is singular (an item is constant or an exact combination "
                            "of others, or there are too few people).")
    fit = fit_ml(model, spec, s, x)
    th = fit["theta"]
    info = _information(model, th)
    try:
        vcov = np.linalg.inv(info) * 2 / n
        se = np.sqrt(np.maximum(np.diag(vcov), 0))
    except np.linalg.LinAlgError:
        vcov, se = None, np.full(len(th), np.nan)
    std = _std(model, th)
    if vcov is not None:
        jac = _jacobian(lambda v: _std(model, v), th)
        std_se = np.sqrt(np.maximum(np.diag(jac @ vcov @ jac.T), 0))
    else:
        std_se = np.full(len(std), np.nan)
    sig = model.sigma(th)
    x2 = n * fit["fmin"]
    df = model.df
    dsd = np.sqrt(np.diag(s))
    x2b = n * (float(np.sum(np.log(np.diag(s)))) - np.linalg.slogdet(s)[1])
    dfb = p * (p - 1) / 2
    t1 = max(x2 - df, 0.0)
    t2 = max(x2 - df, x2b - dfb, 0.0)
    cfi = 1.0 if t2 == 0 else 1 - t1 / t2
    tli = ((x2b / dfb - x2 / df) / (x2b / dfb - 1)) if df > 0 else None
    rmsea = math.sqrt(max(x2 - df, 0.0) / (n * df)) if df > 0 else None
    lo, hi = _rmsea_ci(x2, df, n)
    res = (s - sig) / np.outer(dsd, dsd)
    srmr = math.sqrt(float(np.mean(res[np.tril_indices(p)] ** 2)))
    return {"model": model, "n": n, "theta": th, "se": se, "std": std, "std_se": std_se, "converged": fit["converged"],
            "chi2": x2, "df": df, "p": float(stats.chi2.sf(x2, df)) if df > 0 else None, "baseline_chi2": x2b,
            "baseline_df": dfb, "cfi": cfi, "tli": tli, "rmsea": rmsea, "rmsea_lower": lo, "rmsea_upper": hi,
            "srmr": srmr}


def _z_p(est, se):
    if not (finite(est) and finite(se)) or se <= 0:
        return None, None
    z = est / se
    return float(z), float(2 * stats.norm.sf(abs(z)))


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------
def _model_spec(request, meta) -> tuple[list[str], dict[str, list[str]], list[str]]:
    items = list(dict.fromkeys(request.variables["items"]))
    raw = (request.options or {}).get("model")
    if raw is None:
        spec = {"Factor 1": items}
    elif isinstance(raw, dict) and raw:
        spec = {}
        for f, vs in raw.items():
            if not isinstance(vs, list) or not all(isinstance(v, str) for v in vs):
                raise InvalidParams(f"options.model['{f}'] must be a list of item names.")
            spec[str(f)] = list(dict.fromkeys(vs))
    else:
        raise InvalidParams("options.model must map each factor name to its list of items, e.g. "
                            "{\"Engagement\": [\"q1\", \"q2\", \"q3\"]}.")
    factors = list(spec)
    used = list(dict.fromkeys(v for f in factors for v in spec[f]))
    unknown = [v for v in used if v not in items]
    if unknown:
        raise InvalidParams(f"The model uses items that were not selected: {', '.join(unknown)}.")
    unused = [prep.label(meta, v) for v in items if v not in used]
    if unused:
        raise InvalidParams(f"These selected items are not assigned to any factor: {', '.join(unused)}.")
    clash = [f for f in factors if f in items]
    if clash:
        raise InvalidParams(f"A factor can't have the same name as an item ({', '.join(clash)}).")
    small = [f for f in factors if len(spec[f]) < 2]
    if small:
        raise InvalidParams(f"Each factor needs at least two items ({', '.join(small)} has fewer).")
    markers = [spec[f][0] for f in factors]
    if len(set(markers)) < len(markers):
        raise InvalidParams("Each factor's first item sets its scale, so two factors can't start with the same item.")
    return factors, spec, used


@register("validity.cfa", label="Confirmatory factor analysis",
          roles=[Role("items", 3, None, "The items in the measurement model")],
          options={"model": "Factor -> items map, e.g. {\"F1\": [\"q1\", \"q2\", \"q3\"], \"F2\": [...]}; the first "
                            "item of each factor sets its scale. Default: one factor with every item.",
                   "scale_name": "Name of the scale for tables and text."})
def cfa(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    factors, spec, items = _model_spec(request, meta)
    labels = {v: prep.label(meta, v) for v in items}
    x_all = np.column_stack([prep.numeric(df, v, meta).to_numpy() for v in items])
    ok = np.isfinite(x_all).all(axis=1)
    x = x_all[ok]
    dropped = int((~ok).sum())
    n = len(x)
    if n < 3:
        raise InvalidParams(f"CFA needs more people with every item answered (there are {n}).")
    flat = [labels[v] for v, c in zip(items, x.T) if np.ptp(c) == 0]
    if flat:
        raise InvalidParams(f"{', '.join(flat)} has the same answer from everyone, so it can't be modelled.")
    res = cfa_compute(x, factors, spec, items)
    model: CfaModel = res["model"]
    th, se, std, std_se = res["theta"], res["se"], res["std"], res["std_se"]
    lam, theta, phi = model.unpack(th)
    nl, p, m = len(model.lam_order), model.p, model.m
    k_free = len(model.free_lam)
    free_pos = {ij: a for a, ij in enumerate(model.free_lam)}
    phi_pos = {ij: k_free + p + a for a, ij in enumerate(model.phi_idx)}
    corr_pos = [ij for ij in model.phi_idx if ij[0] != ij[1]]

    b = ResultBuilder(request)
    b.statistic("chi2", "Model chi-square (ML)", "χ²", res["chi2"], [res["df"]], res["p"])
    b.statistic("cfi", "Comparative fit index", "CFI", res["cfi"])
    b.statistic("tli", "Tucker-Lewis index", "TLI", res["tli"])
    b.statistic("rmsea", "Root mean square error of approximation", "RMSEA", res["rmsea"])
    b.statistic("rmsea_ci_lower", "RMSEA 90% CI lower bound", "RMSEA", res["rmsea_lower"])
    b.statistic("rmsea_ci_upper", "RMSEA 90% CI upper bound", "RMSEA", res["rmsea_upper"])
    b.statistic("srmr", "Standardized root mean square residual", "SRMR", res["srmr"])
    b.statistic("baseline_chi2", "Baseline (independence) model chi-square", "χ²", res["baseline_chi2"],
                [res["baseline_df"]], float(stats.chi2.sf(res["baseline_chi2"], res["baseline_df"])))

    load_recs = []
    for a, (i, j) in enumerate(model.lam_order):
        marker = (i, j) in model.markers
        est = float(lam[i, j])
        e_se = None if marker else float(se[free_pos[(i, j)]])
        z, pz = _z_p(est, e_se)
        sz, sp = _z_p(std[a], std_se[a])
        load_recs.append({"factor": factors[j], "item": items[i], "label": labels[items[i]], "estimate": est,
                          "se": e_se, "z": z, "p": pz, "std": float(std[a]), "std_se": float(std_se[a]), "std_p": sp,
                          "marker": marker})
    resid_recs = []
    for i in range(p):
        a = k_free + i
        z, pz = _z_p(theta[i], se[a])
        resid_recs.append({"item": items[i], "label": labels[items[i]], "estimate": float(theta[i]), "se": float(se[a]),
                           "z": z, "p": pz, "std": float(std[nl + i]), "std_se": float(std_se[nl + i]),
                           "std_p": _z_p(std[nl + i], std_se[nl + i])[1]})
    cov_recs = []
    for c, (a1, a2) in enumerate(corr_pos):
        pa = phi_pos[(a1, a2)]
        z, pz = _z_p(phi[a1, a2], se[pa])
        s_i = nl + p + c
        cov_recs.append({"factor_a": factors[a2], "factor_b": factors[a1], "estimate": float(phi[a1, a2]),
                         "se": float(se[pa]), "z": z, "p": pz, "std": float(std[s_i]), "std_se": float(std_se[s_i]),
                         "std_p": _z_p(std[s_i], std_se[s_i])[1]})
    var_recs = []
    for j in range(m):
        pa = phi_pos[(j, j)]
        z, pz = _z_p(phi[j, j], se[pa])
        var_recs.append({"factor": factors[j], "estimate": float(phi[j, j]), "se": float(se[pa]), "z": z, "p": pz})
    b.chart("loadings", load_recs)
    b.chart("residual_variances", resid_recs)
    b.chart("factor_variances", var_recs)
    if cov_recs:
        b.chart("factor_covariances", cov_recs)
    nodes = [{"kind": "node", "id": f, "label": f, "node_type": "latent", "residual": None} for f in factors]
    nodes += [{"kind": "node", "id": v, "label": labels[v], "node_type": "observed", "residual": r["std"]}
              for v, r in zip(items, resid_recs)]
    edges = [{"kind": "edge", "from": r["factor"], "to": r["item"], "edge_type": "loading", "weight": r["std"],
              "estimate": r["estimate"], "p": r["p"], "marker": r["marker"]} for r in load_recs]
    edges += [{"kind": "edge", "from": r["factor_a"], "to": r["factor_b"], "edge_type": "covariance", "weight": r["std"],
               "estimate": r["estimate"], "p": r["p"], "marker": False} for r in cov_recs]
    b.chart("path_diagram", nodes + edges)
    b.chart("fit_indices", [{"key": k, "value": res[k if k != "rmsea" else "rmsea"], "good": GOOD[k], "acceptable": OK[k],
                             "higher_is_better": k in ("cfi", "tli")} for k in ("cfi", "tli", "rmsea", "srmr")])

    _warnings(b, res, load_recs, resid_recs, cov_recs, var_recs, n, dropped)
    b.inputs(n, dropped)
    scale = (request.options or {}).get("scale_name") or "the scale"
    _tables(b, res, load_recs, cov_recs, factors, scale)
    _text(b, res, load_recs, factors, scale)
    return b.build()


def _verdict(res: dict) -> str:
    def good(k):
        v = res[k]
        return v is not None and (v >= GOOD[k] if k in ("cfi", "tli") else v <= GOOD[k])

    def ok(k):
        v = res[k]
        return v is not None and (v >= OK[k] if k in ("cfi", "tli") else v <= OK[k])
    keys = ("cfi", "tli", "rmsea", "srmr")
    if all(good(k) for k in keys):
        return "good"
    if all(ok(k) for k in keys):
        return "acceptable"
    return "poor"


def _warnings(b, res, load_recs, resid_recs, cov_recs, var_recs, n, dropped) -> None:
    if n < FACTOR_N:
        b.warn(warning("factor_sample_size", "caution", f"Only {n} people had every item answered. CFA needs about "
                       f"{FACTOR_N} or more for trustworthy fit indices and estimates; with fewer, the fit indices can "
                       "look better or worse than they really are."))
    heywood = [r["label"] for r in resid_recs if r["estimate"] < 0] + \
        [r["label"] for r in load_recs if abs(r["std"]) > 1] + \
        [f"{r['factor_a']} with {r['factor_b']}" for r in cov_recs if abs(r["std"]) > 1] + \
        [r["factor"] for r in var_recs if r["estimate"] < 0]
    if heywood:
        b.warn(warning("heywood_case", "serious", f"Impossible estimates (a Heywood case: a negative variance or a "
                       f"standardized value above 1) for {', '.join(dict.fromkeys(heywood))}. The model is probably "
                       "misspecified or the sample is too small; don't interpret it as it stands."))
    if not res["converged"]:
        b.warn(warning("not_converged", "serious", "The model did not converge, so its estimates and fit can't be "
                       "trusted. Check the model (each factor needs enough items) or collect more data."))
    if res["df"] == 0:
        b.warn(warning("saturated_model", "info", "This model has zero degrees of freedom, so it reproduces the data "
                       "exactly and its fit can't be tested. Add items to test the factor structure."))
    weak = [r["label"] for r in load_recs if abs(r["std"]) < 0.4]
    if weak:
        b.warn(warning("weak_loadings", "info", f"{', '.join(weak)} {'has' if len(weak) == 1 else 'have'} a standardized "
                       "loading below .40, so the factor explains little of "
                       f"{'this item' if len(weak) == 1 else 'these items'}."))
    if dropped:
        b.warn(warning("missing_data", "info", f"{dropped} people were left out because they skipped at least one "
                       "item (listwise deletion, lavaan's default for ML)."))


def _tables(b, res, load_recs, cov_recs, factors, scale) -> None:
    cols = [apa.column("item", "Factor and item", "left"), apa.column("b", Rich().i("B")), apa.column("se", Rich().i("SE")),
            apa.column("beta", Rich().i("β")), apa.column("p", Rich().i("p"))]
    rows = []
    for f in factors:
        rows.append(apa.row([apa.cell_text(f), apa.cell_empty(), apa.cell_empty(), apa.cell_empty(), apa.cell_empty()],
                            kind="section_header"))
        for r in (r for r in load_recs if r["factor"] == f):
            rows.append(apa.row([apa.cell_text(r["label"]), apa.cell_num(r["estimate"]),
                                 apa.cell_num(r["se"]) if r["se"] is not None else apa.cell_text(apa.EM_DASH),
                                 apa.cell_num(r["std"], bounded=True), apa.cell_p(r["p"]) if r["p"] is not None
                                 else apa.cell_text(apa.EM_DASH)], indent=1))
    note = Rich().t(f"n = {res['n']}. Maximum likelihood estimation. ").i("B").t(" = unstandardized loading; ").i("β") \
        .t(" = standardized loading. The first item of each factor was fixed to 1 to set its scale, so it has no ") \
        .i("SE").t(" or ").i("p").t(".")
    b.table(apa.table(f"Confirmatory Factor Analysis Loadings for {scale[0].upper() + scale[1:]}", cols, rows,
                      general_note=note))
    fcols = [apa.column("chi2", Rich().i("χ").sup("2")), apa.column("df", Rich().i("df")), apa.column("p", Rich().i("p")),
             apa.column("cfi", "CFI"), apa.column("tli", "TLI"), apa.column("rmsea", "RMSEA"),
             apa.column("ci", "RMSEA 90% CI"), apa.column("srmr", "SRMR")]
    frow = apa.row([apa.cell_num(res["chi2"]), apa.cell_df(res["df"]), apa.cell_p(res["p"]),
                    apa.cell_num(res["cfi"], bounded=True), apa.cell_num(res["tli"], bounded=True),
                    apa.cell_num(res["rmsea"], 3, bounded=True),
                    apa.cell_ci(res["rmsea_lower"], res["rmsea_upper"], 3, bounded=True),
                    apa.cell_num(res["srmr"], 3, bounded=True)])
    b.extra_table(apa.table("Model Fit", fcols, [frow], number=2,
                            general_note="Common guidelines (Hu & Bentler, 1999): CFI and TLI .95 or higher, RMSEA .06 "
                                         "or lower, SRMR .08 or lower indicate good fit."))
    if cov_recs:
        ccols = [apa.column("pair", "Factors", "left"), apa.column("r", Rich().i("r")), apa.column("se", Rich().i("SE")),
                 apa.column("p", Rich().i("p"))]
        crows = [apa.row([apa.cell_text(f"{r['factor_a']} with {r['factor_b']}"), apa.cell_num(r["std"], bounded=True),
                          apa.cell_num(r["std_se"]), apa.cell_p(r["std_p"])]) for r in cov_recs]
        b.extra_table(apa.table("Factor Correlations", ccols, crows, number=3))


def _text(b, res, load_recs, factors, scale) -> None:
    v = _verdict(res)
    m = len(factors)
    s = Rich().t(f"A {m}-factor confirmatory model fit the data {'well' if v == 'good' else ('acceptably' if v == 'acceptable' else 'poorly')}, ")
    s.i("χ").sup("2").t(f"({apa.df_text(res['df'])}, ").i("N").t(f" = {res['n']}) = {apa.num(res['chi2'])}, ").p(res["p"])
    s.t(f", CFI = {apa.no_zero(res['cfi'])}, TLI = {apa.no_zero(res['tli'])}, RMSEA = {apa.no_zero(res['rmsea'], 3)}, "
        f"90% CI {apa.ci_text(res['rmsea_lower'], res['rmsea_upper'], 3, True)}, SRMR = {apa.no_zero(res['srmr'], 3)}.")
    stds = [r["std"] for r in load_recs]
    s.t(f" Standardized loadings ranged from {apa.no_zero(min(stds))} to {apa.no_zero(max(stds))}.")
    word = {"good": "fits the data well", "acceptable": "fits the data acceptably",
            "poor": "does not fit the data well"}[v]
    summary = (f"The proposed structure for {scale} ({m} factor{'s' if m > 1 else ''}: "
               f"{'; '.join(f + ' = ' + ', '.join(r['label'] for r in load_recs if r['factor'] == f) for f in factors)}) "
               f"{word} by common guidelines (CFI {apa.no_zero(res['cfi'])}, RMSEA {apa.no_zero(res['rmsea'], 3)}, "
               f"SRMR {apa.no_zero(res['srmr'], 3)}). Standardized loadings show how strongly each item reflects its "
               f"factor; they ranged from {apa.no_zero(min(stds))} to {apa.no_zero(max(stds))}.")
    if v == "poor":
        summary += (" Poor fit means the items don't group the way the model says; an exploratory factor analysis can "
                    "suggest a better structure.")
    b.sentence(s).summary(summary)
