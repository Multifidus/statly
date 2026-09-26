"""Relationship charts: scatter with an OLS (or LOWESS) fit line, and correlation matrix heatmap."""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats

from statly_engine.charts.common import cust, fields, group_frame, iter_groups, need, num
from statly_engine.stats import prep


def ols(x: np.ndarray, y: np.ndarray) -> dict:
    """Least-squares y = intercept + slope * x, with Pearson r."""
    n = len(x)
    mx, my = x.mean(), y.mean()
    sxx = float(((x - mx) ** 2).sum())
    syy = float(((y - my) ** 2).sum())
    sxy = float(((x - mx) * (y - my)).sum())
    slope = sxy / sxx if sxx > 0 else float("nan")
    r = sxy / np.sqrt(sxx * syy) if sxx > 0 and syy > 0 else float("nan")
    return {"n": int(n), "slope": num(slope), "intercept": num(my - slope * mx), "r": num(r),
            "r2": num(r * r)}


def scatter(df: pd.DataFrame, spec: dict, meta: dict | None):
    xs, ys = fields(spec, "x"), fields(spec, "y")
    need(len(xs) == 1 and len(ys) == 1, "Put one number variable on X and one on Y to draw a scatter plot.")
    x = prep.numeric(df, xs[0], meta).to_numpy()
    y = prep.numeric(df, ys[0], meta).to_numpy()
    keys, levels, labels = group_frame(df, spec, meta)
    labels["x"], labels["y"] = prep.label(meta, xs[0]), prep.label(meta, ys[0])
    fit_kind = cust(spec, "fit_line", "linear")
    rows, fits = [], []
    used = np.zeros(len(df), dtype=bool)
    for key, mask in iter_groups(keys, levels):
        m = mask & np.isfinite(x) & np.isfinite(y)
        used |= m
        gx, gy = x[m], y[m]
        rows += [{**key, "x": float(a), "y": float(b)} for a, b in zip(gx, gy)]
        if len(gx) < 3 or fit_kind == "none":
            continue
        f = {**key, **ols(gx, gy), "x_min": float(gx.min()), "x_max": float(gx.max())}
        if fit_kind == "loess" and np.ptp(gx) > 0:
            from statsmodels.nonparametric.smoothers_lowess import lowess
            sm = lowess(gy, gx, frac=0.75, return_sorted=True)
            f["points"] = [{"x": float(a), "y": float(b)} for a, b in sm]
        elif f["slope"] is not None:
            f["points"] = [{"x": v, "y": f["intercept"] + f["slope"] * v} for v in (f["x_min"], f["x_max"])]
        fits.append(f)
    need(bool(rows), "No rows have both of these variables filled in.")
    return rows, {"levels": levels, "labels": labels, "fits": fits, "fit_line": fit_kind,
                  "n_used": int(used.sum()), "n_excluded": int(len(df) - used.sum())}


def correlation(df: pd.DataFrame, spec: dict, meta: dict | None):
    names = list(dict.fromkeys(fields(spec, "x") + fields(spec, "y")))
    need(len(names) >= 2, "Put two or more number variables on the X shelf to draw a correlation heatmap.")
    method = cust(spec, "correlation_method", "pearson")
    need(method in ("pearson", "spearman"), "The correlation method must be Pearson or Spearman.")
    cols = {n: prep.numeric(df, n, meta).to_numpy() for n in names}
    labels = [prep.label(meta, n) for n in names]
    rows = []
    for i, a in enumerate(names):
        for j, b in enumerate(names):
            m = np.isfinite(cols[a]) & np.isfinite(cols[b])
            n = int(m.sum())
            if i == j:
                r = 1.0 if n else None
            elif n < 3 or np.ptp(cols[a][m]) == 0 or np.ptp(cols[b][m]) == 0:
                r = None
            elif method == "spearman":
                r = num(stats.spearmanr(cols[a][m], cols[b][m]).statistic)
            else:
                r = num(np.corrcoef(cols[a][m], cols[b][m])[0, 1])
            rows.append({"row": labels[i], "col": labels[j], "row_variable": a, "col_variable": b,
                         "row_index": i, "col_index": j, "r": r, "n": n})
    any_ok = np.zeros(len(df), dtype=bool)
    for v in cols.values():
        any_ok |= np.isfinite(v)
    return rows, {"levels": {"row": labels, "col": labels}, "labels": {"value": f"{method.title()} r"},
                  "method": method, "n_used": int(any_ok.sum()), "n_excluded": int(len(df) - any_ok.sum())}
