"""Phase 2 Variable Interview operations (SPEC §6): variables.update, scales, answer-key
scoring, computed variables, snapshot history (undo/redo) and its project persistence."""

from __future__ import annotations

import json
import math
import zipfile

import numpy as np
import pandas as pd
import pytest

from statly_engine.contracts import DatasetMeta
from statly_engine.data import importer
from statly_engine.data import project as proj
from statly_engine.data import variables as ops
from statly_engine.data.linking import normalize_id
from statly_engine.data.store import DatasetStore
from statly_engine.errors import InvalidParams, StaleOrUnknown
from statly_engine.rpc_methods import dataset as ds_rpc
from statly_engine.rpc_methods import session_handlers

from ._helpers import MESSY, PRACTICE, decision, ground_truth, import_single, preview, stack_config
from .test_project import frontend_project

TG = PRACTICE / "three_groups_prepost_followup"
OG = PRACTICE / "one_group_prepost_likert"
LINKED = PRACTICE / "linked_id_prepost"
Q5 = [f"Q5_{i}" for i in range(1, 7)]
H = session_handlers()


def stacked(store, paths, labels):
    pv = preview(store, *paths)
    return importer.commit_import(store, {
        "preview_id": pv["preview_id"], "files": [decision(f) for f in pv["files"]],
        "row_filters": [], "variables": [], "stack": stack_config(pv, labels)})


def call(store, method, params):
    """Through the RPC handler (pydantic validation of params and result)."""
    return H[method](store, params)


def var(meta, name):
    return next(v for v in meta["variables"] if v["name"] == name)


def df_of(store, meta):
    return store.get(meta["dataset_id"]).df


@pytest.fixture
def messy(store):
    return import_single(store, MESSY / "messy_3header.csv")


# ---------------------------------------------------------------------------
# variables.update
# ---------------------------------------------------------------------------
def test_update_batch_role_level_labels_order(store, messy):
    ds = messy["dataset_id"]
    res = call(store, "variables.update", {"dataset_id": ds, "updates": [
        {"name": "Q1", "role": "group", "level": "nominal", "label": "Consent",
         "value_labels": [{"value": "No", "label": "No"}, {"value": "Yes", "label": "Yes"}]},
        {"name": "Q6", "role": "likert_item", "missing_codes": [-99, 99]},
        {"name": "Q10", "display_order": 0},
    ]})
    meta = res["dataset_meta"]
    DatasetMeta.model_validate(meta)
    assert var(meta, "Q1")["role"] == "group" and var(meta, "Q1")["label"] == "Consent"
    assert [v["value"] for v in var(meta, "Q1")["value_labels"]] == ["No", "Yes"]
    assert var(meta, "Q6")["missing_codes"] == [-99, 99]
    orders = sorted(v["display_order"] for v in meta["variables"])
    assert orders == list(range(len(meta["variables"])))
    assert var(meta, "Q10")["display_order"] == 0
    assert meta["snapshot_id"] != messy["snapshot_id"]


def test_update_rejects_bad_patches(store, messy):
    ds = messy["dataset_id"]
    with pytest.raises(InvalidParams):
        call(store, "variables.update", {"dataset_id": ds, "updates": [{"name": "nope", "role": "group"}]})
    with pytest.raises(InvalidParams):  # dtype is not patchable (closed model)
        call(store, "variables.update", {"dataset_id": ds, "updates": [{"name": "Q1", "dtype": "integer"}]})
    with pytest.raises(InvalidParams):  # text can't be reverse-scored
        call(store, "variables.update", {"dataset_id": ds, "updates": [{"name": "Q9", "reverse_coded": True}]})
    with pytest.raises(InvalidParams):  # duplicate codes
        call(store, "variables.update", {"dataset_id": ds, "updates": [
            {"name": "Q6", "value_labels": [{"value": 1, "label": "a"}, {"value": 1, "label": "b"}]}]})
    with pytest.raises(StaleOrUnknown):
        call(store, "variables.update", {"dataset_id": ds, "snapshot_id": "snap_old",
                                         "updates": [{"name": "Q1", "role": "group"}]})


def test_noop_update_adds_no_history(store, messy):
    ds = messy["dataset_id"]
    call(store, "variables.update", {"dataset_id": ds, "updates": [{"name": "Q1", "role": "group"}]})
    call(store, "variables.update", {"dataset_id": ds, "updates": [{"name": "Q1", "role": "group"}]})
    assert len(call(store, "dataset.history", {"dataset_id": ds})["entries"]) == 2


# ---------------------------------------------------------------------------
# Scales + reverse-scoring
# ---------------------------------------------------------------------------
def _manual_q5(df, reverse=("Q5_4",), lo=1, hi=5, min_items=3):
    m = df[Q5].astype("float64").where(lambda x: x != -99)
    for r in reverse:
        m[r] = lo + hi - m[r]
    n = m.notna().sum(axis=1)
    return m.mean(axis=1).where(n >= min_items)


def test_matrix_scale_with_reverse_item(store, messy):
    ds = messy["dataset_id"]
    call(store, "variables.update", {"dataset_id": ds, "updates": [{"name": "Q5_4", "reverse_coded": True}]})
    res = call(store, "scales.upsert", {"dataset_id": ds, "scale": {
        "id": "scale_Q5", "name": "Classroom experience", "items": Q5, "scoring_method": "mean"}})
    meta = res["dataset_meta"]
    scale = meta["scales"][0]
    assert scale["min_items"] == 3  # default: half the items, rounded up
    assert scale["score_variable"] == "Classroom_experience_score"
    score = var(meta, scale["score_variable"])
    assert score["role"] == "scale_score" and score["computed"]["op"] == "scale_mean"
    assert score["display_order"] == var(meta, "Q5_6")["display_order"] + 1
    df = df_of(store, meta)
    expected = _manual_q5(df)
    np.testing.assert_allclose(df[scale["score_variable"]].to_numpy(), expected.to_numpy(), equal_nan=True)
    # Raw item values are never changed by reverse-scoring.
    assert df["Q5_4"].equals(df_of(store, messy)["Q5_4"])
    # Toggling reverse off recomputes the score.
    meta2 = call(store, "variables.update", {"dataset_id": ds, "updates": [
        {"name": "Q5_4", "reverse_coded": False}]})["dataset_meta"]
    np.testing.assert_allclose(df_of(store, meta2)[scale["score_variable"]].to_numpy(),
                               _manual_q5(df, reverse=()).to_numpy(), equal_nan=True)


def test_reverse_without_response_range_uses_observed_and_warns(store, messy):
    ds = messy["dataset_id"]
    call(store, "variables.update", {"dataset_id": ds, "updates": [
        {"name": "Q5_4", "reverse_coded": True, "response_range": None}]})
    res = call(store, "scales.upsert", {"dataset_id": ds, "scale": {
        "id": "scale_Q5", "name": "Q5", "items": Q5, "scoring_method": "sum", "min_items": 6}})
    assert [w["code"] for w in res["warnings"]] == ["reverse_range_observed"]
    assert res["warnings"][0]["variable"] == "Q5_4"
    df = df_of(store, res["dataset_meta"])
    obs = df["Q5_4"].astype("float64").where(lambda x: x != -99)
    lo, hi = obs.min(), obs.max()
    m = df[Q5].astype("float64").where(lambda x: x != -99)
    m["Q5_4"] = lo + hi - m["Q5_4"]
    expected = m.sum(axis=1).where(m.notna().sum(axis=1) == 6)
    np.testing.assert_allclose(df["Q5_score"].to_numpy(), expected.to_numpy(), equal_nan=True)


def test_min_items_and_missing_codes(store):
    """Synthetic frame: exact threshold behaviour and declared missing codes."""
    meta = import_single(store, MESSY / "messy_3header.csv")
    ds = meta["dataset_id"]
    df = df_of(store, meta)
    # Missing code -99 is excluded: rows with -99 answer fewer items.
    res = call(store, "scales.upsert", {"dataset_id": ds, "scale": {
        "id": "scale_Q5", "name": "Q5", "items": Q5, "scoring_method": "mean", "min_items": 6}})
    s = df_of(store, res["dataset_meta"])["Q5_score"]
    has_code = (df[Q5].astype("float64") == -99).any(axis=1) | df[Q5].isna().any(axis=1)
    assert s[has_code].isna().all() and s[~has_code].notna().all()
    # Declaring an extra missing code (5) removes those answers too.
    res = call(store, "variables.update", {"dataset_id": ds, "updates": [
        {"name": n, "missing_codes": [-99, 5]} for n in Q5]})
    s2 = df_of(store, res["dataset_meta"])["Q5_score"]
    assert s2.notna().sum() < s.notna().sum()
    with pytest.raises(InvalidParams):
        call(store, "scales.upsert", {"dataset_id": ds, "scale": {
            "id": "scale_Q5", "name": "Q5", "items": Q5, "scoring_method": "mean", "min_items": 7}})
    with pytest.raises(InvalidParams):  # text items can't be scaled
        call(store, "scales.upsert", {"dataset_id": ds, "scale": {
            "name": "Bad", "items": ["Q9", "Q10"], "scoring_method": "mean"}})


def test_one_group_prepost_scale_matches_ground_truth(store):
    gt = ground_truth("one_group_prepost_likert")
    meta = stacked(store, [OG / "pre.csv", OG / "post.csv"], ["Pre", "Post"])
    ds = meta["dataset_id"]
    call(store, "variables.update", {"dataset_id": ds, "updates": [
        {"name": n, "reverse_coded": True} for n in gt["reverse_worded_items"]]})
    res = call(store, "scales.upsert", {"dataset_id": ds, "scale": {
        "id": meta["scales"][0]["id"], "name": "Attitude", "items": gt["matrix_items"], "scoring_method": "mean"}})
    df = df_of(store, res["dataset_meta"])
    means = df.groupby("Time")["Attitude_score"].mean()
    assert means["Pre"] == pytest.approx(gt["achieved"]["pre_scale_mean"], abs=1e-4)
    assert means["Post"] == pytest.approx(gt["achieved"]["post_scale_mean"], abs=1e-4)


def test_move_item_between_scales_and_delete(store, messy):
    ds = messy["dataset_id"]
    call(store, "scales.upsert", {"dataset_id": ds, "scale": {
        "id": "scale_Q5", "name": "Q5", "items": Q5, "scoring_method": "mean"}})
    res = call(store, "scales.upsert", {"dataset_id": ds, "scale": {
        "name": "Other", "items": ["Q5_5", "Q5_6"], "scoring_method": "sum"}})
    meta = res["dataset_meta"]
    q5 = next(s for s in meta["scales"] if s["id"] == "scale_Q5")
    other = next(s for s in meta["scales"] if s["name"] == "Other")
    assert q5["items"] == Q5[:4] and var(meta, "Q5_5")["scale_id"] == other["id"]
    assert var(meta, "Q5_score")["computed"]["items"] == Q5[:4]
    assert other["min_items"] == 2  # sum default: all items
    res = call(store, "scales.delete", {"dataset_id": ds, "scale_id": other["id"]})
    meta = res["dataset_meta"]
    assert other["score_variable"] not in {v["name"] for v in meta["variables"]}
    assert other["score_variable"] not in df_of(store, meta).columns
    assert var(meta, "Q5_5")["scale_id"] is None


# ---------------------------------------------------------------------------
# Answer-key scoring
# ---------------------------------------------------------------------------
def test_answer_key_scoring_three_groups(store):
    gt = ground_truth("three_groups_prepost_followup")
    meta = stacked(store, [TG / "pre.csv", TG / "post.csv", TG / "followup.csv"], ["pre", "post", "fu"])
    ds = meta["dataset_id"]
    key = call(store, "items.parse_answer_key", {"path": str(TG / "answer_key.csv")})
    assert len(key["entries"]) == gt["n_items"] and key["warnings"] == []
    res = call(store, "items.score", {"dataset_id": ds, "key": key["entries"]})
    meta = res["dataset_meta"]
    total = var(meta, "Q4_total")
    assert total["role"] == "test_total" and total["computed"]["op"] == "scale_sum"
    item = var(meta, "Q4_1_correct")
    assert item["role"] == "test_item" and item["dtype"] == "integer"
    assert item["display_order"] == var(meta, "Q4_1")["display_order"] + 1
    df = df_of(store, meta)
    assert set(df["Q4_1_correct"].dropna().unique()) <= {0, 1}
    # Scored total equals Qualtrics' own SC0 and the planted proportion-correct per group/time.
    assert (df["Q4_total"] == df["SC0"].astype("float64")).all()
    prop = (df.groupby(["Q2", "Time"])["Q4_total"].mean() / gt["n_items"]).round(4)
    for group, times in gt["achieved"].items():
        for t, cell in times.items():
            assert prop[(group, t)] == pytest.approx(cell["mean_proportion_correct"], abs=1e-4)
    # Re-scoring replaces rather than duplicates.
    res2 = call(store, "items.score", {"dataset_id": ds, "key": key["entries"]})
    assert len(res2["dataset_meta"]["variables"]) == len(meta["variables"])


def test_answer_key_case_insensitive_and_unseen_key(store, tmp_path):
    pv = preview(store, TG / "pre.csv")
    meta = importer.commit_import(store, {"preview_id": pv["preview_id"], "files": [decision(pv["files"][0])],
                                          "row_filters": [], "variables": [], "stack": None})
    res = call(store, "items.score", {"dataset_id": meta["dataset_id"], "key": [
        {"item": "Q4_1", "correct": ["d"]}, {"item": "Q4_2", "correct": ["Z"]}]})
    df = df_of(store, res["dataset_meta"])
    assert (df["Q4_1_correct"] == (df["Q4_1"] == "D").astype(int)).all()
    assert (df["Q4_2_correct"] == 0).all()
    assert [w["code"] for w in res["warnings"]] == ["key_not_observed"]
    # Headerless key files are read as (question, answer).
    f = tmp_path / "key.csv"
    f.write_text("Q4_1,D\nQ4_2,A|B\n")
    parsed = call(store, "items.parse_answer_key", {"path": str(f)})
    assert parsed["entries"] == [{"item": "Q4_1", "correct": ["D"]}, {"item": "Q4_2", "correct": ["A", "B"]}]


# ---------------------------------------------------------------------------
# Computed variables
# ---------------------------------------------------------------------------
def _linked(store):
    meta = stacked(store, [LINKED / "pre.csv", LINKED / "post.csv"], ["Pre", "Post"])
    return ds_rpc.link(store, {"dataset_id": meta["dataset_id"], "mode": "linked", "id_variable": "Q1",
                               "normalization": {"trim_whitespace": True, "case_insensitive": True}})["dataset_meta"]


GAIN = {"op": "difference", "minuend": {"variable": "Q4", "time_level": "Post"},
        "subtrahend": {"variable": "Q4", "time_level": "Pre"}}


def test_gain_score_linked_is_participant_level(store):
    gt = ground_truth("linked_id_prepost")
    meta = _linked(store)
    ds = meta["dataset_id"]
    prev = call(store, "computed.preview", {"dataset_id": ds, "definition": GAIN})
    assert len(prev["values"]) == 10 and prev["dtype"] == "float"
    assert [w["code"] for w in prev["warnings"]] == ["duplicate_ids_at_level"]
    res = call(store, "computed.add", {"dataset_id": ds, "name": "gain", "label": "Gain", "definition": GAIN})
    df = df_of(store, res["dataset_meta"])
    ids = df["Q1"].astype(object).map(lambda v: normalize_id(v, True, True))
    # Independent computation.
    pre = df[df["Time"] == "Pre"].assign(id=ids).drop_duplicates("id", keep=False).set_index("id")["Q4"]
    post = df[df["Time"] == "Post"].assign(id=ids).drop_duplicates("id", keep=False).set_index("id")["Q4"]
    expected = (post - pre).dropna()
    per_person = df.assign(id=ids).groupby("id")["gain"]
    assert (per_person.nunique(dropna=True) <= 1).all()  # same value on every row of a participant
    got = per_person.first().dropna()
    assert set(got.index) == set(expected.index)
    np.testing.assert_allclose(got.sort_index().to_numpy(), expected.sort_index().astype(float).to_numpy())
    dup_ids = {normalize_id(d, True, True) for d in gt["duplicated_ids"]}
    assert df.loc[ids.isin(dup_ids), "gain"].isna().all()
    assert got.mean() == pytest.approx(gt["true_design"]["post_gain_mean_target"], abs=2.5)
    assert prev["values"] == [None if pd.isna(x) else x for x in df["gain"].iloc[:10]]


def test_time_level_operands_need_linking(store):
    meta = stacked(store, [LINKED / "pre.csv", LINKED / "post.csv"], ["Pre", "Post"])
    with pytest.raises(InvalidParams, match="link people"):
        call(store, "computed.add", {"dataset_id": meta["dataset_id"], "name": "gain", "definition": GAIN})


def test_normalized_gain_recode_scale_and_remove(store):
    meta = _linked(store)
    ds = meta["dataset_id"]
    ng = {"op": "normalized_gain", "pre": {"variable": "Q4", "time_level": "Pre"},
          "post": {"variable": "Q4", "time_level": "Post"}, "max_score": 100}
    meta = call(store, "computed.add", {"dataset_id": ds, "name": "ngain", "definition": ng})["dataset_meta"]
    call(store, "computed.add", {"dataset_id": ds, "name": "gain", "definition": GAIN})
    df = df_of(store, meta)
    ok = df["gain"].notna()
    pre_rows = df[df["Time"] == "Pre"]
    ids = df["Q1"].astype(object).map(lambda v: normalize_id(v, True, True))
    pre_by_id = dict(zip(ids[pre_rows.index], pre_rows["Q4"]))
    pre_val = ids.map(pre_by_id).astype(float)
    np.testing.assert_allclose(df.loc[ok, "ngain"], (df.loc[ok, "gain"] / (100 - pre_val[ok])))
    rec = {"op": "recode", "source": "Q4", "unmatched": "missing", "rules": [
        {"from_values": None, "from_range": {"min": 0, "max": 49.999}, "to": "low"},
        {"from_values": None, "from_range": {"min": 50, "max": 100}, "to": "high"}]}
    meta = call(store, "computed.add", {"dataset_id": ds, "name": "band", "definition": rec})["dataset_meta"]
    assert var(meta, "band")["dtype"] == "string"
    df = df_of(store, meta)
    assert ((df["Q4"] >= 50) == (df["band"] == "high")).all()
    with pytest.raises(InvalidParams):  # name clash
        call(store, "computed.add", {"dataset_id": ds, "name": "band", "definition": rec})
    with pytest.raises(InvalidParams):  # imported variables can't be removed
        call(store, "computed.remove", {"dataset_id": ds, "name": "Q4"})
    meta = call(store, "computed.remove", {"dataset_id": ds, "name": "band"})["dataset_meta"]
    assert "band" not in df_of(store, meta).columns


def test_row_level_difference_and_scale_builder_op(store):
    meta = stacked(store, [TG / "pre.csv", TG / "post.csv"], ["pre", "post"])
    ds = meta["dataset_id"]
    key = call(store, "items.parse_answer_key", {"path": str(TG / "answer_key.csv")})
    call(store, "items.score", {"dataset_id": ds, "key": key["entries"]})
    diff = {"op": "difference", "minuend": {"variable": "Q4_total", "time_level": None},
            "subtrahend": {"variable": "SC0", "time_level": None}}
    meta = call(store, "computed.add", {"dataset_id": ds, "name": "check", "definition": diff})["dataset_meta"]
    assert (df_of(store, meta)["check"] == 0).all()
    with pytest.raises(InvalidParams):  # dependents block removal
        call(store, "computed.remove", {"dataset_id": ds, "name": "Q4_total"})


# ---------------------------------------------------------------------------
# History: undo/redo and persistence
# ---------------------------------------------------------------------------
def test_restore_round_trip_and_redo_truncation(store, messy):
    ds = messy["dataset_id"]
    s0 = messy["snapshot_id"]
    df0 = df_of(store, messy).copy()
    m1 = call(store, "variables.update", {"dataset_id": ds, "updates": [{"name": "Q5_4", "reverse_coded": True}]})
    m2 = call(store, "scales.upsert", {"dataset_id": ds, "scale": {
        "id": "scale_Q5", "name": "Q5", "items": Q5, "scoring_method": "mean"}})
    s1, s2 = m1["dataset_meta"]["snapshot_id"], m2["dataset_meta"]["snapshot_id"]
    hist = call(store, "dataset.history", {"dataset_id": ds})
    assert [e["snapshot_id"] for e in hist["entries"]] == [s0, s1, s2] and hist["cursor"] == 2
    assert [e["label"] for e in hist["entries"]] == ["Imported data", "Changed reverse-scoring of Q5_4",
                                                     "Scored scale Q5"]
    # Undo twice -> original data and metadata.
    call(store, "dataset.restore_snapshot", {"dataset_id": ds, "snapshot_id": s1})
    back = call(store, "dataset.restore_snapshot", {"dataset_id": ds, "snapshot_id": s0})["dataset_meta"]
    assert back == messy
    pd.testing.assert_frame_equal(df_of(store, back), df0)
    rows = ds_rpc.rows(store, {"dataset_id": ds, "snapshot_id": s0, "offset": 0, "limit": 5, "columns": None,
                               "sort": None})
    assert "Q5_score" not in rows["columns"]
    # Redo.
    redo = call(store, "dataset.restore_snapshot", {"dataset_id": ds, "snapshot_id": s2})["dataset_meta"]
    assert "Q5_score" in df_of(store, redo).columns
    # Undo then a new edit drops the redo tail.
    call(store, "dataset.restore_snapshot", {"dataset_id": ds, "snapshot_id": s1})
    call(store, "variables.update", {"dataset_id": ds, "updates": [{"name": "Q1", "role": "group"}]})
    hist = call(store, "dataset.history", {"dataset_id": ds})
    assert [e["snapshot_id"] for e in hist["entries"]][:2] == [s0, s1] and len(hist["entries"]) == 3
    with pytest.raises(StaleOrUnknown):
        call(store, "dataset.restore_snapshot", {"dataset_id": ds, "snapshot_id": s2})


def test_repeated_content_gets_unique_snapshot_ids(store, messy):
    ds = messy["dataset_id"]
    for flag in (True, False, True):
        call(store, "variables.update", {"dataset_id": ds, "updates": [{"name": "Q5_4", "reverse_coded": flag}]})
    ids = [e["snapshot_id"] for e in call(store, "dataset.history", {"dataset_id": ds})["entries"]]
    assert len(ids) == 4 and len(set(ids)) == 4
    assert ids[2].startswith(ids[0]) and ids[3].startswith(ids[1])
    back = call(store, "dataset.restore_snapshot", {"dataset_id": ds, "snapshot_id": ids[2]})
    assert call(store, "dataset.history", {"dataset_id": ds})["cursor"] == 2
    assert var(back["dataset_meta"], "Q5_4")["reverse_coded"] is False


def test_project_save_load_keeps_history_labels(store, messy, tmp_path):
    ds = messy["dataset_id"]
    call(store, "variables.update", {"dataset_id": ds, "updates": [{"name": "Q5_4", "reverse_coded": True}]})
    meta = call(store, "scales.upsert", {"dataset_id": ds, "scale": {
        "id": "scale_Q5", "name": "Q5", "items": Q5, "scoring_method": "mean"}})["dataset_meta"]
    labels = [e["label"] for e in call(store, "dataset.history", {"dataset_id": ds})["entries"]]
    path = tmp_path / "p.statly"
    proj.save(store, str(path), frontend_project(meta), "test")
    with zipfile.ZipFile(path) as zf:
        saved = json.loads(zf.read("history.json"))
    assert [e["label"] for e in saved] == labels and saved[-1]["current"] is True

    fresh = DatasetStore()
    loaded = proj.load(fresh, str(path))
    assert loaded["project"]["dataset_meta"]["snapshot_id"] == meta["snapshot_id"]
    hist = call(fresh, "dataset.history", {"dataset_id": ds})
    assert [e["label"] for e in hist["entries"]] == labels
    assert [e["restorable"] for e in hist["entries"]] == [False, False, True]
    assert hist["cursor"] == 2
    with pytest.raises(StaleOrUnknown):
        call(fresh, "dataset.restore_snapshot", {"dataset_id": ds, "snapshot_id": hist["entries"][0]["snapshot_id"]})
    np.testing.assert_allclose(fresh.get(ds).df["Q5_score"], store.get(ds).df["Q5_score"], equal_nan=True)
    # New edits after load keep extending the saved history.
    call(fresh, "variables.update", {"dataset_id": ds, "updates": [{"name": "Q1", "role": "group"}]})
    assert len(call(fresh, "dataset.history", {"dataset_id": ds})["entries"]) == 4
    # Save -> load -> save keeps the same labels.
    proj.save(fresh, str(tmp_path / "q.statly"), frontend_project(fresh.get(ds).meta), "test")
    with zipfile.ZipFile(tmp_path / "q.statly") as zf:
        assert [e["label"] for e in json.loads(zf.read("history.json"))] == labels + ["Changed role of Q1"]


def test_all_results_validate_against_contract(store, messy):
    """Every edit returns a DatasetMeta that validates (computed defs, scales, variables)."""
    ds = messy["dataset_id"]
    res = call(store, "scales.upsert", {"dataset_id": ds, "scale": {
        "name": "Q5", "id": "scale_Q5", "items": Q5, "scoring_method": "mean", "min_items": None}})
    DatasetMeta.model_validate(res["dataset_meta"])
    assert res["dataset_meta"]["scales"][0]["min_items"] is None
    assert not math.isnan(df_of(store, res["dataset_meta"])["Q5_score"].mean())
