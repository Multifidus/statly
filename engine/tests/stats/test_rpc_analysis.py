"""analysis.run / analysis.list through the real stdio server on the practice datasets."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

from statly_engine.contracts import AnalysisResult

REPO = Path(__file__).resolve().parents[3]
PRACTICE = REPO / "fixtures" / "practice"


def _import_stacked(engine, folder: str) -> dict:
    files = [PRACTICE / folder / "pre.csv", PRACTICE / folder / "post.csv"]
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


def _request(meta: dict, analysis_id: str, variables: dict, **kw) -> dict:
    return {"schema_version": 1, "request_id": f"req-{analysis_id}", "analysis_id": analysis_id,
            "dataset_id": meta["dataset_id"], "snapshot_id": meta["snapshot_id"], "variables": variables,
            "subset": [], "options": {}, "corrections": [], "alpha": 0.05, "tails": "two_sided",
            "ci_level": 0.95, **kw}


def _csv(folder: str, name: str) -> pd.DataFrame:
    return pd.read_csv(PRACTICE / folder / name, skiprows=[1, 2])  # Qualtrics rows 2-3


def test_analysis_list(engine):
    ids = {a["analysis_id"]: a for a in engine.call("analysis.list")["analyses"]}
    assert {"descriptives", "t_test.one_sample", "t_test.independent", "t_test.paired"} <= set(ids)
    assert [l["name"] for l in ids["t_test.paired"]["layouts"]] == ["wide", "long"]


def test_independent_pre_post_as_groups(engine):
    meta = _import_stacked(engine, "one_group_prepost_likert")
    res = engine.call("analysis.run", _request(meta, "t_test.independent",
                                               {"outcome": ["Q3_1"], "group": ["Time"]}))
    AnalysisResult.model_validate(res)
    pre, post = _csv("one_group_prepost_likert", "pre.csv")["Q3_1"], _csv("one_group_prepost_likert", "post.csv")["Q3_1"]
    want = stats.ttest_ind(pre.dropna(), post.dropna(), equal_var=False)  # Time order = import order (Pre, Post)
    head = res["statistics"][0]
    assert head["key"] == "welch_t"
    assert np.isclose(head["value"], want.statistic, atol=1e-10) and np.isclose(head["p"], want.pvalue, atol=1e-10)
    assert [d["group"] for d in res["descriptives"]["continuous"]] == [{"Time": "Pre"}, {"Time": "Post"}]
    assert res["inputs"]["snapshot_id"] == meta["snapshot_id"] and res["inputs"]["n_used"] == pre.notna().sum() + post.notna().sum()
    assert any(w["code"] == "ties_present" for w in res["warnings"])  # a single Likert item

    stale = engine.error("analysis.run", _request({**meta, "snapshot_id": "snap_old"}, "t_test.independent",
                                                  {"outcome": ["Q3_1"], "group": ["Time"]}))
    assert stale["code"] == -32002
    bad = engine.error("analysis.run", _request(meta, "t_test.independent", {"outcome": ["Q3_1"]}))
    assert bad["code"] == -32003
    subset = engine.error("analysis.run", _request(meta, "t_test.independent", {"outcome": ["Q3_1"], "group": ["Time"]},
                                                   subset=[{"variable": "Time", "op": "in", "values": ["Pre"]}]))
    assert subset["code"] == -32003 and "exactly two groups" in subset["message"]


def test_paired_after_link(engine):
    meta = _import_stacked(engine, "linked_id_prepost")
    link = engine.call("dataset.link", {"dataset_id": meta["dataset_id"], "mode": "linked", "id_variable": "Q1",
                                        "normalization": None})
    meta = link["dataset_meta"]
    res = engine.call("analysis.run", _request(meta, "t_test.paired",
                                               {"outcome": ["Q4"], "time": ["Time"], "subject_id": ["Q1"]}))
    AnalysisResult.model_validate(res)

    # Independent computation: normalize IDs (trim + upper-case), drop IDs duplicated within a time point.
    pre, post = _csv("linked_id_prepost", "pre.csv"), _csv("linked_id_prepost", "post.csv")
    for d in (pre, post):
        d["id"] = d["Q1"].astype(str).str.strip().str.upper()
    pre = pre[~pre["id"].duplicated(keep=False)]
    post = post[~post["id"].duplicated(keep=False)]
    m = pre.merge(post, on="id", suffixes=("_pre", "_post")).dropna(subset=["Q4_pre", "Q4_post"])
    want = stats.ttest_rel(m["Q4_pre"], m["Q4_post"])
    assert res["inputs"]["n_used"] == len(m) == 73
    t = res["statistics"][0]
    assert np.isclose(t["value"], want.statistic, atol=1e-10) and t["df"] == [len(m) - 1]
    assert [e["key"] for e in res["effect_sizes"]][:2] == ["d_av", "d_z"]
    assert res["assumptions"][0]["applies_to"]["kind"] == "differences"
    dropped = [w for w in res["warnings"] if w["code"] == "pairs_dropped"]
    assert dropped and "2 IDs appear more than once" in dropped[0]["message"]
    assert set(res["chart_data"]) >= {c["data_key"] for c in res["assumptions"][0]["chart_refs"]}
