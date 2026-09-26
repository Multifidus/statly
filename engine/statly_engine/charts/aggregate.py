"""Aggregated charts: means with SE/SD/95% CI (bar, grouped bar, line, interaction), counts and
percentages (stacked / percent bar), and diverging stacked Likert counts."""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats

from statly_engine.charts.common import (category_labels, cust, fields, group_frame, iter_groups, need, num)
from statly_engine.stats import prep


def summarize(x: np.ndarray, level: float = 0.95) -> dict:
    """n, mean, median, sum, sd (n-1), se, t-based CI for the mean."""
    x = x[np.isfinite(x)]
    n = len(x)
    if n == 0:
        return {"n": 0, "mean": None, "median": None, "sum": None, "sd": None, "se": None,
                "ci_low": None, "ci_high": None}
    mean = float(np.mean(x))
    sd = float(np.std(x, ddof=1)) if n > 1 else float("nan")
    se = sd / np.sqrt(n) if n > 1 else float("nan")
    half = float(stats.t.ppf(0.5 + level / 2, n - 1)) * se if n > 1 else float("nan")
    return {"n": int(n), "mean": mean, "median": float(np.median(x)), "sum": float(np.sum(x)),
            "sd": num(sd), "se": num(se), "ci_low": num(mean - half), "ci_high": num(mean + half)}


def _bounds(s: dict, kind: str, aggregate: str) -> tuple[float | None, float | None]:
    if aggregate != "mean" or kind == "none" or s["mean"] is None:
        return None, None
    if kind == "ci95":
        return s["ci_low"], s["ci_high"]
    spread = s["se"] if kind == "se" else s["sd"]
    if spread is None:
        return None, None
    return s["mean"] - spread, s["mean"] + spread


def means(df: pd.DataFrame, spec: dict, meta: dict | None) -> tuple[list[dict], dict]:
    ctype = spec["chart_type"]
    ys = fields(spec, "y")
    xs = fields(spec, "x")
    need(bool(ys), "Put a number variable (the score to average) on the Y shelf.")
    if ctype in ("grouped_bar", "interaction"):
        need(bool(xs) and bool(fields(spec, "color")),
             "This chart compares two groupings: put one on X and the other on Color/Group.")
    if ctype == "line":
        need(bool(xs) or len(ys) > 1, "Put the time variable (for example Pre/Post) on the X shelf.")
    need(len(xs) <= 1, "Only one variable can go on X for this chart.")
    agg = (spec["shelves"]["y"][0]["aggregate"] if spec["shelves"]["y"] else "mean")
    agg = "mean" if agg in ("none", "percent") else agg
    kind = spec.get("error_bars") or "none"
    multi = len(ys) > 1
    # Several Y variables: the variable itself becomes the X (or color) grouping.
    var_field = None
    if multi:
        var_field = "x" if not xs else ("color" if not fields(spec, "color") else None)
        need(var_field is not None, "With several variables on Y, leave X or Color/Group free so they can be told apart.")
    extra = {"x": xs[0]} if xs else {}
    keys, levels, labels = group_frame(df, spec, meta, extra, skip=("color",) if var_field == "color" else ())
    rows: list[dict] = []
    used = np.zeros(len(df), dtype=bool)
    y_labels = [prep.label(meta, y) for y in ys]
    if var_field:
        levels[var_field] = y_labels
        labels[var_field] = "Variable"
    for y, ylab in zip(ys, y_labels):
        vals = prep.numeric(df, y, meta).to_numpy()
        for key, mask in iter_groups(keys, {k: v for k, v in levels.items() if k in keys.columns}):
            x = vals[mask]
            used |= mask & np.isfinite(vals)
            s = summarize(x)
            if s["n"] == 0:
                continue
            value = s["mean"] if agg == "mean" else s["median"] if agg == "median" else s["sum"] if agg == "sum" else s["n"]
            lo, hi = _bounds(s, kind, agg)
            row = {**key, "value": num(value), "lower": lo, "upper": hi, **s}
            if var_field:
                row[var_field] = ylab
            row["variable"] = ylab
            rows.append(row)
    labels.setdefault("x", labels.get("x", ""))
    agg_word = {"mean": "Mean", "median": "Median", "sum": "Total", "count": "Count"}[agg]
    labels["y"] = y_labels[0] if not multi else "Score"
    labels["value"] = f"{agg_word} {labels['y']}".strip() if agg != "count" else "Number of responses"
    return rows, {"levels": levels, "labels": labels, "aggregate": agg, "error_bars": kind if agg == "mean" else "none",
                  "n_used": int(used.sum()), "n_excluded": int(len(df) - used.sum())}


def _items_long(df: pd.DataFrame, items: list[str], meta: dict | None) -> tuple[list[tuple[str, pd.Series]], list, list[str]]:
    """Each item's raw categorical series; the shared response levels (ordered) and their labels."""
    raws = [(it, prep.categorical(df, it, meta)) for it in items]
    ordered: list = []
    for it, s in raws:
        for v in prep.level_order(s, it, meta):
            if not any(prep._same(v, o) for o in ordered):
                ordered.append(v)
    try:
        if all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in ordered):
            first = prep.variable_meta(meta, items[0]) or {}
            vl = [x["value"] for x in first.get("value_labels") or []]
            rr = first.get("response_range") or None
            if rr and rr.get("min") is not None and rr.get("max") is not None and float(rr["min"]).is_integer():
                span = list(range(int(rr["min"]), int(rr["max"]) + 1))
                ordered = sorted(set(ordered) | set(span), key=float) if len(span) <= 11 else sorted(ordered, key=float)
            elif not vl:
                ordered = sorted(ordered, key=float)
    except (TypeError, ValueError):
        pass
    labels = [prep.value_label(meta, items[0], v) for v in ordered]
    return raws, ordered, labels


def counts(df: pd.DataFrame, spec: dict, meta: dict | None) -> tuple[list[dict], dict]:
    """Stacked / percent bars. Either X (category) x Color (category), or several items on Y."""
    ys, xs = fields(spec, "y"), fields(spec, "x")
    rows: list[dict] = []
    if ys and not xs:
        raws, levels, rlabels = _items_long(df, ys, meta)
        keys, flevels, flabels = group_frame(df, spec, meta, skip=("color",))
        item_labels = [prep.label(meta, y) for y in ys]
        used = np.zeros(len(df), dtype=bool)
        for (it, s), ilab in zip(raws, item_labels):
            for key, mask in iter_groups(keys, flevels):
                sub = s[mask]
                ok = sub.notna().to_numpy()
                used |= mask & s.notna().to_numpy()
                n = int(ok.sum())
                for lv, lab in zip(levels, rlabels):
                    c = int(sum(1 for v in sub if v is not None and prep._same(v, lv)))
                    rows.append({**key, "x": ilab, "color": lab, "count": c, "n": n,
                                 "percent": num(100 * c / n) if n else None})
        return rows, {"levels": {"x": item_labels, "color": rlabels, **flevels},
                      "labels": {"x": "Item", "color": "Response", **flabels, "value": "Count"},
                      "n_used": int(used.sum()), "n_excluded": int(len(df) - used.sum())}
    need(len(xs) == 1, "Put a grouping variable on X (and optionally another on Color/Group to stack by).")
    keys, levels, labels = group_frame(df, spec, meta, {"x": xs[0]})
    outer = [c for c in keys.columns if c != "color"]
    done = keys.notna().all(axis=1).to_numpy()
    for key, mask in iter_groups(keys[outer], {k: levels[k] for k in outer}):
        n = int((mask & done).sum())
        colors = levels.get("color") or [None]
        for col in colors:
            m = mask & done if col is None else mask & done & (keys["color"] == col).to_numpy()
            c = int(m.sum())
            row = {**key, "count": c, "n": n, "percent": num(100 * c / n) if n else None}
            if col is not None:
                row["color"] = col
            rows.append(row)
    labels["value"] = "Count"
    return rows, {"levels": levels, "labels": labels, "n_used": int(done.sum()), "n_excluded": int(len(df) - done.sum())}


def likert(df: pd.DataFrame, spec: dict, meta: dict | None) -> tuple[list[dict], dict]:
    """Diverging stacked bars: per item, % per response level, centred on the neutral midpoint."""
    items = fields(spec, "y") or fields(spec, "x")
    need(bool(items), "Put one or more Likert items on the Y shelf.")
    raws, levels, rlabels = _items_long(df, items, meta)
    need(len(levels) >= 2, "These items need at least two different answers to draw a Likert chart.")
    k = len(levels)
    mid = (k - 1) / 2  # index of the neutral level when k is odd
    keys, flevels, flabels = group_frame(df, spec, meta, skip=("color",))
    rows: list[dict] = []
    item_labels = [prep.label(meta, it) for it in items]
    used = np.zeros(len(df), dtype=bool)
    for (it, s), ilab in zip(raws, item_labels):
        for key, mask in iter_groups(keys, flevels):
            sub = [v for v in s[mask] if v is not None]
            used |= mask & s.notna().to_numpy()
            n = len(sub)
            cnt = [sum(1 for v in sub if prep._same(v, lv)) for lv in levels]
            pct = [100 * c / n if n else 0.0 for c in cnt]
            left = sum(p for i, p in enumerate(pct) if i < mid) + (pct[int(mid)] / 2 if k % 2 == 1 else 0.0)
            pos = -left
            for i, (lv, lab, c, p) in enumerate(zip(levels, rlabels, cnt, pct)):
                side = "negative" if i < mid else "positive" if i > mid else "neutral"
                rows.append({**key, "item": ilab, "item_variable": it, "response": lab,
                             "response_value": lv if isinstance(lv, (int, float, str)) else str(lv), "order": i,
                             "side": side, "count": int(c), "n": n, "percent": num(p),
                             "start": num(pos), "end": num(pos + p)})
                pos += p
    return rows, {"levels": {"item": item_labels, "response": rlabels, **flevels},
                  "labels": {"item": "Item", "response": "Response", **flabels, "value": "Percent of responses"},
                  "neutral": rlabels[int(mid)] if k % 2 == 1 else None,
                  "n_used": int(used.sum()), "n_excluded": int(len(df) - used.sum())}
