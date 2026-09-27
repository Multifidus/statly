"""survey.parse / survey.suggest and dataset.import's `survey` through the real stdio server."""

from __future__ import annotations

import zipfile

from statly_engine.contracts import DatasetMeta, Rpc

from ._helpers import MESSY, decision, ground_truth
from .test_project import frontend_project
from engine_client import EngineClient

GT = ground_truth("messy_qualtrics")
QSF = MESSY / "survey.qsf"
CSV = MESSY / "messy_3header.csv"
AGREE = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"]


def _import(engine, survey_path=None):
    pv = engine.call("dataset.import_preview", {"files": [{"path": str(CSV), "sheet_name": None}],
                                                "qualtrics_mode": "auto", "stack_onto_dataset_id": None})
    fp = pv["files"][0]
    params = {"preview_id": pv["preview_id"], "files": [decision(fp)], "row_filters": [], "variables": [],
              "stack": None}
    if survey_path is not None:
        params["survey"] = {"file_path": str(survey_path)}
    return pv, params


def test_parse_and_suggest_over_rpc(engine, tmp_path):
    parsed = engine.call("survey.parse", {"file_path": str(QSF)})
    Rpc.SurveyParseResult.model_validate(parsed)
    survey = parsed["survey"]
    assert survey["name"] == "Course Experience Survey – Fall"
    assert any(i["code"] == "survey_note" for i in parsed["issues"])  # Trash question note

    # Before import: match against an import preview's proposed variables.
    pv, params = _import(engine, QSF)
    pre = engine.call("survey.suggest", {"survey": survey, "variables": pv["files"][0]["proposed_variables"]})
    Rpc.SurveySuggestResult.model_validate(pre)
    assert "Q5_1" in [c["name"] for c in pre["columns"]]

    meta = engine.call("dataset.import", params)["dataset_meta"]
    DatasetMeta.model_validate(meta)
    log = meta["import_log"]["files"]
    assert [f.get("role", "data") for f in log] == ["data", "survey"]
    assert log[1]["format"] == "qsf" and log[1]["n_rows_kept"] == 0 and log[1]["name"] == "survey.qsf"
    assert len(meta["variables"]) == len(
        engine.call("dataset.import", _import(engine)[1])["dataset_meta"]["variables"])  # adds no variables

    for extra in ({"survey": survey}, {}):  # explicit survey, or the one stored with the dataset
        res = engine.call("survey.suggest", {"dataset_id": meta["dataset_id"], "snapshot_id": meta["snapshot_id"],
                                             **extra})
        Rpc.SurveySuggestResult.model_validate(res)
        cols = {c["name"]: c for c in res["columns"]}
        assert cols["Q5_1"]["label"] == "I enjoy coming to this class"
        assert [v["label"] for v in cols["Q5_1"]["value_labels"]] == AGREE
        assert cols["Q5_1"]["role"] == "likert_item" and cols["Q9"]["role"] == "open_text"
        assert res["scales"][0]["name"] == "Q5" and res["scales"][0]["items"] == GT["matrix_block"]["columns"]
        assert res["survey_name"] == survey["name"]

    # Saved and reloaded in a fresh engine: the .qsf original travels with the project.
    path = tmp_path / "survey.statly"
    engine.call("project.save", {"path": str(path), "project": frontend_project({**meta, "n_rows": 0})})
    with zipfile.ZipFile(path) as zf:
        assert zf.read(log[1]["stored_path"]) == QSF.read_bytes()
    second = EngineClient()
    try:
        loaded = second.call("project.load", {"path": str(path)})["project"]["dataset_meta"]
        res = second.call("survey.suggest", {"dataset_id": loaded["dataset_id"], "snapshot_id": None})
        assert {c["name"] for c in res["columns"]} >= set(GT["matrix_block"]["columns"])
    finally:
        second.close()


def test_survey_errors(engine, tmp_path):
    err = engine.error("survey.parse", {"file_path": str(CSV)})
    assert err["code"] == -32001 and err["data"]["type"] == "FileUnreadable"
    assert engine.error("survey.parse", {"file_path": str(tmp_path / "nope.qsf")})["code"] == -32001
    # A bad survey file fails the import (nothing committed).
    _, params = _import(engine, CSV)
    assert engine.error("dataset.import", params)["code"] == -32001
    meta = engine.call("dataset.import", _import(engine)[1])["dataset_meta"]
    no_survey = engine.error("survey.suggest", {"dataset_id": meta["dataset_id"]})
    assert no_survey["code"] == -32003
    assert engine.error("survey.suggest", {})["code"] == -32003
    stale = engine.error("survey.suggest", {"dataset_id": meta["dataset_id"], "snapshot_id": "snap_old"})
    assert stale["code"] == -32002
