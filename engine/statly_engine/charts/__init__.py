"""Chart-builder data (SPEC §10.2, Phase 7).

`compute(df, spec, meta)` / `compute_from_result(result, spec)` are pure: they turn a ChartSpec into
the small aggregated `{rows, meta}` the app compiles to Vega-Lite, so the WebView never holds the
dataset. Row shapes per chart type are documented in contracts/README.md ("Phase 7").
"""

from __future__ import annotations

import pandas as pd

from statly_engine.charts import aggregate, distribution, factor, relationship
from statly_engine.errors import InvalidParams
from statly_engine.stats import prep

DATASET_CHARTS = {
    "bar": aggregate.means,
    "grouped_bar": aggregate.means,
    "line": aggregate.means,
    "interaction": aggregate.means,
    "stacked_bar": aggregate.counts,
    "percent_bar": aggregate.counts,
    "likert_diverging": aggregate.likert,
    "histogram": distribution.histogram,
    "density": distribution.density,
    "qq": distribution.qq,
    "box": distribution.box,
    "violin": distribution.violin,
    "scatter": relationship.scatter,
    "correlation_heatmap": relationship.correlation,
}
RESULT_CHARTS = {"scree": factor.scree, "cfa_path": factor.cfa_path}


def compute(df: pd.DataFrame, spec: dict, meta: dict | None = None) -> dict:
    ctype = spec["chart_type"]
    if ctype not in DATASET_CHARTS:
        raise InvalidParams("This chart is drawn from a saved analysis, not from the dataset.")
    sub = prep.apply_subset(df, spec.get("subset") or [], meta)
    rows, info = DATASET_CHARTS[ctype](sub, spec, meta)
    return {"rows": rows, "meta": {"chart_type": ctype, "source": "dataset", "n_rows": int(len(sub)), **info}}


def compute_from_result(result: dict, spec: dict) -> dict:
    ctype = spec["chart_type"]
    if ctype not in RESULT_CHARTS:
        raise InvalidParams("This chart is drawn from the dataset, not from a saved analysis.")
    rows, info = RESULT_CHARTS[ctype](result)
    return {"rows": rows, "meta": {"chart_type": ctype, "source": "analysis",
                                   "analysis_id": result.get("analysis_id"), **info}}
