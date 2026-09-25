"""Phase 1 RPC methods through the real stdio server (contracts/README.md)."""

from __future__ import annotations

import json
import zipfile

from statly_engine.contracts import DatasetMeta, Rpc

from ._helpers import MESSY, PRACTICE, decision, ground_truth
from .test_project import frontend_project
from engine_client import EngineClient

GT = ground_truth("messy_qualtrics")


def _preview(engine, *paths, onto=None):
    res = engine.call("dataset.import_preview", {
        "files": [{"path": str(p), "sheet_name": None} for p in paths], "qualtrics_mode": "auto",
        "stack_onto_dataset_id": onto})
    Rpc.DatasetImportPreviewResult.model_validate(res)
    return res


def _import_messy(engine, *, drop_pii=True):
    pv = _preview(engine, MESSY / "messy_3header.csv")
    fp = pv["files"][0]
    filters = [f for f in fp["suggested_row_filters"] if f["kind"] == "exclude_values"]
    res = engine.call("dataset.import", {
        "preview_id": pv["preview_id"], "files": [decision(fp, drop=GT["pii_columns"] if drop_pii else [])],
        "row_filters": filters, "variables": [], "stack": None})
    Rpc.DatasetResult.model_validate(res)
    return res["dataset_meta"]


def test_import_rows_missing_and_errors(engine):
    meta = _import_messy(engine)
    assert meta["n_rows"] == GT["n_valid_after_status_filter"]
    ds = meta["dataset_id"]
    page = engine.call("dataset.rows", {"dataset_id": ds, "snapshot_id": meta["snapshot_id"], "offset": 100,
                                        "limit": 50, "columns": None, "sort": None})
    Rpc.DatasetRowsResult.model_validate(page)
    assert page["total_rows"] == 108 and len(page["rows"]) == 8 and page["row_ids"][0] == 100
    assert len(page["columns"]) == len(meta["variables"])
    srt = engine.call("dataset.rows", {"dataset_id": ds, "snapshot_id": None, "offset": 0, "limit": 5,
                                       "columns": ["SC0", "Q6"], "sort": {"variable": "SC0", "descending": True}})
    scores = [r[0] for r in srt["rows"]]
    assert scores == sorted(scores, reverse=True) and all(isinstance(s, int) for s in scores)
    ms = engine.call("dataset.missing_summary", {"dataset_id": ds})
    assert ms["snapshot_id"] == meta["snapshot_id"] and len(ms["missing_summary"]) == len(meta["variables"])

    stale = engine.error("dataset.rows", {"dataset_id": ds, "snapshot_id": "snap_old", "offset": 0, "limit": 5,
                                          "columns": None, "sort": None})
    assert stale["code"] == -32002 and stale["data"]["type"] == "StaleOrUnknown"
    bad = engine.error("dataset.rows", {"dataset_id": ds, "snapshot_id": None, "offset": 0, "limit": 5000,
                                        "columns": None, "sort": None})
    assert bad["code"] == -32003 and bad["data"]["errors"]
    unknown = engine.error("dataset.import", {"preview_id": "pv_gone", "files": [decision({
        "file_id": "f", "sheet_name": None, "encoding": None, "delimiter": None,
        "qualtrics": {"header_rows": 1}})], "row_filters": [], "variables": [], "stack": None})
    assert unknown["code"] == -32002
    missing = engine.error("dataset.import_preview", {"files": [{"path": "/nonexistent/x.csv", "sheet_name": None}],
                                                      "qualtrics_mode": "auto", "stack_onto_dataset_id": None})
    assert missing["code"] == -32001 and missing["data"]["type"] == "FileUnreadable"


def test_stack_and_link(engine):
    tg = PRACTICE / "three_groups_prepost_followup"
    pv = _preview(engine, tg / "pre.csv", tg / "post.csv")
    labels = ["Pre", "Post"]
    meta = engine.call("dataset.import", {
        "preview_id": pv["preview_id"], "files": [decision(f, time_label=l) for f, l in zip(pv["files"], labels)],
        "row_filters": [], "variables": [],
        "stack": {"time_variable": "Time", "column_matches": pv["stack_proposal"],
                  "levels": [{"file_id": f["file_id"], "label": l} for f, l in zip(pv["files"], labels)]},
    })["dataset_meta"]
    pv2 = _preview(engine, tg / "followup.csv", onto=meta["dataset_id"])
    f = pv2["files"][0]
    res = engine.call("dataset.stack", {
        "dataset_id": meta["dataset_id"], "preview_id": pv2["preview_id"],
        "files": [decision(f, time_label="Follow-up")], "row_filters": [], "variables": [],
        "stack": {"time_variable": "Time", "column_matches": pv2["stack_proposal"],
                  "levels": [{"file_id": f["file_id"], "label": "Follow-up"}]}})
    assert res["dataset_meta"]["n_rows"] == 352

    lk = PRACTICE / "linked_id_prepost"
    pv = _preview(engine, lk / "pre.csv", lk / "post.csv")
    meta = engine.call("dataset.import", {
        "preview_id": pv["preview_id"], "files": [decision(f, time_label=l) for f, l in zip(pv["files"], labels)],
        "row_filters": [], "variables": [],
        "stack": {"time_variable": "Time", "column_matches": pv["stack_proposal"],
                  "levels": [{"file_id": f["file_id"], "label": l} for f, l in zip(pv["files"], labels)]},
    })["dataset_meta"]
    link = engine.call("dataset.link", {"dataset_id": meta["dataset_id"], "mode": "linked", "id_variable": "Q1",
                                        "normalization": None})
    Rpc.DatasetLinkResult.model_validate(link)
    assert link["report"]["counts"] == {"matched": 75, "unmatched": 9, "duplicate": 2}


def test_project_roundtrip_across_engine_restarts(engine, tmp_path):
    meta = _import_messy(engine, drop_pii=False)
    ds = meta["dataset_id"]
    rows_before = engine.call("dataset.rows", {"dataset_id": ds, "snapshot_id": None, "offset": 0, "limit": 2000,
                                               "columns": None, "sort": None})
    path = tmp_path / "messy.statly"
    auto_dir = tmp_path / "auto"
    project = frontend_project({**meta, "n_rows": 0})  # engine substitutes its authoritative meta
    auto = engine.call("project.autosave", {"autosave_dir": str(auto_dir), "original_path": None,
                                            "project": project})
    rec = engine.call("project.recoverable", {"autosave_dir": str(auto_dir)})
    assert [a["autosave_path"] for a in rec["autosaves"]] == [auto["autosave_path"]]
    saved = engine.call("project.save", {"path": str(path), "project": project})
    Rpc.ProjectSaveResult.model_validate(saved)
    assert saved["project"]["dataset_meta"] == meta
    assert engine.call("project.recoverable", {"autosave_dir": str(auto_dir)})["autosaves"] == []

    second = EngineClient()
    try:
        loaded = second.call("project.load", {"path": str(path)})
        assert loaded["is_autosave"] is False
        assert loaded["project"]["dataset_meta"] == meta
        DatasetMeta.model_validate(loaded["project"]["dataset_meta"])
        rows_after = second.call("dataset.rows", {"dataset_id": ds, "snapshot_id": meta["snapshot_id"],
                                                  "offset": 0, "limit": 2000, "columns": None, "sort": None})
        assert rows_after == rows_before

        a2 = second.call("project.autosave", {"autosave_dir": str(auto_dir), "original_path": None,
                                              "project": loaded["project"]})
        assert second.call("project.discard_autosave", {"autosave_path": a2["autosave_path"]}) == {"ok": True}
        assert second.call("project.recoverable", {"autosave_dir": str(auto_dir)})["autosaves"] == []

        future = tmp_path / "future.statly"
        with zipfile.ZipFile(future, "w") as zf:
            zf.writestr("project.json", json.dumps({**loaded["project"], "schema_version": 99}))
        err = second.error("project.load", {"path": str(future)})
        assert err["code"] == -32004 and err["data"]["type"] == "IncompatibleProject"
    finally:
        second.close()
