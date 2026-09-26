"""Qualtrics .qsf survey parser (survey_qsf) and dataset matching (survey_apply)."""

from __future__ import annotations

import copy
import json
from collections import Counter

import pytest

from statly_engine.data.survey_apply import suggest_metadata
from statly_engine.data.survey_qsf import clean_text, parse_qsf
from statly_engine.errors import FileUnreadable

from ._helpers import MESSY, PRACTICE, ground_truth, import_single

QSF = MESSY / "survey.qsf"
# Real export lives outside the repo (contains names); tests skip when absent.
REAL_QSF = PRACTICE.parent.parent / "sample-data" / "survey_exports" / "Hip_Joint_Workshop_Post-test_Survey.qsf"
GT = ground_truth("messy_qualtrics")
AGREE = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"]


def _doc(*payloads: dict, blocks: list[dict] | None = None) -> dict:
    els = [{"Element": "SQ", "PrimaryAttribute": p.get("QuestionID"), "Payload": p} for p in payloads]
    if blocks is not None:
        els.insert(0, {"Element": "BL", "Payload": blocks})
    return {"SurveyEntry": {"SurveyName": "Mini"}, "SurveyElements": els}


def _choices(labels: list[str]) -> dict:
    return {str(i): {"Display": lbl} for i, lbl in enumerate(labels, 1)}


def _q(survey, tag):
    return next(q for q in survey.questions if q.tag == tag and not q.in_trash)


@pytest.fixture(scope="module")
def survey():
    return parse_qsf(QSF.read_bytes())


# ---------------------------------------------------------------------------
# Parser on the synthesized fixture (same survey as messy_3header.csv)
# ---------------------------------------------------------------------------
def test_survey_name_and_order(survey):
    assert survey.name == "Course Experience Survey – Fall"  # &ndash; decoded
    assert [q.tag for q in survey.questions] == ["Q1", "Q1", "Q2", "Q5", "Q6", "Q7", "Q9", "Q10", "Q8"]
    assert survey.questions[-1].in_trash and survey.questions[-1].notes
    assert "Q8" not in [c.name for c in survey.columns()]
    json.dumps(survey.to_dict())  # JSON-serializable


def test_single_answer_mc(survey):
    q1 = _q(survey, "Q1")
    assert q1.kind == "single" and q1.required
    assert q1.text == "Informed consent Do you consent to participate?"  # HTML stripped
    [col] = q1.columns
    assert (col.name, col.level) == ("Q1", "nominal")
    assert col.value_labels == [{"value": 1, "label": "Yes"}, {"value": 2, "label": "No"}]


def test_recode_values_and_ordinal_detection(survey):
    [col] = _q(survey, "Q6").columns
    assert col.level == "ordinal"
    assert [v["value"] for v in col.value_labels] == GT["q6_recode_values"]
    assert [v["label"] for v in col.value_labels] == AGREE


def test_multi_answer_mc_expands_per_choice_with_other_text(survey):
    q7 = _q(survey, "Q7")
    assert q7.kind == "multi"
    names = [c.name for c in q7.columns]
    assert names == [f"Q7_{i}" for i in range(1, 9)] + [GT["multiselect_other_text_column"]]
    assert [c.value_labels[0]["label"] for c in q7.columns[:8]] == GT["multiselect_options"]
    assert all(c.value_labels[0]["value"] == 1 and c.level == "nominal" for c in q7.columns[:8])
    assert q7.columns[-1].level == "text"


def test_matrix_expands_rows_ordinal_and_scale(survey):
    q5 = _q(survey, "Q5")
    assert q5.kind == "matrix"
    assert q5.text == "Please say how much you agree with each statement about your classroom experience."
    assert [c.name for c in q5.columns] == GT["matrix_block"]["columns"]
    assert all(c.level == "ordinal" and c.group == "Q5" for c in q5.columns)
    assert [v["label"] for v in q5.columns[0].value_labels] == AGREE
    # No textual "(reverse-worded)" marker on purpose: the learner must judge Q5_4's wording
    # ("I often feel lost in this class") for themselves, so it no longer trips REVERSE_RE.
    assert q5.columns[3].label == "I often feel lost in this class"
    assert survey.suggested_scales() == [{"name": "Q5", "label": q5.text, "items": GT["matrix_block"]["columns"]}]


def test_text_entry_timing_and_descriptive(survey):
    for tag in GT["open_ended_columns"]:
        q = _q(survey, tag)
        assert q.kind == "text" and [(c.name, c.level) for c in q.columns] == [(tag, "text")]
    timing = [q for q in survey.questions if q.question_type == "Timing"][0]
    assert [c.name for c in timing.columns] == GT["timing_columns"]
    db = _q(survey, "Q2")
    assert db.kind == "other" and db.columns == [] and db.notes


# ---------------------------------------------------------------------------
# Parser edge cases on small synthetic surveys
# ---------------------------------------------------------------------------
def test_html_stripping():
    assert clean_text("<p>How&nbsp;<b>often</b> do you&hellip;<br/>study?</p>") == "How often do you… study?"
    assert clean_text(None) == ""


def test_unknown_and_malformed_questions_never_raise():
    s = parse_qsf(_doc(
        {"QuestionID": "QID1", "DataExportTag": "Q1", "QuestionType": "HeatMap", "Selector": "Static",
         "QuestionText": "Click the map"},
        {"QuestionID": "QID2", "DataExportTag": "Q2", "QuestionType": "MC", "Selector": "WEIRD",
         "Choices": _choices(["a", "b"])},
        {"QuestionID": "QID3", "DataExportTag": "Q3", "QuestionType": "MC", "Selector": "SAVR",
         "Choices": [], "ChoiceOrder": None, "QuestionText": None},
        {"QuestionID": "QID4", "DataExportTag": "Q4", "QuestionType": "Matrix", "Selector": "Likert",
         "SubSelector": "SingleAnswer", "Choices": "garbage", "Answers": 7},
    ))
    q1, q2, q3, q4 = s.questions
    assert (q1.kind, q1.columns) == ("other", []) and "HeatMap" in q1.notes[0]
    assert (q2.kind, q2.columns) == ("other", []) and "WEIRD" in q2.notes[0]
    assert q3.kind == "single" and q3.text == "Q3" and q3.columns[0].value_labels == []
    assert q4.kind == "matrix" and q4.columns == []


def test_not_a_qsf_raises_file_unreadable():
    for bad in (b"\xff\xfe\x00junk", "not json", json.dumps({"hello": 1})):
        with pytest.raises(FileUnreadable):
            parse_qsf(bad)


def test_variable_naming_row_export_tags_and_nominal_choices():
    s = parse_qsf(_doc(
        {"QuestionID": "QID1", "DataExportTag": "major", "QuestionType": "MC", "Selector": "DL",
         "Choices": _choices(["Biology", "History", "Other"]), "ChoiceOrder": ["3", "1", "2"],
         "VariableNaming": {"3": "Other major"}, "RecodeValues": {"3": "99"}},
        {"QuestionID": "QID2", "DataExportTag": "M", "QuestionType": "Matrix", "Selector": "Likert",
         "SubSelector": "SingleAnswer", "Choices": _choices(["a", "b", "c"]),
         "ChoiceDataExportTags": {"1": "grit1", "2": "grit2", "3": "grit3"},
         "Answers": _choices(["Never", "Sometimes", "Always"])},
        {"QuestionID": "QID4", "DataExportTag": "N", "QuestionType": "Matrix", "Selector": "Likert",
         "SubSelector": "SingleAnswer", "Choices": {"1": {"Display": "x"}, "15": {"Display": "y"}},
         "ChoiceOrder": ["15", "1"], "Answers": _choices(["Never", "Always"])},
        {"QuestionID": "QID3", "DataExportTag": "S", "QuestionType": "Slider", "Selector": "HSLIDER",
         "Choices": _choices(["Confidence"])},
    ))
    [major] = s.questions[0].columns
    assert major.level == "nominal"
    assert major.value_labels == [{"value": 99, "label": "Other major"}, {"value": 1, "label": "Biology"},
                                  {"value": 2, "label": "History"}]
    assert [c.name for c in s.questions[1].columns] == ["grit1", "grit2", "grit3"]
    # Questions outside any block are ordered by QID (QID3 before QID4).
    assert [(c.name, c.level) for c in s.questions[2].columns] == [("S_1", "scale")]
    assert s.questions[2].kind == "slider"
    # Matrix statements are numbered by display position, not by choice id.
    assert [(c.name, c.label) for c in s.questions[3].columns] == [("N_1", "y"), ("N_2", "x")]


def test_parse_is_deterministic():
    raw = QSF.read_text()
    assert parse_qsf(raw).to_dict() == parse_qsf(json.loads(raw)).to_dict()


# ---------------------------------------------------------------------------
# Real Qualtrics export
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def real():
    if not REAL_QSF.exists():
        pytest.skip("real Qualtrics export not present (kept out of the repo)")
    return parse_qsf(REAL_QSF.read_bytes())


def test_real_export_counts(real):
    doc = json.loads(REAL_QSF.read_text())
    assert len(doc["SurveyElements"]) == 136
    assert len(real.questions) == 127
    assert Counter((q.question_type, q.selector) for q in real.questions) == {
        ("MC", "SAVR"): 86, ("TE", "SL"): 13, ("DB", "TB"): 11, ("Matrix", "Likert"): 10, ("TE", "ML"): 5,
        ("TE", "FORM"): 1, ("FileUpload", "FileUpload"): 1}
    assert Counter(q.kind for q in real.questions) == {"single": 86, "text": 19, "other": 12, "matrix": 10}
    assert sum(q.in_trash for q in real.questions) == 81
    json.dumps(real.to_dict())


def test_real_export_no_data_types_and_form(real):
    for q in real.questions:
        if q.question_type in ("DB", "FileUpload"):
            assert q.columns == [] and q.notes
    [form] = [q for q in real.questions if q.selector == "FORM"]
    assert [(c.name, c.level) for c in form.columns] == [(f"{form.tag}_{i}", "text") for i in (1, 2, 3)]


def test_real_export_duplicate_tag_disambiguated(real):
    q131 = [q for q in real.questions if q.tag == "Q131"]
    assert len(q131) == 2 and not any(q.in_trash for q in q131)
    # Rows are numbered by position (ChoiceOrder [1,15,16,17,18] and [9,17]); the second question's
    # colliding names get the importer's _2 suffix, matching a real response export of this survey.
    assert [c.name for c in q131[0].columns] == [f"Q131_{i}" for i in range(1, 6)]
    assert [c.name for c in q131[1].columns] == ["Q131_1_2", "Q131_2_2"]
    assert "Q131_1_2" in q131[1].notes[0]
    assert any("Q131" in n for n in real.notes)
    names = [c.name for c in real.columns()]
    assert len(names) == len(set(names))
    assert parse_qsf(REAL_QSF.read_bytes()).to_dict() == real.to_dict()


def test_real_export_matrix_ordinal_and_scales(real):
    matrices = [q for q in real.questions if q.kind == "matrix"]
    assert matrices and all(c.level == "ordinal" for q in matrices for c in q.columns)
    assert all("<" not in c.label for q in matrices for c in q.columns)  # statements are HTML-stripped
    scales = real.suggested_scales()
    expected = [q.tag for q in matrices if not q.in_trash and len(q.columns) >= 3]
    assert [s["name"] for s in scales] == expected and scales
    assert all(len(s["items"]) >= 3 for s in scales)


# ---------------------------------------------------------------------------
# survey_apply against the imported messy_3header.csv
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def applied(survey):
    from statly_engine.data.store import DatasetStore
    meta = import_single(DatasetStore(), MESSY / "messy_3header.csv")
    return meta["variables"], suggest_metadata(survey, meta["variables"])


def test_apply_matrix_labels_and_scale(applied, survey):
    _, out = applied
    by = {c["name"]: c for c in out["columns"]}
    items = GT["matrix_block"]["columns"]
    statements = [
        "I enjoy coming to this class",
        "The teacher explains things clearly",
        "I feel comfortable asking questions",
        "I often feel lost in this class",
        "The activities help me learn",
        "I would recommend this class to a friend",
    ]
    for (i, name), statement in zip(enumerate(items, 1), statements):
        s = by[name]
        assert s["label"] == statement
        assert s["level"] == "ordinal" and s["role"] == "likert_item"
        assert [v["label"] for v in s["value_labels"]] == AGREE
        # No "(reverse-worded)" marker in the text anymore, so REVERSE_RE no longer flags
        # Q5_4 automatically -- the learner has to judge the wording themselves.
        assert s.get("reverse_hint", False) is False
    assert out["scales"] == [{"name": "Q5", "label": _q(survey, "Q5").text, "items": items,
                              "origin": "matrix_suggestion",
                              "reverse_hint_items": []}]


def test_apply_other_columns_and_unmatched(applied):
    variables, out = applied
    by = {c["name"]: c for c in out["columns"]}
    assert [v["value"] for v in by["Q6"]["value_labels"]] == GT["q6_recode_values"]
    q7 = by[GT["multiselect_column"]]  # dataset keeps Q7 as one comma-joined column
    assert [v["label"] for v in q7["value_labels"]] == GT["multiselect_options"]
    for col in GT["open_ended_columns"] + [GT["multiselect_other_text_column"]]:
        assert by[col]["role"] == "open_text"
    assert out["unmatched"] == {"survey_columns": [], "dataset_columns": []}
    assert GT["score_column"] not in by and not any(n in by for n in GT["pii_columns"])
    names = [v["name"] for v in variables]
    assert [c["name"] for c in out["columns"]] == [n for n in names if n in by]  # dataset order


def test_apply_case_insensitive_unmatched_and_no_overwrite(survey):
    variables = [
        {"name": "q5_1", "label": "My own label", "level": "ordinal", "value_labels": []},
        {"name": "Q5_2"}, {"name": "Q5_3"},
        {"name": "Q99", "is_metadata": False},
        {"name": "StartDate"},
    ]
    before = copy.deepcopy(variables)
    out = suggest_metadata(survey, variables)
    assert variables == before  # suggestions only
    by = {c["name"]: c for c in out["columns"]}
    assert by["q5_1"]["survey_column"] == "Q5_1"
    assert by["q5_1"]["differs_from_current"] == ["label"]
    assert out["scales"][0]["items"] == ["q5_1", "Q5_2", "Q5_3"]
    assert out["unmatched"]["dataset_columns"] == ["Q99"]
    assert {"Q5_4", "Q7_1", "Q9"} <= set(out["unmatched"]["survey_columns"])
    # A dataset with split multi-select columns matches them individually; the rest stay unmatched.
    split = suggest_metadata(survey, [{"name": "Q7_2"}])
    assert [c["name"] for c in split["columns"]] == ["Q7_2"]
    assert "Q7_1" in split["unmatched"]["survey_columns"]
    assert out == suggest_metadata(survey, variables)  # deterministic
    # Fewer than 3 matched matrix items -> no scale.
    assert suggest_metadata(survey, [{"name": "Q5_1"}, {"name": "Q5_2"}])["scales"] == []
