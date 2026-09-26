"""SPEC §12 Qualtrics parsing cases against fixtures/practice/messy_qualtrics/ground_truth.json."""

from __future__ import annotations

import pandas as pd
import pytest

from statly_engine.data import importer
from statly_engine.errors import InvalidParams

from ._helpers import MESSY, MESSY_FILES, decision, ground_truth, import_single, preview

GT = ground_truth("messy_qualtrics")


def _fp(store, name):
    return preview(store, MESSY / name)["files"][0]


def _var(fp, name):
    return next(v for v in fp["proposed_variables"] if v["name"] == name)


@pytest.mark.parametrize("name", MESSY_FILES)
def test_detection_matches_ground_truth(store, name):
    fp = _fp(store, name)
    gt = GT["files"][name]
    assert fp["qualtrics"]["detected"] is True
    assert fp["qualtrics"]["header_rows"] == gt["header_rows"]
    assert fp["n_rows"] == GT["n_rows_total"]
    if name.endswith(".xlsx"):
        assert fp["format"] == "xlsx" and fp["sheets"] == gt["sheets"] and fp["sheet_name"] == gt["data_sheet"]
        assert fp["encoding"] is None and fp["delimiter"] is None
    else:
        assert fp["encoding"] == gt["encoding"] and fp["delimiter"] == gt["delimiter"]

    names = [v["name"] for v in fp["proposed_variables"]]
    assert "Q10" in names and names[0] == "StartDate"
    q5 = _var(fp, "Q5_1")
    assert q5["question_text"] == "Matrix statement 1 about classroom experience"
    assert q5["sources"][0]["qualtrics_import_id"] == ("Q5_1" if gt["header_rows"] == 3 else None)
    assert len(q5["sources"][0]["header_texts"]) == gt["header_rows"]

    # PII: structural columns flagged; the Q9 email look-alike is NOT flagged but reported.
    assert {v["name"] for v in fp["proposed_variables"] if v["is_pii"]} == set(GT["pii_columns"])
    assert all(v["pii_reason"] for v in fp["proposed_variables"] if v["is_pii"])
    for col in GT["pii_lookalike_columns"]:
        assert not _var(fp, col)["is_pii"]
        assert any(i["code"] == "embedded_email" and i["column"] == col for i in fp["issues"])

    # Metadata + timing hidden by default.
    for col in GT["timing_columns"] + ["StartDate", "Status", "ResponseId", "UserLanguage"]:
        assert _var(fp, col)["is_metadata"], col
    assert not _var(fp, "Q5_1")["is_metadata"]

    # Matrix -> suggested scale; _TEXT and open-ended -> open_text; SC0 -> test total.
    scales = fp["suggested_scales"]
    assert [s["items"] for s in scales] == [GT["matrix_block"]["columns"]]
    assert scales[0]["origin"] == "matrix_suggestion"
    assert all(_var(fp, c)["role"] == "likert_item" for c in GT["matrix_block"]["columns"])
    assert _var(fp, GT["multiselect_other_text_column"])["role"] == "open_text"
    for col in GT["open_ended_columns"]:
        assert _var(fp, col)["role"] == "open_text"
    assert _var(fp, GT["score_column"])["role"] == "test_total"

    # Multi-select.
    assert fp["multiselect_candidates"] == [GT["multiselect_column"]]
    opts = [vl["label"] for vl in _var(fp, "Q7")["value_labels"]]
    assert set(opts) == set(GT["multiselect_options"])

    # Row filters with would-remove counts.
    by_kind = {f["kind"]: f for f in fp["suggested_row_filters"]}
    assert by_kind["exclude_values"]["rows_removed"] == GT["n_survey_preview"] + GT["n_spam"]
    assert by_kind["exclude_unfinished"]["rows_removed"] == GT["n_unfinished"]
    assert all(f["explanation"] for f in fp["suggested_row_filters"])

    # Missing-code sentinel proposed on Q5_*/Q6.
    assert _var(fp, "Q6")["missing_codes"] == [GT["missing_code"]]


@pytest.mark.parametrize("name", ["messy_3header.csv", "messy_utf16.csv", "messy.xlsx"])
def test_numeric_export_warns_noncontiguous_q6(store, name):
    fp = _fp(store, name)
    issue = next(i for i in fp["issues"] if i["code"] == "noncontiguous_codes")
    assert issue["column"] == "Q6" and issue["severity"] == "caution"
    for v in GT["q6_recode_values"]:
        assert str(v) in issue["message"]
    assert any(i["code"] == "confirm_numeric_codes" for i in fp["issues"])


def test_text_choices_detect_response_set(store):
    fp = _fp(store, "messy_text_choices.csv")
    q5 = _var(fp, "Q5_1")
    assert q5["dtype"] == "integer" and q5["level"] == "ordinal"
    assert [vl["label"] for vl in q5["value_labels"]] == [
        "Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"]
    assert [vl["value"] for vl in q5["value_labels"]] == [1, 2, 3, 4, 5]
    assert q5["missing_codes"] == [-99]
    assert {i["column"] for i in fp["issues"] if i["code"] == "choice_text_detected"} >= {"Q5_1", "Q6"}
    assert fp["sample_rows"] and len(fp["sample_rows"][0]) == len(fp["proposed_variables"])


def _text_choice_overrides(store) -> list[dict]:
    """The user confirms Q6's numeric coding as Qualtrics' recode values 1,2,4,5,7."""
    fp = _fp(store, "messy_text_choices.csv")
    q6 = dict(_var(fp, "Q6"))
    q6["value_labels"] = [{"value": code, "label": vl["label"]}
                          for code, vl in zip(GT["q6_recode_values"], q6["value_labels"])]
    q6["sources"] = [{**q6["sources"][0], "file_id": "ignored"}]
    return [q6]


def test_all_five_variants_yield_identical_data(store):
    frames, metas = {}, {}
    for name in MESSY_FILES:
        variables = []
        if name == "messy_text_choices.csv":
            variables = _text_choice_overrides(store)
        meta = import_single(store, MESSY / name, variables=variables)
        frames[name] = store.get(meta["dataset_id"]).df
        metas[name] = meta
    ref = frames["messy_3header.csv"]
    assert ref.shape == (GT["n_rows_total"], 1 + 34)
    for name, df in frames.items():
        pd.testing.assert_frame_equal(df, ref, check_exact=True, obj=name)
        assert [(v["name"], v["dtype"]) for v in metas[name]["variables"]] == \
               [(v["name"], v["dtype"]) for v in metas["messy_3header.csv"]["variables"]]
    # -99 kept as stored in every variant.
    assert int((ref[[f"Q5_{i}" for i in range(1, 7)] + ["Q6"]] == -99).sum().sum()) == GT["n_missing_code_cells"]
    # Multi-line quoted open text survives intact (some Q10 responses contain
    # embedded newlines and embedded double quotes; CSV round-trip must not corrupt them).
    assert ref["Q10"].str.contains("\n", na=False).any()
    assert ref["Q10"].str.contains('"extra practice"', regex=False, na=False).any()
    assert ref["Q10"].isna().any()  # a few blank responses (empty CSV field -> NA)


def test_row_filters_applied_in_order(store):
    fp_pv = preview(store, MESSY / "messy_3header.csv")
    fp = fp_pv["files"][0]
    filters = [f for f in fp["suggested_row_filters"] if f["kind"] in ("exclude_values", "exclude_unfinished")]
    meta = importer.commit_import(store, {
        "preview_id": fp_pv["preview_id"], "files": [decision(fp)], "row_filters": filters,
        "variables": [], "stack": None})
    applied = {f["kind"]: f["rows_removed"] for f in meta["import_log"]["row_filters"]}
    assert applied["exclude_values"] == GT["n_survey_preview"] + GT["n_spam"]
    assert applied["exclude_unfinished"] == 6  # unfinished among the valid rows (ground truth gotcha)
    assert meta["n_rows"] == GT["n_valid_after_status_filter"] - 6
    f = meta["import_log"]["files"][0]
    assert (f["n_rows_read"], f["n_rows_kept"]) == (GT["n_rows_total"], meta["n_rows"])
    df = store.get(meta["dataset_id"]).df
    assert not df["Status"].isin(["Survey Preview", "Spam"]).any()


def test_pii_dropped_only_when_requested(store):
    meta = import_single(store, MESSY / "messy_3header.csv")
    names = {v["name"] for v in meta["variables"]}
    assert set(GT["pii_columns"]) <= names  # never dropped implicitly
    meta = import_single(store, MESSY / "messy_3header.csv", drop=GT["pii_columns"])
    names = {v["name"] for v in meta["variables"]}
    assert not set(GT["pii_columns"]) & names
    assert {(d["column"], d["reason"]) for d in meta["import_log"]["dropped_columns"]} == \
           {(c, "pii") for c in GT["pii_columns"]}


def test_multiselect_split(store):
    fp = _fp(store, "messy_3header.csv")
    indicators = importer.multiselect_indicator_variables(_var(fp, "Q7"))
    assert len(indicators) == len(GT["multiselect_options"])
    meta = import_single(store, MESSY / "messy_3header.csv", variables=indicators)
    df = store.get(meta["dataset_id"]).df
    names = [v["name"] for v in meta["variables"]]
    assert "Q7" in names  # original kept
    other = next(v["name"] for v in indicators if v["label"] == "Other")
    raw = df["Q7"].astype(str)
    assert (df[other] == raw.str.contains(r"(?:^|, )Other(?:$|,)").astype(int)).all()
    assert (df[other] == 1).sum() == df["Q7_8_TEXT"].notna().sum()
    total = sum(int(df[v["name"]].sum()) for v in indicators)
    assert total == sum(len(x.split(", ")) for x in raw)


def test_qualtrics_mode_off_and_plain_csv(store, tmp_path):
    fp = preview(store, MESSY / "messy_3header.csv", mode="off")["files"][0]
    assert fp["qualtrics"] == {"detected": True, "confirmed": False, "header_rows": 1}
    assert fp["suggested_row_filters"] == []
    plain = tmp_path / "plain.csv"
    plain.write_text("id;score;group\n1;3.5;A\n2;4;B\n3;;A\n", encoding="utf-8")
    fp = preview(store, plain)["files"][0]
    assert fp["delimiter"] == ";" and fp["qualtrics"]["detected"] is False
    assert [(v["name"], v["dtype"]) for v in fp["proposed_variables"]] == [
        ("id", "integer"), ("score", "float"), ("group", "string")]


def test_user_dtype_override_rejects_lossy_conversion(store):
    fp = _fp(store, "messy_3header.csv")
    q1 = dict(_var(fp, "Q1"), dtype="integer")
    with pytest.raises(InvalidParams, match="Q1"):
        import_single(store, MESSY / "messy_3header.csv", variables=[q1])
