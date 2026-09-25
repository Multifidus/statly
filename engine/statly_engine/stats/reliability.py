"""Reliability (SPEC §8 "Reliability"). Reference: fixtures/r/reliability.R.

Conventions:
- Items are numeric columns scored in the same direction. Items with no variance are removed with a
  warning (psych::alpha delete = TRUE). Missing answers: alpha, KR-20 and omega use pairwise-complete
  covariances / correlations (psych's default use = "pairwise"); split-half and item analysis need
  every item's total, so they use complete cases and report how many were dropped.
- cronbach_alpha matches psych::alpha(check.keys = FALSE): raw alpha (headline), standardized alpha,
  average inter-item r, alpha-if-item-deleted (raw and standardized; needs >= 3 items) and the
  corrected item-total r (psych r.drop, from the pairwise covariance matrix). The 95% CI is Feldt's
  F-based interval (psych "feldt"), with n = respondents who answered at least one item.
- kr20 is alpha on items scored 0/1, which equals the KR-20 formula exactly.
- mcdonald_omega is psych::omega(nfactors = 1) omega_total: a one-factor minimum-residual fit to the
  pairwise correlation matrix, solved in-house as the principal-axis fixed point that psych's
  optimiser converges to (uniquenesses >= .005, psych's floor; see minres_one_factor); items loading
  negatively are flipped as psych does. omega_total = (Vt - sum u²) / Vt and omega_h = (sum lambda)² / Vt, with Vt
  the sum of the (flipped) correlation matrix. No CI (none exists short of the bootstrap).
- split_half: odd/even split is the headline (options.split = "first_second" for first half vs
  second half, first = ceiling(k/2) items). Spearman-Brown 2r / (1 + r) and the Guttman
  (Flanagan-Rulon) coefficient; halves of unequal length when k is odd.
- item_analysis: 0/1 items, complete cases. Difficulty = proportion correct; discrimination =
  corrected item-total point-biserial and the upper-lower index D = p(upper) - p(lower), groups =
  total score >= 73rd / <= 27th percentile (R quantile type 7, ties included).
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy import stats

from statly_engine.errors import InvalidParams
from statly_engine.stats import apa, prep
from statly_engine.stats.apa import Rich
from statly_engine.stats.core import SMALL_N, ResultBuilder, finite, warning
from statly_engine.stats.descriptives import cell
from statly_engine.stats.effect_sizes import Estimate
from statly_engine.stats.registry import Role, register

HEYWOOD = 0.995   # psych fa: uniquenesses >= .005
_ITEMS = [Role("items", 2, None, "Two or more items of the same scale, scored in the same direction")]


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------
def _items(df, request, meta, min_items: int = 2) -> dict:
    names = list(dict.fromkeys(request.variables["items"]))
    if len(names) < min_items:
        raise InvalidParams(f"This analysis needs at least {min_items} different items.")
    x = np.column_stack([prep.numeric(df, v, meta).to_numpy() for v in names])
    has_any = np.isfinite(x).any(axis=1)
    return {"names": names, "labels": [prep.label(meta, v) for v in names], "x": x[has_any],
            "n_excluded": int((~has_any).sum()), "scale": request.options.get("scale_name") or "the scale"}


def _drop_constant(d: dict, b: ResultBuilder) -> dict:
    x = d["x"]
    with np.errstate(all="ignore"):
        sd = np.array([np.nanstd(c[np.isfinite(c)], ddof=1) if np.isfinite(c).sum() > 1 else np.nan for c in x.T])
    bad = ~(sd > 0)
    if bad.any():
        gone = [d["labels"][i] for i in np.flatnonzero(bad)]
        b.warn(warning("zero_variance_items", "caution", f"{', '.join(gone)} had the same answer from everyone, so "
                       f"{'it was' if len(gone) == 1 else 'they were'} left out (an item with no variation can't "
                       "contribute to reliability)."))
        keep = ~bad
        d = {**d, "x": x[:, keep], "names": [n for n, k in zip(d["names"], keep) if k],
             "labels": [n for n, k in zip(d["labels"], keep) if k]}
    if len(d["names"]) < 2:
        raise InvalidParams("Fewer than two items vary, so reliability can't be estimated.")
    return d


def _complete(d: dict) -> tuple[np.ndarray, int]:
    ok = np.isfinite(d["x"]).all(axis=1)
    return d["x"][ok], int((~ok).sum())


def pairwise_cov_cor(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """cov / cor with use = "pairwise" (each pair's complete cases, n - 1)."""
    frame = pd.DataFrame(x)
    return frame.cov().to_numpy(), frame.corr().to_numpy()


# ---------------------------------------------------------------------------
# Coefficients
# ---------------------------------------------------------------------------
def alpha_from(c: np.ndarray, r: np.ndarray | None = None) -> tuple[float, float | None]:
    """psych:::alpha.1 raw and standardized alpha."""
    k = c.shape[0]
    raw = (1 - np.trace(c) / c.sum()) * k / (k - 1)
    std = (1 - k / r.sum()) * k / (k - 1) if r is not None else None
    return float(raw), (float(std) if std is not None else None)


def feldt_ci(alpha: float, n: int, k: int, level: float = 0.95) -> tuple[float, float]:
    """psych::alpha.ci: 1 - (1 - alpha) F quantiles on (n - 1, (n - 1)(k - 1)) df."""
    p = 1 - level
    d1, d2 = n - 1, (n - 1) * (k - 1)
    return (1 - (1 - alpha) * stats.f.ppf(1 - p / 2, d1, d2), 1 - (1 - alpha) * stats.f.ppf(p / 2, d1, d2))


def alpha_analysis(x: np.ndarray, level: float = 0.95) -> dict:
    c, r = pairwise_cov_cor(x)
    if not (np.all(np.isfinite(c)) and np.all(np.isfinite(r))):
        raise InvalidParams("Some pairs of items have fewer than two people answering both, so their relationship "
                            "can't be estimated.")
    k, n = x.shape[1], x.shape[0]
    raw, std = alpha_from(c, r)
    av_r = (r.sum() - k) / (k * (k - 1))
    lo, hi = feldt_ci(raw, n, k, level) if n > 1 else (None, None)
    items = []
    for i in range(k):
        keep = [j for j in range(k) if j != i]
        v_drop = c[np.ix_(keep, keep)].sum()
        c_drop = c[:, i].sum() - c[i, i]
        col = x[:, i][np.isfinite(x[:, i])]
        rec = {"n": int(len(col)), "mean": float(np.mean(col)), "sd": float(np.std(col, ddof=1)),
               "r_drop": float(c_drop / math.sqrt(c[i, i] * v_drop)) if v_drop > 0 else None,
               "alpha_if_deleted": None, "std_alpha_if_deleted": None}
        if k >= 3:
            a_raw, a_std = alpha_from(c[np.ix_(keep, keep)], r[np.ix_(keep, keep)])
            rec.update(alpha_if_deleted=a_raw, std_alpha_if_deleted=a_std)
        items.append(rec)
    return {"alpha": raw, "std_alpha": std, "average_r": float(av_r), "lower": lo, "upper": hi, "n": n, "k": k,
            "items": items}


def minres_one_factor(r: np.ndarray, tol: float = 1e-14, max_iter: int = 200_000) -> np.ndarray:
    """One-factor minimum-residual loadings as psych::fa(fm = "minres").

    psych optimises the uniquenesses psi in [.005, 1] (L-BFGS-B, gradient diag(lambda lambda' + psi - R)),
    with loadings = sqrt(e1) v1 of R whose diagonal is 1 - psi. Its stationary point is the
    principal-axis fixed point lambda_i² = 1 - psi_i (= the minimum of the off-diagonal residuals), with
    psi clamped at .005 in a Heywood case, where a loading can then exceed 1. We iterate to that fixed
    point directly (tolerance 1e-14) instead of stopping at an optimiser tolerance.
    """
    k = r.shape[0]
    try:
        smc = 1 - 1 / np.diag(np.linalg.inv(r))
    except np.linalg.LinAlgError:
        smc = np.full(k, 0.5)
    psi = np.clip(1 - smc, 1 - HEYWOOD, 1.0)
    lam = np.zeros(k)
    for _ in range(max_iter):
        rs = r.copy()
        np.fill_diagonal(rs, 1 - psi)
        w, v = np.linalg.eigh(rs)
        lam = v[:, -1] * math.sqrt(max(w[-1], 100 * np.finfo(float).eps))
        new = np.clip(1 - lam ** 2, 1 - HEYWOOD, 1.0)
        if np.max(np.abs(new - psi)) < tol:
            psi = new
            break
        psi = new
    return -lam if lam.sum() < 0 else lam


def omega_analysis(x: np.ndarray) -> dict:
    _, r = pairwise_cov_cor(x)
    if not np.all(np.isfinite(r)):
        raise InvalidParams("Some pairs of items have fewer than two people answering both, so omega can't be "
                            "estimated.")
    lam = minres_one_factor(r)
    key = np.where(lam < 0, -1.0, 1.0)
    rf = r * np.outer(key, key)
    lam = np.abs(lam)
    vt = rf.sum()
    k = len(lam)
    u2 = 1 - lam ** 2          # psych: diag(model) - h2, negative in a Heywood case
    return {"omega_total": float((vt - u2.sum()) / vt), "omega_h": float(lam.sum() ** 2 / vt),
            "alpha_std": float((vt - k) / vt * k / (k - 1)), "loadings": lam, "u2": u2,
            "flipped": [bool(s < 0) for s in key]}


def split_half_stats(x: np.ndarray, a_idx, b_idx) -> dict:
    a, b = x[:, a_idx].sum(axis=1), x[:, b_idx].sum(axis=1)
    t = a + b
    out = {"r": None, "spearman_brown": None, "guttman": None}
    if np.ptp(a) > 0 and np.ptp(b) > 0:
        r = float(np.corrcoef(a, b)[0, 1])
        out.update(r=r, spearman_brown=2 * r / (1 + r))
    vt = np.var(t, ddof=1)
    if vt > 0:
        out["guttman"] = float(2 * (1 - (np.var(a, ddof=1) + np.var(b, ddof=1)) / vt))
    return out


# ---------------------------------------------------------------------------
# Plain-language helpers
# ---------------------------------------------------------------------------
def _quality(a) -> str:
    """George & Mallery (2003) rule-of-thumb labels."""
    if not finite(a):
        return "not computable"
    for cut, word in ((0.9, "excellent"), (0.8, "good"), (0.7, "acceptable"), (0.6, "questionable"), (0.5, "poor")):
        if a >= cut:
            return word
    return "unacceptable"


_QUALITY_NOTE = ("These labels (George & Mallery, 2003) are rules of thumb: .70 or higher is usually acceptable "
                 "for research, while decisions about individual students call for .90 or higher.")


def _common_warnings(b: ResultBuilder, n: int, k: int, n_excl: int, what: str = "rows"):
    if k < 3:
        b.warn(warning("few_items", "caution", f"Only {k} items were analysed. Reliability estimates from so few "
                       "items are unstable and tend to be low."))
    if n < SMALL_N:
        b.warn(warning("small_sample", "caution", f"Only {n} people were analysed. With fewer than {SMALL_N}, "
                       "reliability estimates can change a lot from sample to sample; look at the interval."))
    if n_excl:
        b.warn(warning("missing_data", "info", f"{n_excl} {what} were left out because answers needed for this "
                       "analysis were missing."))


def _run_alpha(df, request, meta, key: str, label: str, binary: bool) -> dict:
    level = request.ci_level
    sym = "KR-20" if binary else "α"
    b = ResultBuilder(request)
    d = _items(df, request, meta)
    if binary:
        vals = d["x"][np.isfinite(d["x"])]
        if not np.all(np.isin(vals, (0.0, 1.0))):
            raise InvalidParams("KR-20 is for right/wrong items scored 0 and 1. Some of these items have other "
                                "values; use Cronbach's alpha instead (or score the items first).")
    d = _drop_constant(d, b)
    res = alpha_analysis(d["x"], level)
    k, n = res["k"], res["n"]
    b.statistic(key, label, sym, res["alpha"])
    b.statistic("alpha_standardized", "Standardized alpha (from correlations)", "α", res["std_alpha"])
    b.statistic("average_r", "Average inter-item correlation", "r", res["average_r"])
    b.effect(key, f"{label} (Feldt CI)", sym, Estimate(res["alpha"], res["lower"], res["upper"], level))
    b.descriptives([cell(v, {}, lab, d["x"][:, i], level) for i, (v, lab) in enumerate(zip(d["names"], d["labels"]))])
    b.chart("item_statistics", [{"item": v, "label": lab, **it} for v, lab, it in zip(d["names"], d["labels"], res["items"])])

    neg = [lab for lab, it in zip(d["labels"], res["items"]) if finite(it["r_drop"]) and it["r_drop"] < 0]
    if neg:
        b.warn(warning("reverse_scoring", "caution", f"{', '.join(neg)} {'goes' if len(neg) == 1 else 'go'} against the "
                       "rest of the scale (negative item-total correlation). If these are negatively worded items, "
                       "reverse-score them before computing reliability."))
    if res["alpha"] < 0:
        b.warn(warning("negative_alpha", "serious", "Alpha is below zero, which means the items do not hang together "
                       "at all. Check for items that need reverse-scoring."))
    _common_warnings(b, n, k, d["n_excluded"])
    if np.isnan(d["x"]).any():
        b.warn(warning("missing_data", "info", "Some answers were missing. Each pair of items used everyone who "
                       "answered both (pairwise), as the psych package does."))
    b.inputs(n, d["n_excluded"])

    cols = [apa.column("item", "Item", "left"), apa.column("m", Rich().i("M")), apa.column("sd", Rich().i("SD")),
            apa.column("r", Rich().t("Corrected item-total ").i("r")),
            apa.column("aid", Rich().i("α").t(" if item deleted"))]
    rows = [apa.row([apa.cell_text(lab), apa.cell_num(it["mean"]), apa.cell_num(it["sd"]),
                     apa.cell_num(it["r_drop"], bounded=True), apa.cell_num(it["alpha_if_deleted"], bounded=True)])
            for lab, it in zip(d["labels"], res["items"])]
    note = Rich().t(f"{k} items, n = {n}. ")
    note = (note.t("KR-20") if binary else note.t("Cronbach's ").i("α")).t(f" = {apa.no_zero(res['alpha'])}, "
                                                               f"{apa.level_text(level)} CI "
                                                               f"{apa.ci_text(res['lower'], res['upper'], 2, True)} (Feldt); standardized ")
    note.i("α").t(f" = {apa.no_zero(res['std_alpha'])}; average inter-item ").i("r").t(f" = {apa.no_zero(res['average_r'])}.")
    b.table(apa.table(f"Item-Total Statistics for {d['scale'][0].upper() + d['scale'][1:]}", cols, rows,
                      general_note=note))
    q = _quality(res["alpha"])
    s = Rich().t(f"The {k}-item scale showed {q} internal consistency, ")
    s = s.t("KR-20") if binary else s.t("Cronbach's ").i("α")
    s.t(f" = {apa.no_zero(res['alpha'])}, {apa.level_text(level)} CI {apa.ci_text(res['lower'], res['upper'], 2, True)}.")
    weakest = min(((lab, it) for lab, it in zip(d["labels"], res["items"]) if finite(it["r_drop"])),
                  key=lambda t: t[1]["r_drop"], default=None)
    summary = (f"The items of {d['scale']} hang together {'well' if res['alpha'] >= 0.7 else 'poorly'}: "
               f"{label} is {apa.no_zero(res['alpha'])}, which is {q} by common rules of thumb. {_QUALITY_NOTE}")
    if weakest and k >= 3:
        summary += (f" The item that fits least well is {weakest[0]} (item-total r = {apa.no_zero(weakest[1]['r_drop'])});"
                    f" removing it would give {apa.no_zero(weakest[1]['alpha_if_deleted'])}.")
    b.sentence(s).summary(summary)
    return b.build()


@register("reliability.cronbach_alpha", label="Cronbach's alpha", roles=_ITEMS,
          options={"scale_name": "Name of the scale for tables and text (default \"the scale\")."})
def cronbach_alpha(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    return _run_alpha(df, request, meta, "cronbach_alpha", "Cronbach's alpha", binary=False)


@register("reliability.kr20", label="KR-20 (right/wrong items)", roles=_ITEMS,
          options={"scale_name": "Name of the test for tables and text (default \"the scale\")."})
def kr20(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    return _run_alpha(df, request, meta, "kr20", "KR-20", binary=True)


# ---------------------------------------------------------------------------
# Omega
# ---------------------------------------------------------------------------
@register("reliability.mcdonald_omega", label="McDonald's omega",
          roles=[Role("items", 3, None, "Three or more items of the same scale")],
          options={"scale_name": "Name of the scale for tables and text (default \"the scale\")."})
def mcdonald_omega(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    b = ResultBuilder(request)
    d = _drop_constant(_items(df, request, meta, min_items=3), b)
    if len(d["names"]) < 3:
        raise InvalidParams("Omega needs at least three items that vary.")
    res = omega_analysis(d["x"])
    n, k = d["x"].shape
    b.statistic("omega_total", "McDonald's omega (total)", "ω", res["omega_total"])
    b.statistic("omega_h", "Omega hierarchical (one factor)", "ωh", res["omega_h"])
    b.statistic("alpha_standardized", "Standardized alpha (for comparison)", "α", res["alpha_std"])
    b.descriptives([cell(v, {}, lab, d["x"][:, i], request.ci_level) for i, (v, lab) in enumerate(zip(d["names"], d["labels"]))])
    b.chart("loadings", [{"item": v, "label": lab, "loading": float(l), "h2": float(1 - u), "u2": float(u),
                          "flipped": f} for v, lab, l, u, f in zip(d["names"], d["labels"], res["loadings"],
                                                                     res["u2"], res["flipped"])])
    flipped = [lab for lab, f in zip(d["labels"], res["flipped"]) if f]
    if flipped:
        b.warn(warning("reverse_scoring", "caution", f"{', '.join(flipped)} loaded negatively on the common factor, "
                       "so omega treats them as reverse-worded (as the psych package does). Reverse-score them in "
                       "your data so every analysis agrees."))
    if np.any(res["loadings"] ** 2 >= HEYWOOD - 1e-9):
        b.warn(warning("heywood_case", "caution", "An item's loading reached its upper limit (a Heywood case), which "
                       "usually means too few people or items; treat omega with caution."))
    _common_warnings(b, n, k, d["n_excluded"])
    if n < 100:
        b.warn(warning("factor_sample_size", "info", f"Omega comes from a factor model, which is more stable with "
                       f"100 or more people (here {n})."))
    b.inputs(n, d["n_excluded"])

    cols = [apa.column("item", "Item", "left"), apa.column("l", "Loading"), apa.column("h2", Rich().i("h").sup("2")),
            apa.column("u2", Rich().i("u").sup("2"))]
    rows = [apa.row([apa.cell_text(lab + (" (reversed)" if f else "")), apa.cell_num(float(l), bounded=True),
                     apa.cell_num(float(1 - u), bounded=True), apa.cell_num(float(u), bounded=True)])
            for lab, l, u, f in zip(d["labels"], res["loadings"], res["u2"], res["flipped"])]
    note = Rich().t("One-factor minimum-residual solution. ").i("h").sup("2").t(" = communality; ").i("u").sup("2") \
        .t(" = uniqueness. ").i("ω").t(f" total = {apa.no_zero(res['omega_total'])}; ").i("ω").sub("h") \
        .t(f" = {apa.no_zero(res['omega_h'])}.")
    b.table(apa.table(f"Factor Loadings for {d['scale'][0].upper() + d['scale'][1:]}", cols, rows, general_note=note))
    q = _quality(res["omega_total"])
    s = Rich().t(f"The {k}-item scale showed {q} reliability, McDonald's ").i("ω").t(f" = {apa.no_zero(res['omega_total'])}.")
    summary = (f"Omega estimates how much of the total score reflects one shared trait. For {d['scale']} it is "
               f"{apa.no_zero(res['omega_total'])}, which is {q} by common rules of thumb. {_QUALITY_NOTE}")
    b.sentence(s).summary(summary)
    return b.build()


# ---------------------------------------------------------------------------
# Split-half
# ---------------------------------------------------------------------------
@register("reliability.split_half", label="Split-half reliability (Spearman-Brown)", roles=_ITEMS,
          options={"split": "\"odd_even\" (default) or \"first_second\" (first half of the items vs the second).",
                   "scale_name": "Name of the scale for tables and text."})
def split_half(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    split = request.options.get("split", "odd_even")
    if split not in ("odd_even", "first_second"):
        raise InvalidParams("options.split must be \"odd_even\" or \"first_second\".")
    b = ResultBuilder(request)
    d = _items(df, request, meta)
    x, dropped = _complete(d)
    n, k = x.shape
    if n < 3:
        raise InvalidParams(f"Split-half reliability needs at least 3 people who answered every item; there are {n}.")
    h = math.ceil(k / 2)
    splits = {"odd_even": (list(range(0, k, 2)), list(range(1, k, 2))),
              "first_second": (list(range(h)), list(range(h, k)))}
    order = [split] + [s for s in splits if s != split]
    results = {s: split_half_stats(x, *splits[s]) for s in splits}
    names = {"odd_even": "odd-even", "first_second": "first-second"}
    for s in order:
        r = results[s]
        b.statistic(f"spearman_brown_{s}", f"Spearman-Brown ({names[s]} split)", "rSB", r["spearman_brown"])
        b.statistic(f"guttman_{s}", f"Guttman split-half ({names[s]} split)", "λ4", r["guttman"])
        b.statistic(f"r_halves_{s}", f"Correlation between halves ({names[s]})", "r", r["r"])
    b.chart("split_half", [{"split": names[s], "r_halves": results[s]["r"], "spearman_brown": results[s]["spearman_brown"],
                            "guttman": results[s]["guttman"],
                            "half_a": ", ".join(d["labels"][i] for i in splits[s][0]),
                            "half_b": ", ".join(d["labels"][i] for i in splits[s][1])} for s in order])
    head = results[split]
    if head["spearman_brown"] is None:
        b.warn(warning("constant_variable", "serious", "One half of the items gives everyone the same total, so the "
                       "halves can't be correlated."))
    if k % 2:
        b.warn(warning("unequal_halves", "info", f"With {k} items the halves have {h} and {k - h} items; the "
                       "Spearman-Brown formula assumes equal halves, so the Guttman coefficient is the safer figure."))
    _common_warnings(b, n, k, dropped + d["n_excluded"], "people")
    b.inputs(n, dropped + d["n_excluded"])

    cols = [apa.column("split", "Split", "left"), apa.column("r", Rich().i("r").t(" between halves")),
            apa.column("sb", "Spearman-Brown"), apa.column("g", "Guttman")]
    rows = [apa.row([apa.cell_text(names[s].capitalize()), apa.cell_num(results[s]["r"], bounded=True),
                     apa.cell_num(results[s]["spearman_brown"], bounded=True),
                     apa.cell_num(results[s]["guttman"], bounded=True)]) for s in order]
    b.table(apa.table(f"Split-Half Reliability of {d['scale'][0].upper() + d['scale'][1:]}", cols, rows,
                      general_note=f"{k} items, n = {n} people with every item answered."))
    sb = head["spearman_brown"]
    q = _quality(sb)
    s = Rich().t(f"Split-half reliability ({names[split]} split) with the Spearman-Brown correction was ")
    s.i("r").sub("SB").t(f" = {apa.no_zero(sb)}, indicating {q} reliability.")
    summary = (f"Scores on the two halves of {d['scale']} ({names[split]} items) agree"
               f"{' closely' if finite(sb) and sb >= 0.7 else ' only weakly'}; corrected to the full length, "
               f"reliability is {apa.no_zero(sb)} ({q} by common rules of thumb). {_QUALITY_NOTE}")
    b.sentence(s).summary(summary)
    return b.build()


# ---------------------------------------------------------------------------
# Item analysis
# ---------------------------------------------------------------------------
def item_analysis_stats(x: np.ndarray) -> dict:
    total = x.sum(axis=1)
    up = total >= np.percentile(total, 73)
    lo = total <= np.percentile(total, 27)
    k = x.shape[1]
    c = np.cov(x, rowvar=False)
    vt = np.var(total, ddof=1)
    kr = k / (k - 1) * (1 - np.trace(c) / vt) if vt > 0 else None
    items = []
    for i in range(k):
        it = x[:, i]
        rest = total - it
        rpb = float(np.corrcoef(it, rest)[0, 1]) if np.ptp(it) > 0 and np.ptp(rest) > 0 else None
        keep = [j for j in range(k) if j != i]
        aid = alpha_from(c[np.ix_(keep, keep)])[0] if k >= 3 and c[np.ix_(keep, keep)].sum() > 0 else None
        items.append({"difficulty": float(it.mean()), "r_pb_corrected": rpb,
                      "d_index": float(it[up].mean() - it[lo].mean()), "alpha_if_deleted": aid})
    return {"kr20": kr, "items": items, "n_upper": int(up.sum()), "n_lower": int(lo.sum())}


def _flag(it: dict) -> str:
    flags = []
    if it["difficulty"] < 0.2:
        flags.append("very hard")
    elif it["difficulty"] > 0.9:
        flags.append("very easy")
    r = it["r_pb_corrected"]
    if r is None:
        flags.append("no variation")
    elif r < 0:
        flags.append("negative discrimination: check the answer key")
    elif r < 0.2:
        flags.append("weak discrimination")
    return "; ".join(flags)


@register("reliability.item_analysis", label="Test item analysis (difficulty and discrimination)", roles=_ITEMS,
          options={"scale_name": "Name of the test for tables and text."})
def item_analysis(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    b = ResultBuilder(request)
    d = _items(df, request, meta)
    vals = d["x"][np.isfinite(d["x"])]
    if not np.all(np.isin(vals, (0.0, 1.0))):
        raise InvalidParams("Item analysis needs items scored 0 (wrong) and 1 (right). Score the answers against the "
                            "answer key first.")
    x, dropped = _complete(d)
    n, k = x.shape
    if n < 3:
        raise InvalidParams(f"Item analysis needs at least 3 people who answered every item; there are {n}.")
    res = item_analysis_stats(x)
    items = res["items"]
    b.statistic("kr20", "KR-20 (complete cases)", "KR-20", res["kr20"])
    b.statistic("mean_difficulty", "Average difficulty (proportion correct)", "p", float(np.mean([i["difficulty"] for i in items])))
    rpbs = [i["r_pb_corrected"] for i in items if i["r_pb_corrected"] is not None]
    b.statistic("mean_discrimination", "Average corrected item-total r", "rpb", float(np.mean(rpbs)) if rpbs else None)
    b.chart("item_analysis", [{"item": v, "label": lab, **it, "flag": _flag(it)}
                              for v, lab, it in zip(d["names"], d["labels"], items)])
    b.chart("total_scores", [{"total": float(t)} for t in x.sum(axis=1)])
    flagged = [lab for lab, it in zip(d["labels"], items) if it["r_pb_corrected"] is not None and it["r_pb_corrected"] < 0]
    if flagged:
        b.warn(warning("negative_discrimination", "caution", f"{', '.join(flagged)}: people who did well on the rest "
                       "of the test got these wrong more often. Check the answer key and the wording."))
    _common_warnings(b, n, k, dropped + d["n_excluded"], "people")
    b.inputs(n, dropped + d["n_excluded"])

    cols = [apa.column("item", "Item", "left"), apa.column("p", Rich().i("p")),
            apa.column("rpb", Rich().i("r").sub("pb")), apa.column("d", Rich().i("D")),
            apa.column("aid", Rich().t("KR-20 if deleted")), apa.column("flag", "Flag", "left")]
    rows = [apa.row([apa.cell_text(lab), apa.cell_num(it["difficulty"], bounded=True),
                     apa.cell_num(it["r_pb_corrected"], bounded=True), apa.cell_num(it["d_index"], bounded=True),
                     apa.cell_num(it["alpha_if_deleted"], bounded=True), apa.cell_text(_flag(it) or apa.EM_DASH)])
            for lab, it in zip(d["labels"], items)]
    note = Rich().i("p").t(" = difficulty (proportion correct); ").i("r").sub("pb").t(
        " = corrected item-total point-biserial correlation; ").i("D").t(
        f" = upper-lower discrimination index (top {res['n_upper']} vs bottom {res['n_lower']} total scores, "
        f"about 27% each). n = {n}.")
    b.table(apa.table(f"Item Analysis for {d['scale'][0].upper() + d['scale'][1:]}", cols, rows, general_note=note))
    hard = sum(it["difficulty"] < 0.2 for it in items)
    easy = sum(it["difficulty"] > 0.9 for it in items)
    weak = sum(it["r_pb_corrected"] is None or it["r_pb_corrected"] < 0.2 for it in items)
    s = Rich().t(f"Across {k} items, difficulty ranged from {apa.no_zero(min(i['difficulty'] for i in items))} to "
                 f"{apa.no_zero(max(i['difficulty'] for i in items))} and KR-20 was {apa.no_zero(res['kr20'])} (").i("n") \
        .t(f" = {n}).")
    summary = (f"On average people answered {apa.num(100 * np.mean([i['difficulty'] for i in items]), 0)}% of the items "
               f"correctly. {hard} item(s) were very hard (under 20% correct), {easy} very easy (over 90%), and {weak} "
               "did a weak job of separating stronger from weaker students (item-total r under .20). "
               "Items with weak or negative discrimination are the first to review.")
    b.sentence(s).summary(summary)
    return b.build()
