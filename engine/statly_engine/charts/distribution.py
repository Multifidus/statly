"""Distribution charts: histogram (Freedman-Diaconis bins), KDE density, normal Q-Q, box plot
(Tukey 1.5 IQR whiskers) and violin (KDE + box summary)."""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats

from statly_engine.charts.common import cust, fields, group_frame, iter_groups, need, num
from statly_engine.stats import prep
from statly_engine.stats.assumptions import qq_points

GRID = 128


def _value_var(spec: dict, what: str) -> str:
    xs, ys = fields(spec, "x"), fields(spec, "y")
    var = (xs or ys or [None])[0]
    need(var is not None, f"Put a number variable on the X shelf to draw a {what}.")
    return var


def bin_edges(x: np.ndarray, bins=None) -> np.ndarray:
    """Freedman-Diaconis edges (numpy 'fd'); Sturges when the IQR is 0; `bins` = explicit count."""
    x = x[np.isfinite(x)]
    if len(x) == 0:
        return np.array([0.0, 1.0])
    if np.ptp(x) == 0:
        return np.array([x[0] - 0.5, x[0] + 0.5])
    if bins:
        return np.histogram_bin_edges(x, bins=int(bins))
    q75, q25 = np.percentile(x, [75, 25])
    return np.histogram_bin_edges(x, bins="fd" if q75 > q25 else "sturges")


def scott_bandwidth(x: np.ndarray) -> float:
    """Scott's rule as scipy.stats.gaussian_kde: n^(-1/5) * SD (n - 1)."""
    return float(len(x) ** (-1 / 5) * np.std(x, ddof=1))


def kde(x: np.ndarray, grid: np.ndarray, bw: float) -> np.ndarray:
    """Gaussian kernel density estimate at `grid` with bandwidth (kernel SD) `bw`."""
    z = (grid[:, None] - x[None, :]) / bw
    return np.exp(-0.5 * z ** 2).sum(axis=1) / (len(x) * bw * np.sqrt(2 * np.pi))


def box_stats(x: np.ndarray) -> dict:
    """Quartiles (type 7), Tukey whiskers = most extreme values within 1.5 IQR, outliers beyond."""
    x = np.sort(x[np.isfinite(x)])
    q1, med, q3 = np.percentile(x, [25, 50, 75])
    iqr = q3 - q1
    lo_f, hi_f = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    inside = x[(x >= lo_f) & (x <= hi_f)]
    return {"n": int(len(x)), "min": float(x[0]), "q1": float(q1), "median": float(med), "q3": float(q3),
            "max": float(x[-1]), "mean": float(np.mean(x)), "iqr": float(iqr),
            "whisker_low": float(inside.min()), "whisker_high": float(inside.max()),
            "outliers": [float(v) for v in x[(x < lo_f) | (x > hi_f)]]}


def _setup(df, spec, meta, what, x_is_group=False):
    group_x = x_is_group and bool(fields(spec, "y"))  # box/violin: Y = score, X = optional grouping
    var = fields(spec, "y")[0] if group_x else _value_var(spec, what)
    vals = prep.numeric(df, var, meta).to_numpy()
    extra = {}
    if group_x and fields(spec, "x"):
        extra["x"] = fields(spec, "x")[0]
    keys, levels, labels = group_frame(df, spec, meta, extra)
    labels["value"] = prep.label(meta, var)
    return var, vals, keys, levels, labels


def _finish(df, vals, keys, levels, labels, rows, extra=None):
    used = np.isfinite(vals) & keys.notna().all(axis=1).to_numpy() if len(keys.columns) else np.isfinite(vals)
    return rows, {"levels": levels, "labels": labels, "n_used": int(used.sum()),
                  "n_excluded": int(len(df) - used.sum()), **(extra or {})}


def histogram(df: pd.DataFrame, spec: dict, meta: dict | None):
    var, vals, keys, levels, labels = _setup(df, spec, meta, "histogram")
    ok = np.isfinite(vals) & (keys.notna().all(axis=1).to_numpy() if len(keys.columns) else True)
    edges = bin_edges(vals[ok], cust(spec, "bins"))
    rows = []
    for key, mask in iter_groups(keys, levels):
        x = vals[mask & np.isfinite(vals)]
        if len(x) == 0:
            continue
        c, _ = np.histogram(x, bins=edges)
        w = np.diff(edges)
        for i in range(len(c)):
            rows.append({**key, "bin_start": float(edges[i]), "bin_end": float(edges[i + 1]), "count": int(c[i]),
                         "percent": num(100 * c[i] / len(x)), "density": num(c[i] / (len(x) * w[i]))})
    return _finish(df, vals, keys, levels, labels, rows, {"bin_width": float(edges[1] - edges[0]),
                                                          "n_bins": int(len(edges) - 1)})


def density(df: pd.DataFrame, spec: dict, meta: dict | None):
    var, vals, keys, levels, labels = _setup(df, spec, meta, "density plot")
    adjust = float(cust(spec, "bandwidth_adjust", 1.0))
    groups = []
    for key, mask in iter_groups(keys, levels):
        x = vals[mask & np.isfinite(vals)]
        if len(x) >= 2 and np.ptp(x) > 0:
            groups.append((key, x, scott_bandwidth(x) * adjust))
    need(bool(groups), "A density curve needs at least two different values.")
    lo = min(x.min() - 3 * bw for _, x, bw in groups)
    hi = max(x.max() + 3 * bw for _, x, bw in groups)
    grid = np.linspace(lo, hi, GRID)
    rows = []
    bws = []
    for key, x, bw in groups:
        d = kde(x, grid, bw)
        bws.append({**key, "bandwidth": bw, "n": int(len(x))})
        rows += [{**key, "x": float(g), "density": float(v)} for g, v in zip(grid, d)]
    return _finish(df, vals, keys, levels, labels, rows, {"bandwidths": bws})


def qq(df: pd.DataFrame, spec: dict, meta: dict | None):
    var, vals, keys, levels, labels = _setup(df, spec, meta, "Q-Q plot")
    rows, lines = [], []
    for key, mask in iter_groups(keys, levels):
        x = vals[mask & np.isfinite(vals)]
        if len(x) < 3:
            continue
        pts = qq_points(x)
        rows += [{**key, **p} for p in pts]
        # Reference line through the quartiles, as R's qqline().
        yq = np.percentile(x, [25, 75])
        xq = stats.norm.ppf([0.25, 0.75])
        slope = float((yq[1] - yq[0]) / (xq[1] - xq[0]))
        icpt = float(yq[0] - slope * xq[0])
        t = [p["theoretical"] for p in pts]
        lines.append({**key, "slope": slope, "intercept": icpt, "x_min": min(t), "x_max": max(t)})
    need(bool(rows), "A Q-Q plot needs at least three scores in each group.")
    return _finish(df, vals, keys, levels, labels, rows, {"lines": lines})


def box(df: pd.DataFrame, spec: dict, meta: dict | None):
    var, vals, keys, levels, labels = _setup(df, spec, meta, "box plot", x_is_group=True)
    rows = []
    for key, mask in iter_groups(keys, levels):
        x = vals[mask & np.isfinite(vals)]
        if len(x) == 0:
            continue
        b = box_stats(x)
        outs = b.pop("outliers")
        rows.append({**key, "kind": "box", **b, "n_outliers": len(outs)})
        rows += [{**key, "kind": "outlier", "value": v} for v in outs]
    need(bool(rows), "There are no scores to summarise.")
    return _finish(df, vals, keys, levels, labels, rows)


def violin(df: pd.DataFrame, spec: dict, meta: dict | None):
    var, vals, keys, levels, labels = _setup(df, spec, meta, "violin plot", x_is_group=True)
    adjust = float(cust(spec, "bandwidth_adjust", 1.0))
    rows = []
    for key, mask in iter_groups(keys, levels):
        x = vals[mask & np.isfinite(vals)]
        if len(x) == 0:
            continue
        b = box_stats(x)
        b.pop("outliers")
        rows.append({**key, "kind": "box", **b})
        if len(x) >= 2 and np.ptp(x) > 0:
            bw = scott_bandwidth(x) * adjust
            grid = np.linspace(x.min(), x.max(), GRID // 2)  # trimmed to the data range (ggplot2 default)
            rows += [{**key, "kind": "density", "value": float(g), "density": float(d)}
                     for g, d in zip(grid, kde(x, grid, bw))]
    need(bool(rows), "There are no scores to summarise.")
    return _finish(df, vals, keys, levels, labels, rows)
