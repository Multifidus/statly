"""Tests for statly_engine.data.recode: text -> integer-code recoding for wording
RESPONSE_SETS doesn't recognize (SPEC §6)."""

from __future__ import annotations

import copy

import pandas as pd
import pytest

from statly_engine.data import recode
from statly_engine.data import scoring
from statly_engine.data import variables as ops
from statly_engine.errors import InvalidParams


def text_var(name: str, **o) -> dict:
    v = ops.new_variable(name, dtype="string", level="nominal")
    v.update(o)
    return v


def frame(values):
    return pd.DataFrame({"_statly_row_id": range(len(values)), "Q1": values})


LABELS = ["Meh", "Fine", "Great"]


def test_happy_path_ordered_codes():
    df = frame(["Meh", "Fine", "Great", "Fine"])
    variables = [text_var("Q1")]

    new_df, new_vars, report = recode.recode_text_to_codes(df, variables, "Q1", LABELS)

    assert new_df["Q1"].tolist() == [1, 2, 3, 2]
    v = next(v for v in new_vars if v["name"] == "Q1")
    assert v["dtype"] == "integer"
    assert v["level"] == "ordinal"
    assert v["value_labels"] == [{"value": 1, "label": "Meh"}, {"value": 2, "label": "Fine"},
                                  {"value": 3, "label": "Great"}]
    assert report["matched"] == 4
    assert report["unmatched"]["count"] == 0


def test_case_and_whitespace_tolerance():
    df = frame([" meh ", "FINE", "great"])
    variables = [text_var("Q1")]

    new_df, _, report = recode.recode_text_to_codes(df, variables, "Q1", LABELS)

    assert new_df["Q1"].tolist() == [1, 2, 3]
    assert report["unmatched"]["count"] == 0


def test_unmatched_values_become_missing_and_reported():
    df = frame(["Meh", "Huh?", "Great", "???", None])
    variables = [text_var("Q1")]

    new_df, _, report = recode.recode_text_to_codes(df, variables, "Q1", LABELS)

    assert new_df["Q1"].tolist()[0] == 1
    assert pd.isna(new_df["Q1"].tolist()[1])
    assert new_df["Q1"].tolist()[2] == 3
    assert pd.isna(new_df["Q1"].tolist()[3])
    assert pd.isna(new_df["Q1"].tolist()[4])  # already-blank stays missing, not "unmatched"
    assert report["unmatched"]["count"] == 2
    assert set(report["unmatched"]["examples"]) == {"Huh?", "???"}


def test_more_than_ten_unmatched_examples_capped():
    bad = [f"bad{i}" for i in range(15)]
    df = frame(["Meh"] + bad)
    variables = [text_var("Q1")]

    _, _, report = recode.recode_text_to_codes(df, variables, "Q1", LABELS)

    assert report["unmatched"]["count"] == 15
    assert len(report["unmatched"]["examples"]) == 10


def test_numeric_column_rejected():
    df = pd.DataFrame({"_statly_row_id": [0, 1], "Q1": [1, 2]})
    variables = [ops.new_variable("Q1", dtype="integer", level="ordinal")]

    with pytest.raises(InvalidParams):
        recode.recode_text_to_codes(df, variables, "Q1", LABELS)


def test_empty_label_list_rejected():
    df = frame(["Meh", "Fine"])
    variables = [text_var("Q1")]

    with pytest.raises(InvalidParams):
        recode.recode_text_to_codes(df, variables, "Q1", [])


def test_unknown_variable_rejected():
    df = frame(["Meh"])
    variables = [text_var("Q1")]

    with pytest.raises(InvalidParams):
        recode.recode_text_to_codes(df, variables, "NotThere", LABELS)


def test_purity_inputs_unchanged():
    df = frame(["Meh", "Fine", "Great"])
    variables = [text_var("Q1")]
    df_before = df.copy(deep=True)
    variables_before = copy.deepcopy(variables)

    recode.recode_text_to_codes(df, variables, "Q1", LABELS)

    pd.testing.assert_frame_equal(df, df_before)
    assert variables == variables_before


def test_observed_text_levels_first_seen_order_trimmed():
    df = frame(["Great", " Meh", "Fine", "Great", "Fine "])

    assert recode.observed_text_levels(df, "Q1") == ["Great", "Meh", "Fine"]


def test_observed_text_levels_unknown_column_rejected():
    df = frame(["Meh"])
    with pytest.raises(InvalidParams):
        recode.observed_text_levels(df, "NotThere")


def test_recoded_column_accepted_by_scoring_mean_and_reverse_coded():
    df = frame(["Meh", "Fine", "Great", "Meh"])
    variables = [text_var("Q1")]

    new_df, new_vars, _ = recode.recode_text_to_codes(df, variables, "Q1", LABELS)
    v = next(v for v in new_vars if v["name"] == "Q1")
    v["response_range"] = {"min": 1, "max": 3}
    v["reverse_coded"] = True

    x, warns = scoring.item_scores(new_df, v)
    assert warns == []
    # reverse-coded with response_range 1..3: 1->3, 2->2, 3->1
    assert list(x) == [3.0, 2.0, 1.0, 3.0]

    by_name = {v["name"]: v}
    mean, warns = scoring.scale_score(new_df, by_name, ["Q1"], "scale_mean", None)
    assert warns == []
    assert list(mean) == [3.0, 2.0, 1.0, 3.0]
