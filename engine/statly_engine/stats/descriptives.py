"""Descriptive statistics (SPEC §8): the `descriptives` analysis and the per-cell helpers every
other analysis uses for AnalysisResult.descriptives.

Conventions (fixtures/r/descriptives.R): SD and SE use n - 1; the CI of the mean is t-based;
quartiles/IQR are R type 7 (numpy's default linear interpolation, psych/Excel QUARTILE.INC);
skewness and excess kurtosis are the bias-corrected G1/G2 (SPSS/SAS; psych type = 2;
scipy bias=False). Skewness needs n >= 3 and kurtosis n >= 4 with nonzero SD, else null.
"""

from __future__ import annotations

import math
import warnings
from itertools import product

import numpy as np
import pandas as pd
from scipy import stats

from statly_engine.stats import apa, prep
from statly_engine.stats.apa import Rich
from statly_engine.stats.assumptions import histogram
from statly_engine.stats.core import ResultBuilder, clean, warning
from statly_engine.stats.registry import Role, register


def describe(values, ci_level: float = 0.95) -> dict:
    """Numbers of one GroupDescriptives cell from raw values (NaN = missing)."""
    arr = np.asarray(values, dtype=float)
    x = arr[np.isfinite(arr)]
    n = len(x)
    out = {"n": n, "n_missing": int(len(arr) - n), "mean": None, "sd": None, "se": None, "ci": None,
           "median": None, "q1": None, "q3": None, "iqr": None, "min": None, "max": None,
           "skewness": None, "kurtosis": None}
    if n == 0:
        return out
    mean = float(np.mean(x))
    q1, med, q3 = (float(v) for v in np.percentile(x, [25, 50, 75]))
    out.update(mean=mean, median=med, q1=q1, q3=q3, iqr=q3 - q1, min=float(np.min(x)), max=float(np.max(x)))
    if n >= 2:
        sd = float(np.std(x, ddof=1))
        se = sd / math.sqrt(n)
        half = float(stats.t.ppf(1 - (1 - ci_level) / 2, n - 1)) * se
        out.update(sd=sd, se=se, ci={"level": ci_level, "lower": mean - half, "upper": mean + half})
        if sd > 0:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                if n >= 3:
                    out["skewness"] = clean(stats.skew(x, bias=False))
                if n >= 4:
                    out["kurtosis"] = clean(stats.kurtosis(x, fisher=True, bias=False))
    return out


def cell(variable: str, group: dict, label: str, values, ci_level: float = 0.95,
         n_missing: int | None = None) -> dict:
    """GroupDescriptives dict. `n_missing` overrides the count of NaNs in `values`."""
    d = describe(values, ci_level)
    if n_missing is not None:
        d["n_missing"] = int(n_missing)
    return {"variable": variable, "group": group, "label": label, **d}


def frequency_table(values: pd.Series, variable: str, group: dict, meta: dict | None) -> dict:
    """FrequencyTable with valid levels in category order, plus a missing row when any are missing."""
    total = len(values)
    valid = values.dropna()
    n_valid = len(valid)
    levels = []
    for lv in prep.level_order(values, variable, meta):
        k = int(sum(prep._same(v, lv) for v in valid))
        levels.append({"value": lv, "label": prep.value_label(meta, variable, lv), "count": k,
                       "percent": 100 * k / total if total else 0.0,
                       "valid_percent": 100 * k / n_valid if n_valid else None})
    n_miss = total - n_valid
    if n_miss:
        levels.append({"value": None, "label": "Missing", "count": n_miss, "percent": 100 * n_miss / total,
                       "valid_percent": None})
    return {"variable": variable, "group": group, "levels": levels}


def _kinds(df: pd.DataFrame, name: str, meta: dict | None) -> tuple[bool, bool]:
    """(continuous summary?, frequency table?) for a variable."""
    v = prep.variable_meta(meta, name)
    if v:
        numeric = v.get("dtype") in ("integer", "float")
        level = v.get("level")
        return numeric and level != "nominal", (not numeric) or level in ("nominal", "ordinal")
    numeric = pd.api.types.is_numeric_dtype(df[name]) and not pd.api.types.is_bool_dtype(df[name])
    return numeric, not numeric


@register("descriptives", label="Descriptive statistics",
          roles=[Role("variables", 1, None, "Variables to summarise"),
                 Role("group", 0, 3, "Optional grouping variables (one row per combination)")],
          options={})
def run_descriptives(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    ci = request.ci_level
    names = request.variables["variables"]
    group_vars = request.variables.get("group", [])
    b = ResultBuilder(request)

    gcols = {g: prep.categorical(df, g, meta) for g in group_vars}
    has_group = np.ones(len(df), dtype=bool)
    for s in gcols.values():
        has_group &= s.notna().to_numpy()
    orders = [prep.level_order(gcols[g], g, meta) for g in group_vars]
    cells = list(product(*orders)) if group_vars else [()]

    def cell_mask(levels) -> np.ndarray:
        m = has_group.copy()
        for g, lv in zip(group_vars, levels):
            m &= gcols[g].map(lambda v, lv=lv: prep._same(v, lv)).to_numpy(bool)
        return m

    def cell_label(levels) -> str:
        return ", ".join(prep.value_label(meta, g, lv) for g, lv in zip(group_vars, levels)) or "All"

    rows, any_value = [], np.zeros(len(df), dtype=bool)
    for name in names:
        is_cont, is_freq = _kinds(df, name, meta)
        vlabel = prep.label(meta, name)
        if is_cont:
            x = prep.numeric(df, name, meta)
            any_value |= x.notna().to_numpy()
            for levels in cells:
                m = cell_mask(levels)
                rows.append(cell(name, dict(zip(group_vars, levels)), cell_label(levels), x[m].to_numpy(), ci))
            if group_vars:
                rows.append(cell(name, {}, "Total", x[has_group].to_numpy(), ci))
            if len(x.dropna()) > 1 and np.ptp(x.dropna()) == 0:
                b.warn(warning("constant_variable", "info",
                               f"Every score in {vlabel} is the same, so its spread is zero and its shape "
                               "(skewness, kurtosis) can't be described."))
            b.chart(f"hist_{name}", histogram(x[has_group].to_numpy()))
        if is_freq:
            c = prep.categorical(df, name, meta)
            any_value |= c.notna().to_numpy()
            tables = [frequency_table(c[cell_mask(levels)], name, dict(zip(group_vars, levels)), meta)
                      for levels in cells]
            b.frequency_tables(tables)
            for t, levels in zip(tables, cells):
                b.extra_table(_frequency_apa(t, vlabel, cell_label(levels) if group_vars else None))
    b.descriptives(rows)

    used = has_group & any_value
    b.inputs(int(used.sum()), int(len(df) - used.sum()),
             [(dict(zip(group_vars, lv)), int((cell_mask(lv) & any_value).sum())) for lv in cells]
             if group_vars else [])
    b.warn(None if not group_vars or has_group.all() else warning(
        "missing_data", "info", f"{int((~has_group).sum())} rows have no value for the grouping variable and "
        "are left out of the group summaries."))

    if rows:
        b.table(_descriptives_apa(rows, meta, bool(group_vars)))
        b.sentence(_sentence(rows, meta, bool(group_vars)))
        b.summary(_summary(rows, meta))
    else:
        b.table(b.additional_tables.pop(0) if b.additional_tables else None)
        b.sentence(_freq_sentence(b.frequencies[0], prep.label(meta, b.frequencies[0]["variable"])))
        b.summary(_freq_summary(b.frequencies[0], prep.label(meta, b.frequencies[0]["variable"])))
    return b.build()


def _descriptives_apa(rows: list[dict], meta, grouped: bool) -> dict:
    cols = [apa.column("variable", "Variable", "left")]
    if grouped:
        cols.append(apa.column("group", "Group", "left"))
    cols += [apa.column("n", Rich().i("n")), apa.column("m", Rich().i("M")), apa.column("sd", Rich().i("SD")),
             apa.column("mdn", Rich().i("Mdn")), apa.column("iqr", "IQR"), apa.column("min", "Min"),
             apa.column("max", "Max"), apa.column("skew", "Skewness"), apa.column("kurt", "Kurtosis")]
    out = []
    for r in rows:
        cells = [apa.cell_text(prep.label(meta, r["variable"]))]
        if grouped:
            cells.append(apa.cell_text(r["label"]))
        cells += [apa.cell_int(r["n"]), apa.cell_num(r["mean"]), apa.cell_num(r["sd"]), apa.cell_num(r["median"]),
                  apa.cell_num(r["iqr"]), apa.cell_num(r["min"]), apa.cell_num(r["max"]),
                  apa.cell_num(r["skewness"]), apa.cell_num(r["kurtosis"])]
        out.append(apa.row(cells, kind="total" if grouped and not r["group"] else "data"))
    note = Rich().i("n").t(" = number of scores; ").i("M").t(" = mean; ").i("SD").t(" = standard deviation; ") \
        .i("Mdn").t(" = median; IQR = interquartile range. Skewness and kurtosis (excess) are bias-corrected.")
    return apa.table("Descriptive Statistics", cols, out, general_note=note)


def _frequency_apa(t: dict, vlabel: str, cell_label: str | None) -> dict:
    cols = [apa.column("value", "Response", "left"), apa.column("count", Rich().i("n")),
            apa.column("percent", "%"), apa.column("valid_percent", "Valid %")]
    rows = [apa.row([apa.cell_text(lv["label"]), apa.cell_int(lv["count"]), apa.cell_num(lv["percent"], 1),
                     apa.cell_num(lv["valid_percent"], 1) if lv["valid_percent"] is not None else apa.cell_empty()])
            for lv in t["levels"]]
    title = f"Frequencies for {vlabel}" + (f" ({cell_label})" if cell_label else "")
    return apa.table(title, cols, rows, number=None,
                     general_note="Valid % excludes missing responses.")


def _sentence(rows: list[dict], meta, grouped: bool) -> Rich:
    r = Rich()
    first = rows[0]["variable"]
    vl = prep.label(meta, first)
    cells = [x for x in rows if x["variable"] == first and (x["group"] or not grouped)]
    if not grouped:
        c = cells[0]
        return r.t(f"Scores on {vl} had a mean of ").i("M").t(f" = {apa.num(c['mean'])} (").i("SD") \
            .t(f" = {apa.num(c['sd'])}, ").i("n").t(f" = {c['n']}).")
    r.t(f"Scores on {vl} had a mean of ")
    for k, c in enumerate(cells):
        if k:
            r.t("; " if k < len(cells) - 1 else "; and ")
        r.i("M").t(f" = {apa.num(c['mean'])} (").i("SD").t(f" = {apa.num(c['sd'])}, ").i("n") \
            .t(f" = {c['n']}) in the {c['label']} group")
    return r.t(".")


def _summary(rows: list[dict], meta) -> str:
    parts = []
    for name in dict.fromkeys(r["variable"] for r in rows):
        cells = [r for r in rows if r["variable"] == name and r["label"] != "Total"]
        vl = prep.label(meta, name)
        if len(cells) == 1:
            c = cells[0]
            if c["mean"] is None:
                parts.append(f"{vl} has no answers to summarise.")
            else:
                parts.append(f"{vl}: the average was {apa.num(c['mean'])} across {c['n']} people, and scores "
                             f"ranged from {apa.num(c['min'])} to {apa.num(c['max'])}.")
        else:
            txt = "; ".join(f"{c['label']} averaged {apa.num(c['mean'])} (n = {c['n']})" for c in cells
                            if c["mean"] is not None)
            parts.append(f"{vl}: {txt}.")
    return " ".join(parts)


def _freq_sentence(t: dict, vl: str) -> Rich:
    r = Rich().t(f"{vl}: ")
    valid = [lv for lv in t["levels"] if lv["value"] is not None]
    for k, lv in enumerate(valid):
        if k:
            r.t("; ")
        r.t(f"{lv['label']}, ").i("n").t(f" = {lv['count']} ({apa.num(lv['valid_percent'], 1)}%)")
    return r.t(".")


def _freq_summary(t: dict, vl: str) -> str:
    valid = [lv for lv in t["levels"] if lv["value"] is not None]
    if not valid:
        return f"{vl} has no answers to summarise."
    top = max(valid, key=lambda lv: lv["count"])
    return (f"For {vl}, the most common answer was \"{top['label']}\" ({top['count']} people, "
            f"{apa.num(top['valid_percent'], 1)}% of those who answered).")
