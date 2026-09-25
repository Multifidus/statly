"""Multi-file stacking (§5.3), linked mode (§5.4) and the missing-data summary (§5.5)."""

from __future__ import annotations

import pytest

from statly_engine.data import importer
from statly_engine.data.stacking import propose_matches
from statly_engine.errors import InvalidParams, StaleOrUnknown
from statly_engine.rpc_methods import dataset as ds_rpc

from ._helpers import MESSY, PRACTICE, decision, ground_truth, import_single, preview, stack_config

TG = PRACTICE / "three_groups_prepost_followup"
LINKED = PRACTICE / "linked_id_prepost"


def _import_stacked(store, paths, labels):
    pv = preview(store, *paths)
    return pv, importer.commit_import(store, {
        "preview_id": pv["preview_id"],
        "files": [decision(f, time_label=l) for f, l in zip(pv["files"], labels)],
        "row_filters": [], "variables": [], "stack": stack_config(pv, labels),
    })


def test_three_files_stack_long_with_time(store):
    gt = ground_truth("three_groups_prepost_followup")
    pv, meta = _import_stacked(store, [TG / "pre.csv", TG / "post.csv", TG / "followup.csv"],
                               ["Pre", "Post", "Follow-up"])
    assert pv["stack_proposal"] and all(m["status"] == "matched" for m in pv["stack_proposal"])
    assert all(len(m["columns"]) == 3 for m in pv["stack_proposal"])
    df = store.get(meta["dataset_id"]).df
    n = gt["n_total_per_time"]
    assert meta["n_rows"] == n["pre"] + n["post"] + n["followup"]
    counts = df["Time"].value_counts().to_dict()
    assert counts == {"Pre": n["pre"], "Post": n["post"], "Follow-up": n["followup"]}
    time_var = meta["variables"][0]
    assert (time_var["name"], time_var["role"], time_var["level"]) == ("Time", "time", "ordinal")
    assert [vl["label"] for vl in time_var["value_labels"]] == ["Pre", "Post", "Follow-up"]
    assert meta["stacking"]["time_variable"] == "Time"
    by_group = df[df["Time"] == "Post"]["Q2"].value_counts().to_dict()
    assert by_group == {g: gt["n_per_group_per_time"][g]["post"] for g in gt["groups"]}
    q2 = next(v for v in meta["variables"] if v["name"] == "Q2")
    assert len(q2["sources"]) == 3
    assert list(df["_statly_row_id"]) == list(range(meta["n_rows"]))
    assert [f["time_label"] for f in meta["import_log"]["files"]] == ["Pre", "Post", "Follow-up"]


def test_stack_followup_onto_existing(store):
    _, meta = _import_stacked(store, [TG / "pre.csv", TG / "post.csv"], ["Pre", "Post"])
    old_ids = list(store.get(meta["dataset_id"]).df["_statly_row_id"])
    pv = preview(store, TG / "followup.csv", onto=meta["dataset_id"])
    assert all(m["status"] == "matched" for m in pv["stack_proposal"])
    assert pv["stack_proposal"][0]["columns"][0]["file_id"] == meta["dataset_id"]
    f = pv["files"][0]
    new = importer.commit_stack(store, {
        "dataset_id": meta["dataset_id"], "preview_id": pv["preview_id"],
        "files": [decision(f, time_label="Follow-up")], "row_filters": [], "variables": [],
        "stack": {"time_variable": "Time", "levels": [{"file_id": f["file_id"], "label": "Follow-up"}],
                  "column_matches": pv["stack_proposal"]},
    })
    assert new["snapshot_id"] != meta["snapshot_id"] and new["dataset_id"] == meta["dataset_id"]
    assert [lvl["label"] for lvl in new["stacking"]["levels"]] == ["Pre", "Post", "Follow-up"]
    df = store.get(meta["dataset_id"]).df
    assert df["Time"].value_counts()["Follow-up"] == 98 and new["n_rows"] == 135 + 119 + 98
    assert list(df["_statly_row_id"])[: len(old_ids)] == old_ids  # stable row ids
    assert [v["name"] for v in new["variables"]] == [v["name"] for v in meta["variables"]]


def test_stack_proposal_fuzzy_rename_and_unmatched():
    matches, issues = propose_matches([
        ("a", [("Q1", "How satisfied are you with the course?"), ("Q2", "Age"), ("Q3", "Pre-only item")]),
        ("b", [("Q1", "How satisfied are you with the course?"), ("Q2", "Age"),
               ("Q9", "How satisfied are you with this course?")]),
    ])
    by_var = {m["variable"]: m for m in matches}
    assert by_var["Q1"]["status"] == "matched"
    assert by_var["Q3"]["status"] == "unmatched" and by_var["Q3"]["columns"] == [{"file_id": "a", "column": "Q3"}]
    assert by_var["Q9"]["status"] == "unmatched"
    matches, _ = propose_matches([
        ("a", [("Q5", "How satisfied are you with the course overall?")]),
        ("b", [("Q7", "How satisfied are you with this course overall?")]),
    ])
    assert matches == [{"variable": "Q5", "status": "possibly_renamed", "similarity": matches[0]["similarity"],
                        "columns": [{"file_id": "a", "column": "Q5"}, {"file_id": "b", "column": "Q7"}]}]
    assert 0.8 <= matches[0]["similarity"] < 1
    _, issues = propose_matches([("a", [("Q1", "Your age")]), ("b", [("Q1", "Favourite colour of the sky")])])
    assert issues and issues[0]["code"] == "same_id_different_text"


def test_multi_file_import_requires_stack(store):
    pv = preview(store, TG / "pre.csv", TG / "post.csv")
    with pytest.raises(InvalidParams):
        importer.commit_import(store, {"preview_id": pv["preview_id"],
                                       "files": [decision(f) for f in pv["files"]],
                                       "row_filters": [], "variables": [], "stack": None})
    with pytest.raises(StaleOrUnknown):
        importer.commit_import(store, {"preview_id": "pv_nope", "files": [decision(pv["files"][0])],
                                       "row_filters": [], "variables": [], "stack": None})


def test_linked_mode_report(store):
    gt = ground_truth("linked_id_prepost")
    _, meta = _import_stacked(store, [LINKED / "pre.csv", LINKED / "post.csv"], ["Pre", "Post"])
    assert meta["link"]["mode"] == "aggregate"
    res = ds_rpc.link(store, {"dataset_id": meta["dataset_id"], "mode": "linked", "id_variable": "Q1",
                              "normalization": {"trim_whitespace": True, "case_insensitive": True}})
    rep, new = res["report"], res["dataset_meta"]
    assert rep["counts"] == {"matched": gt["n_matched_after_normalization"],
                             "unmatched": gt["n_pre_only"] + gt["n_post_only"],
                             "duplicate": gt["n_duplicated_ids_in_post"]}
    assert sorted(rep["duplicate_ids"]) == sorted(gt["duplicated_ids"])
    df = store.get(meta["dataset_id"]).df
    norm = df["Q1"].astype(str).str.strip().str.upper()
    pre, post = set(norm[df["Time"] == "Pre"]), set(norm[df["Time"] == "Post"])
    assert len([i for i in rep["unmatched_ids"] if i in pre]) == gt["n_pre_only"]
    assert len([i for i in rep["unmatched_ids"] if i in post]) == gt["n_post_only"]
    assert "paired" in rep["explanation"] and "aggregate" in rep["explanation"]
    assert new["link"] == {"mode": "linked", "id_variable": "Q1",
                           "normalization": {"trim_whitespace": True, "case_insensitive": True},
                           "counts": rep["counts"]}
    assert new["snapshot_id"] != meta["snapshot_id"]
    assert new["n_rows"] == gt["n_pre_rows"] + gt["n_post_rows"]  # nobody is dropped
    # Without normalization almost nothing matches.
    raw = ds_rpc.link(store, {"dataset_id": meta["dataset_id"], "mode": "linked", "id_variable": "Q1",
                              "normalization": {"trim_whitespace": False, "case_insensitive": False}})
    assert raw["report"]["counts"]["matched"] < gt["n_matched_after_normalization"]
    back = ds_rpc.link(store, {"dataset_id": meta["dataset_id"], "mode": "aggregate", "id_variable": None,
                               "normalization": None})
    assert back["report"] is None and back["dataset_meta"]["link"]["counts"] is None


def test_link_requires_stacked_dataset(store):
    meta = import_single(store, LINKED / "pre.csv")
    with pytest.raises(InvalidParams):
        ds_rpc.link(store, {"dataset_id": meta["dataset_id"], "mode": "linked", "id_variable": "Q1",
                            "normalization": None})


def test_missing_summary_with_minus_99(store):
    gt = ground_truth("messy_qualtrics")
    meta = import_single(store, MESSY / "messy_3header.csv")
    ms = {m["variable"]: m for m in meta["missing_summary"]}
    items = [f"Q5_{i}" for i in range(1, 7)] + ["Q6"]
    assert sum(ms[c]["n_missing_coded"] for c in items) == gt["n_missing_code_cells"]
    for m in meta["missing_summary"]:
        assert m["n_valid"] + m["n_missing_blank"] + m["n_missing_coded"] == m["n_total"] == gt["n_rows_total"]
    assert ms["Q7_8_TEXT"]["n_missing_blank"] > 0 and ms["Q7_8_TEXT"]["n_missing_coded"] == 0
    assert ms["ExternalReference"]["pct_missing"] == 100.0
    # Undeclare the code -> -99 counts as valid again.
    q6 = next(v for v in meta["variables"] if v["name"] == "Q6")
    meta2 = import_single(store, MESSY / "messy_3header.csv", variables=[{**q6, "missing_codes": []}])
    ms2 = {m["variable"]: m for m in meta2["missing_summary"]}
    assert ms2["Q6"]["n_missing_coded"] == 0 and ms2["Q6"]["n_valid"] == ms["Q6"]["n_valid"] + ms["Q6"]["n_missing_coded"]
    res = ds_rpc.missing_summary(store, {"dataset_id": meta2["dataset_id"]})
    assert res["snapshot_id"] == meta2["snapshot_id"]
