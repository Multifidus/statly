"""charts.data through the real stdio server on the practice data (Phase 7)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from .test_compute import ITEMS, spec

REPO = Path(__file__).resolve().parents[3]
PRACTICE = REPO / "fixtures" / "practice" / "one_group_prepost_likert"


def _import(engine) -> dict:
    files = [PRACTICE / "pre.csv", PRACTICE / "post.csv"]
    pv = engine.call("dataset.import_preview", {"files": [{"path": str(p), "sheet_name": None} for p in files],
                                                "qualtrics_mode": "auto", "stack_onto_dataset_id": None})
    labels = ["Pre", "Post"]
    decisions = [{"file_id": f["file_id"], "sheet_name": f["sheet_name"], "encoding": f["encoding"],
                  "delimiter": f["delimiter"], "qualtrics_header_rows": f["qualtrics"]["header_rows"],
                  "time_label": lbl, "drop_columns": []} for f, lbl in zip(pv["files"], labels)]
    return engine.call("dataset.import", {
        "preview_id": pv["preview_id"], "files": decisions, "row_filters": [], "variables": [],
        "stack": {"time_variable": "Time", "column_matches": pv["stack_proposal"],
                  "levels": [{"file_id": f["file_id"], "label": lbl} for f, lbl in zip(pv["files"], labels)]},
    })["dataset_meta"]


def _csv(name):
    return pd.read_csv(PRACTICE / name, skiprows=[1, 2])


def test_charts_data_rpc(engine):
    meta = _import(engine)
    ids = {"dataset_id": meta["dataset_id"], "snapshot_id": meta["snapshot_id"]}
    res = engine.call("charts.data", {**ids, "spec": spec("bar", x=["Time"], y=["Q3_1"], error_bars="se")})
    assert [r["x"] for r in res["rows"]] == ["Pre", "Post"]            # import order via value labels
    pre = _csv("pre.csv")["Q3_1"]
    assert np.isclose(res["rows"][0]["value"], pre.mean()) and np.isclose(res["rows"][0]["se"], pre.sem())
    assert res["meta"]["error_bars"] == "se" and res["meta"]["labels"]["x"] == "Time point"

    lik = engine.call("charts.data", {**ids, "spec": spec("likert_diverging", y=ITEMS, facet=["Time"])})
    assert len(lik["rows"]) == 10 * 2 * 5

    stale = engine.error("charts.data", {**ids, "snapshot_id": "nope", "spec": spec("histogram", x=["Q3_1"])})
    assert stale["code"] == -32002
    bad = engine.error("charts.data", {**ids, "spec": spec("scatter", x=["Q3_1"])})
    assert bad["code"] == -32003
    bad_spec = engine.error("charts.data", {**ids, "spec": {**spec("bar"), "chart_type": "pie"}})
    assert bad_spec["code"] == -32003


def test_scree_from_logged_efa(engine):
    meta = _import(engine)
    req = {"schema_version": 1, "request_id": "req-efa", "analysis_id": "validity.efa",
           "dataset_id": meta["dataset_id"], "snapshot_id": meta["snapshot_id"], "variables": {"items": ITEMS},
           "subset": [], "options": {}, "corrections": [], "alpha": 0.05, "tails": "two_sided", "ci_level": 0.95}
    result = engine.call("analysis.run", req)
    s = {**spec("scree"), "source": {"kind": "analysis", "test_log_entry_id": "req-efa"}}
    missing = engine.error("charts.data", {"dataset_id": None, "snapshot_id": None, "spec": s})
    assert missing["code"] == -32002                                    # not stored yet
    engine.call("results.put", {"request_id": "req-efa", "result": result})
    out = engine.call("charts.data", {"dataset_id": None, "snapshot_id": None, "spec": s})
    assert len(out["rows"]) == 3 * len(ITEMS) and out["meta"]["source"] == "analysis"
