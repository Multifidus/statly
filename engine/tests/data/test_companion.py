"""Companion-labels pairs: one survey exported as numbers and as choice text becomes one dataset."""

from __future__ import annotations

import zipfile
from types import SimpleNamespace

import pandas as pd
import pytest

from statly_engine.contracts import DatasetMeta, Rpc
from statly_engine.data import companion as cx
from statly_engine.data import importer
from statly_engine.data import project as proj
from statly_engine.data.store import DatasetStore
from statly_engine.errors import InvalidParams

from ._helpers import MESSY, PRACTICE, decision, preview
from .test_project import frontend_project

NUMBERS = MESSY / "messy_3header.csv"
WORDS = MESSY / "messy_text_choices.csv"
AGREE = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"]


def _commit(store, pv, *, companion=True, filters=()):
    pair = pv["companion_pair"]
    return importer.commit_import(store, {
        "preview_id": pv["preview_id"], "files": [decision(f) for f in pv["files"]],
        "row_filters": list(filters), "variables": [], "stack": None,
        "companion": {"values_file_id": pair["values_file_id"], "labels_file_id": pair["labels_file_id"]}
        if companion else None,
    })


def test_numbers_and_words_import_as_one_labelled_dataset(store, tmp_path):
    # Words file listed first: detection, not order, decides which file holds the data.
    pv = preview(store, WORDS, NUMBERS)
    Rpc.DatasetImportPreviewResult.model_validate(pv)
    pair = pv["companion_pair"]
    by_id = {f["file_id"]: f for f in pv["files"]}
    assert by_id[pair["values_file_id"]]["name"] == "messy_3header.csv"
    assert by_id[pair["labels_file_id"]]["name"] == "messy_text_choices.csv"
    assert pair["columns_matched"] == 7  # Q5_1..Q5_6, Q6
    note = by_id[pair["values_file_id"]]["issues"][0]
    assert note["code"] == "companion_pair" and note["severity"] == "info"
    assert "Statly will keep the numbers and attach the words as labels" in note["message"]

    meta = _commit(store, pv)
    DatasetMeta.model_validate(meta)
    assert meta["n_rows"] == 113 and meta["stacking"] is None
    df = store.get(meta["dataset_id"]).df
    assert len(df) == 113 and "Time" not in df.columns
    q = {v["name"]: v for v in meta["variables"]}["Q5_1"]
    assert str(df["Q5_1"].dtype) == "Int64" and q["dtype"] == "integer"
    assert q["level"] == "ordinal"
    assert q["value_labels"] == [{"value": i + 1, "label": t} for i, t in enumerate(AGREE)]
    assert -99 in q["missing_codes"]
    # Codes are the numbers file's values, untouched.
    raw = pd.read_csv(NUMBERS, skiprows=[1, 2], encoding="utf-8-sig", dtype=str)
    assert df["Q5_1"].astype("float").fillna(-1).tolist() == raw["Q5_1"].astype(float).fillna(-1).tolist()

    files = meta["import_log"]["files"]
    assert [f["name"] for f in files] == ["messy_3header.csv", "messy_text_choices.csv"]
    assert "role" not in files[0] and files[1]["role"] == "value_labels" and files[1]["n_rows_kept"] == 0

    # The words file travels with the project and survives save/load.
    path = tmp_path / "pair.statly"
    proj.save(store, str(path), frontend_project(meta), "0.1.0")
    with zipfile.ZipFile(path) as zf:
        assert zf.read(files[1]["stored_path"]) == WORDS.read_bytes()
    fresh = DatasetStore()
    loaded = proj.load(fresh, str(path))
    assert loaded["project"]["dataset_meta"] == meta
    assert set(fresh.get(meta["dataset_id"]).originals) == {files[0]["file_id"], files[1]["file_id"]}


def test_row_filters_apply_to_the_numbers_file(store):
    pv = preview(store, NUMBERS, WORDS)
    values = next(f for f in pv["files"] if f["file_id"] == pv["companion_pair"]["values_file_id"])
    filters = [f for f in values["suggested_row_filters"] if f["kind"] == "exclude_values"]
    meta = _commit(store, pv, filters=filters)
    assert meta["n_rows"] < 113
    assert {v["name"]: v for v in meta["variables"]}["Q5_1"]["value_labels"][0]["label"] == "Strongly disagree"


def test_different_waves_are_not_a_companion_pair(store):
    for folder in ("one_group_prepost_likert", "linked_id_prepost"):
        pv = preview(store, PRACTICE / folder / "pre.csv", PRACTICE / folder / "post.csv")
        assert pv["companion_pair"] is None, folder
        assert all(i["code"] != "companion_pair" for f in pv["files"] for i in f["issues"])
    # Same export listed twice: identical files are not numbers + words either.
    assert preview(store, NUMBERS, NUMBERS)["companion_pair"] is None


def test_commit_rejects_a_pair_the_preview_did_not_find(store):
    pv = preview(store, PRACTICE / "one_group_prepost_likert" / "pre.csv",
                 PRACTICE / "one_group_prepost_likert" / "post.csv")
    ids = [f["file_id"] for f in pv["files"]]
    with pytest.raises(InvalidParams):
        importer.commit_import(store, {
            "preview_id": pv["preview_id"], "files": [decision(f) for f in pv["files"]], "row_filters": [],
            "variables": [], "stack": None, "companion": {"values_file_id": ids[0], "labels_file_id": ids[1]}})


def test_three_files_flag_the_pair_without_combining(store):
    pv = preview(store, NUMBERS, WORDS, MESSY / "messy_2header.csv")
    assert pv["companion_pair"] is None
    assert any(i["code"] == "companion_pair_not_combined" for f in pv["files"] for i in f["issues"])


def _staged(fid, frame):
    return SimpleNamespace(file_id=fid, name=f"{fid}.csv", data=pd.DataFrame(frame, dtype=object))


def test_conflicting_codes_leave_the_column_unlabelled():
    ids = [f"R_{i}" for i in range(6)]
    nums = _staged("n", {"ResponseId": ids, "Q1": ["1", "2", "1", "2", "3", "3"], "Q2": ["1", "2", "1", "2", "1", "2"]})
    # Words file rows in another order: alignment is by ResponseId.
    order = [5, 4, 3, 2, 1, 0]
    q1 = ["Low", "High", "Low", "High", "Mid", "Other"]  # code 3 -> two different words
    q2 = ["No", "Yes", "No", "Yes", "No", "Yes"]
    words = _staged("w", {"ResponseId": [ids[i] for i in order], "Q1": [q1[i] for i in order],
                          "Q2": [q2[i] for i in order]})
    m = cx.match(words, nums)
    assert m is not None and m.values is nums and m.columns == ["Q1", "Q2"]
    props = {c: {"dtype": "integer", "missing_codes": []} for c in ("Q1", "Q2")}
    labels, problems = cx.pair_labels(m, props)
    assert labels == {"Q2": [{"value": 1, "label": "No"}, {"value": 2, "label": "Yes"}]}
    assert [c for c, _ in problems] == ["Q1"]


def test_different_response_ids_are_not_a_pair():
    a = _staged("a", {"ResponseId": ["R_1", "R_2"], "Q1": ["1", "2"]})
    b = _staged("b", {"ResponseId": ["R_1", "R_3"], "Q1": ["No", "Yes"]})
    assert cx.match(a, b) is None
    # Without ResponseId, rows pair by position, but numbers vs numbers is a different wave.
    c = _staged("c", {"Q1": ["1", "2"]})
    d = _staged("d", {"Q1": ["2", "2"]})
    assert cx.match(c, d) is None


def test_companion_through_the_rpc_server(engine):
    pv = engine.call("dataset.import_preview", {
        "files": [{"path": str(p), "sheet_name": None} for p in (NUMBERS, WORDS)], "qualtrics_mode": "auto",
        "stack_onto_dataset_id": None})
    pair = pv["companion_pair"]
    values = next(f for f in pv["files"] if f["file_id"] == pair["values_file_id"])
    res = engine.call("dataset.import", {
        "preview_id": pv["preview_id"], "files": [decision(values)], "row_filters": [], "variables": [],
        "stack": None, "companion": {"values_file_id": pair["values_file_id"], "labels_file_id": pair["labels_file_id"]}})
    Rpc.DatasetResult.model_validate(res)
    meta = res["dataset_meta"]
    assert meta["n_rows"] == 113
    assert {v["name"]: v for v in meta["variables"]}["Q6"]["value_labels"][-1] == {"value": 7, "label": "Strongly agree"}
