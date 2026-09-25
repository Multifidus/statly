"""Frontend/engine seams: stable file ids, comma-containing multi-select options,
user-confirmed choice-text codes, noncontiguous code exposure."""

from __future__ import annotations

from statly_engine.data import importer
from statly_engine.data.columns import split_selected

from ._helpers import MESSY, decision, ground_truth, import_single, preview

GT = ground_truth("messy_qualtrics")


def _var(fp, name):
    return next(v for v in fp["proposed_variables"] if v["name"] == name)


def test_file_id_stable_across_previews_and_sheet_change(store):
    a = preview(store, MESSY / "messy.xlsx")["files"][0]
    b = preview(store, MESSY / "messy.xlsx", sheet="Notes")["files"][0]
    c = preview(store, MESSY / "messy.xlsx", sheet="Data")["files"][0]
    assert a["file_id"] == b["file_id"] == c["file_id"]
    assert b["sheet_name"] == "Notes" and c["sheet_name"] == "Data"
    other = preview(store, MESSY / "messy_3header.csv")["files"][0]
    assert other["file_id"] != a["file_id"]


def test_same_path_twice_gets_distinct_ids(store):
    pv = preview(store, MESSY / "messy_3header.csv", MESSY / "messy_3header.csv")
    ids = [f["file_id"] for f in pv["files"]]
    assert len(set(ids)) == 2 and ids[1].startswith(ids[0])


def test_stack_onto_avoids_existing_file_id(store):
    meta = import_single(store, MESSY / "messy_3header.csv")
    pv = preview(store, MESSY / "messy_3header.csv", onto=meta["dataset_id"])
    assert pv["files"][0]["file_id"] != meta["import_log"]["files"][0]["file_id"]


def test_split_selected_greedy_with_commas():
    opts = ["Other, please specify", "Tutor", "Other"]
    assert split_selected("Tutor,Other, please specify", opts) == ["Tutor", "Other, please specify"]
    assert split_selected("Other,please specify", opts) == ["Other, please specify"]
    assert split_selected("Other,Tutor", opts) == ["Other", "Tutor"]
    assert split_selected("Textbook,Tutor", None) == ["Textbook", "Tutor"]


def test_multiselect_option_with_comma_detected_and_split(store, tmp_path):
    path = tmp_path / "ms.csv"
    rows = ["Tutor,Other, please specify", "Textbook", "Other, please specify", "Textbook,Tutor", "Tutor", ""]
    path.write_text("id,Q7\n" + "\n".join(f'{i},"{r}"' for i, r in enumerate(rows)) + "\n")
    fp = preview(store, path)["files"][0]
    q7 = _var(fp, "Q7")
    labels = [vl["label"] for vl in q7["value_labels"]]
    assert "Other, please specify" in labels and "please specify" not in labels
    indicators = importer.multiselect_indicator_variables(q7)
    meta = import_single(store, path, variables=indicators)
    df = store.get(meta["dataset_id"]).df
    other = next(v["name"] for v in indicators if v["label"] == "Other, please specify")
    assert df[other].tolist()[:5] == [1, 0, 1, 0, 0]
    assert df[other].isna().tolist()[5]


def test_numeric_export_exposes_noncontiguous_codes(store):
    fp = preview(store, MESSY / "messy_3header.csv")["files"][0]
    assert [vl["value"] for vl in _var(fp, "Q6")["value_labels"]] == GT["q6_recode_values"]
    assert _var(fp, "Q5_1")["value_labels"] == []


def _import_text_choices(store, codes: list[int] | None):
    pv = preview(store, MESSY / "messy_text_choices.csv")
    fp = pv["files"][0]
    q6 = dict(_var(fp, "Q6"))
    variables = []
    if codes is not None:
        labels = [vl["label"] for vl in q6["value_labels"]]
        q6["value_labels"] = [{"value": c, "label": l} for c, l in zip(codes, labels)]
        q6["response_range"] = {"min": min(codes), "max": max(codes)}
        variables = [q6]
    filters = [f for f in fp["suggested_row_filters"] if f["kind"] == "exclude_values"]
    meta = importer.commit_import(store, {
        "preview_id": pv["preview_id"], "files": [decision(fp)], "row_filters": filters,
        "variables": variables, "stack": None})
    return meta, store.get(meta["dataset_id"]).df


def test_text_choices_default_codes_1_to_5(store):
    meta, df = _import_text_choices(store, None)
    assert meta["n_rows"] == GT["n_valid_after_status_filter"]
    vals = sorted(set(int(x) for x in df["Q6"].dropna()) - {-99})
    assert vals == [1, 2, 3, 4, 5]


def test_text_choices_user_codes_match_numeric_export(store):
    meta, df = _import_text_choices(store, GT["q6_recode_values"])
    vals = sorted(set(int(x) for x in df["Q6"].dropna()) - {-99})
    assert vals == GT["q6_recode_values"]
    # Same cells as the numeric export.
    num = import_single(store, MESSY / "messy_3header.csv",
                        filters=[f for f in preview(store, MESSY / "messy_3header.csv")["files"][0]
                                 ["suggested_row_filters"] if f["kind"] == "exclude_values"])
    ref = store.get(num["dataset_id"]).df["Q6"]
    assert ref.fillna(-1).astype(int).tolist() == df["Q6"].fillna(-1).astype(int).tolist()
