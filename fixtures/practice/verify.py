#!/usr/bin/env python3
"""
Reload every practice dataset file and assert it matches its
ground_truth.json. Prints only a final pass/fail summary line per SPEC.

CSV/TSV files are read with pandas using the correct encoding/delimiter for
that variant. messy.xlsx is read with openpyxl.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import openpyxl
import pandas as pd

HERE = Path(__file__).resolve().parent

passed = 0
failed = 0
failures = []


def check(label, cond):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        failures.append(label)


def read_qualtrics_csv(path, encoding="utf-8", delimiter=",", header_rows=3):
    df = pd.read_csv(path, encoding=encoding, delimiter=delimiter,
                      header=None, dtype=str, skip_blank_lines=False)
    data = df.iloc[header_rows:].reset_index(drop=True)
    data.columns = df.iloc[0].tolist()
    return data


def read_xlsx_sheet(path, sheet_name):
    """Read a sheet's rows (as lists) with openpyxl."""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[sheet_name]
    rows = [["" if v is None else v for v in row] for row in ws.iter_rows(values_only=True)]
    wb.close()
    return rows


def read_xlsx_sheet_names(path):
    wb = openpyxl.load_workbook(path, read_only=True)
    names = wb.sheetnames
    wb.close()
    return names


def verify_one_group():
    d = json.loads((HERE / "one_group_prepost_likert/ground_truth.json").read_text())
    pre = read_qualtrics_csv(HERE / "one_group_prepost_likert/pre.csv", header_rows=d["header_rows"])
    post = read_qualtrics_csv(HERE / "one_group_prepost_likert/post.csv", header_rows=d["header_rows"])
    check("one_group: n_pre", len(pre) == d["n_pre"])
    check("one_group: n_post", len(post) == d["n_post"])
    check("one_group: matrix items present", all(c in pre.columns for c in d["matrix_items"]))
    vals = pd.concat([pre[c] for c in d["matrix_items"]]).dropna().astype(int)
    check("one_group: likert values in 1-5", vals.between(1, 5).all())


def verify_three_groups():
    d = json.loads((HERE / "three_groups_prepost_followup/ground_truth.json").read_text())
    pre = read_qualtrics_csv(HERE / "three_groups_prepost_followup/pre.csv")
    post = read_qualtrics_csv(HERE / "three_groups_prepost_followup/post.csv")
    fu = read_qualtrics_csv(HERE / "three_groups_prepost_followup/followup.csv")
    key = pd.read_csv(HERE / "three_groups_prepost_followup/answer_key.csv")
    check("three_groups: n_total pre", len(pre) == d["n_total_per_time"]["pre"])
    check("three_groups: n_total post", len(post) == d["n_total_per_time"]["post"])
    check("three_groups: n_total followup", len(fu) == d["n_total_per_time"]["followup"])
    check("three_groups: answer_key rows", len(key) == d["n_items"])
    for gname, counts in d["n_per_group_per_time"].items():
        check(f"three_groups: {gname} n_pre",
              (pre[d["group_variable"]] == gname).sum() == counts["pre"])
        check(f"three_groups: {gname} n_post",
              (post[d["group_variable"]] == gname).sum() == counts["post"])
        check(f"three_groups: {gname} n_followup",
              (fu[d["group_variable"]] == gname).sum() == counts["followup"])


def verify_messy():
    d = json.loads((HERE / "messy_qualtrics/ground_truth.json").read_text())
    base = HERE / "messy_qualtrics"

    df3 = read_qualtrics_csv(base / "messy_3header.csv", encoding="utf-8-sig")
    df2 = read_qualtrics_csv(base / "messy_2header.csv", encoding="utf-8", header_rows=2)
    df16 = read_qualtrics_csv(base / "messy_utf16.csv", encoding="utf-16", delimiter="\t")
    dftxt = read_qualtrics_csv(base / "messy_text_choices.csv", encoding="utf-8")

    check("messy: 3header row count", len(df3) == d["n_rows_total"])
    check("messy: 2header row count", len(df2) == d["n_rows_total"])
    check("messy: utf16 row count", len(df16) == d["n_rows_total"])
    check("messy: text_choices row count", len(dftxt) == d["n_rows_total"])
    check("messy: 3header vs 2header same columns", list(df3.columns) == list(df2.columns))
    check("messy: 3header vs utf16 same columns", list(df3.columns) == list(df16.columns))

    xlsx_data = read_xlsx_sheet(base / "messy.xlsx", "Data")
    check("messy: xlsx sheet names include Notes/Data",
          set(("Notes", "Data")) <= set(read_xlsx_sheet_names(base / "messy.xlsx")))
    check("messy: xlsx data rows = header_rows + n_rows_total",
          len(xlsx_data) == 3 + d["n_rows_total"])

    n_preview = (df3["Status"] == "Survey Preview").sum()
    n_spam = (df3["Status"] == "Spam").sum()
    check("messy: n_survey_preview", n_preview == d["n_survey_preview"])
    check("messy: n_spam", n_spam == d["n_spam"])

    progress = df3["Progress"].astype(int)
    check("messy: n_unfinished (Progress<100)", (progress < 100).sum() == d["n_unfinished"])

    for col in d["pii_columns"]:
        check(f"messy: PII column present {col}", col in df3.columns)
    check("messy: Q9 pii-lookalike column present", "Q9" in df3.columns)

    for col in d["matrix_block"]["columns"]:
        check(f"messy: matrix column present {col}", col in df3.columns)

    check("messy: multiselect column present", d["multiselect_column"] in df3.columns)
    check("messy: multiselect other-text column present",
          d["multiselect_other_text_column"] in df3.columns)

    for col in d["timing_columns"]:
        check(f"messy: timing column present {col}", col in df3.columns)

    check("messy: score column present", d["score_column"] in df3.columns)

    q6_numeric = pd.to_numeric(df3["Q6"], errors="coerce").dropna()
    observed = set(int(v) for v in q6_numeric.unique()) - {-99}
    check("messy: Q6 recode values match", observed == set(d["q6_recode_values"]))

    n_missing = sum(
        (df3[c].astype(str) == "-99").sum() for c in d["matrix_block"]["columns"] + ["Q6"]
    )
    check("messy: n_missing_code_cells", n_missing == d["n_missing_code_cells"])

    names = (df3["RecipientFirstName"] + "|" + df3["RecipientLastName"] + "|" +
             df3["RecipientEmail"])
    dup_identity = d["duplicate_identity"]
    target = f"{dup_identity['first_name']}|{dup_identity['last_name']}|{dup_identity['email']}"
    check("messy: duplicate identity row count",
          (names == target).sum() == dup_identity["n_rows_sharing_identity"])


def verify_linked():
    d = json.loads((HERE / "linked_id_prepost/ground_truth.json").read_text())
    pre = read_qualtrics_csv(HERE / "linked_id_prepost/pre.csv")
    post = read_qualtrics_csv(HERE / "linked_id_prepost/post.csv")
    check("linked: n_pre_rows", len(pre) == d["n_pre_rows"])
    check("linked: n_post_rows", len(post) == d["n_post_rows"])

    pre_ids = set(pre["Q1"].str.strip().str.lower())
    post_ids_norm = post["Q1"].str.strip().str.lower()
    check("linked: n_pre_unique_ids", len(pre_ids) == d["n_pre_unique_ids"])

    post_unique = set(post_ids_norm)
    check("linked: n_post_unique_ids_after_normalization",
          len(post_unique) == d["n_post_unique_ids_after_normalization"])

    matched = pre_ids & post_unique
    check("linked: n_matched_after_normalization", len(matched) == d["n_matched_after_normalization"])

    pre_only = pre_ids - post_unique
    check("linked: n_pre_only", len(pre_only) == d["n_pre_only"])

    post_only = post_unique - pre_ids
    check("linked: n_post_only", len(post_only) == d["n_post_only"])

    dup_counts = post_ids_norm.value_counts()
    dup_ids = dup_counts[dup_counts > 1]
    check("linked: n_duplicated_ids_in_post", len(dup_ids) == d["n_duplicated_ids_in_post"])

    check("linked: outcome column present", d["outcome_column"] in pre.columns
          and d["outcome_column"] in post.columns)
    q4 = pd.to_numeric(pre[d["outcome_column"]])
    check("linked: outcome in 0-100 range", q4.between(0, 100).all())


def verify_regression_predictors():
    base = HERE / "regression_predictors"
    d = json.loads((base / "ground_truth.json").read_text())
    df = read_qualtrics_csv(base / "survey.csv", header_rows=d["header_rows"])
    check("regression_predictors: n", len(df) == d["n"])
    check("regression_predictors: outcome column present", d["outcome_column"] in df.columns)
    for c in d["predictor_columns"] + d["motivation_scale_items"]:
        check(f"regression_predictors: column present {c}", c in df.columns)

    hours = pd.to_numeric(df[d["collinear_pair"]["hours_column"]], errors="coerce")
    minutes = pd.to_numeric(df[d["collinear_pair"]["minutes_column"]], errors="coerce")
    r = float(np.corrcoef(hours, minutes)[0, 1])
    check("regression_predictors: hours/minutes strongly collinear", r > 0.9)

    n_gpa_missing = int((df["Q5"].isna() | (df["Q5"].astype(str).str.strip() == "")).sum())
    check("regression_predictors: n_missing_gpa matches",
          n_gpa_missing == d["missing"]["gpa_missing_cells"])

    outcome = pd.to_numeric(df[d["outcome_column"]], errors="coerce")
    for rid in d["outliers"]["response_ids"]:
        check(f"regression_predictors: outlier row present {rid}",
              (df["ResponseId"] == rid).any())


def verify_categorical_outcomes():
    base = HERE / "categorical_outcomes"
    d = json.loads((base / "ground_truth.json").read_text())
    df = read_qualtrics_csv(base / "survey.csv", header_rows=d["header_rows"])
    check("categorical_outcomes: n", len(df) == d["n"])
    for c in ["Q2", "Q3", "Q4", "Q5_pre", "Q5_post", "Q6_1", "Q6_2", "Q6_3"]:
        check(f"categorical_outcomes: column present {c}", c in df.columns)
    check("categorical_outcomes: sparse 2x2 min expected < 5",
          d["sparse_2x2"]["achieved_min_expected_count"] < 5)
    check("categorical_outcomes: pass/fail values valid",
          set(df["Q3"].unique()) <= {"Pass", "Fail"})


def verify_scale_validation():
    base = HERE / "scale_validation"
    d = json.loads((base / "ground_truth.json").read_text())
    df = read_qualtrics_csv(base / "survey.csv", header_rows=d["header_rows"])
    check("scale_validation: n", len(df) == d["n"])
    likert_items = d["likert_scale"]["items"]
    quiz_items = d["quiz"]["items"]
    for c in likert_items + quiz_items + ["SC0"]:
        check(f"scale_validation: column present {c}", c in df.columns)
    vals = pd.concat([df[c] for c in likert_items]).dropna().astype(int)
    check("scale_validation: likert values in 1-5", vals.between(1, 5).all())
    quiz_vals = pd.concat([df[c] for c in quiz_items]).dropna().astype(int)
    check("scale_validation: quiz values in {0,1}", set(quiz_vals.unique()) <= {0, 1})
    sc0 = pd.to_numeric(df["SC0"], errors="coerce")
    row_sum = df[quiz_items].astype(int).sum(axis=1)
    check("scale_validation: SC0 equals row sum of quiz items", (sc0 == row_sum).all())
    check("scale_validation: KR-20 in plausible range", 0.5 < d["quiz"]["achieved_kr20"] < 0.95)


def verify_rater_agreement():
    base = HERE / "rater_agreement"
    d = json.loads((base / "ground_truth.json").read_text())
    ratings = pd.read_csv(base / "essay_ratings.csv", dtype=str)
    nominal = pd.read_csv(base / "nominal_coding.csv", dtype=str)
    check("rater_agreement: essay_ratings n", len(ratings) == d["n_essays"])
    check("rater_agreement: nominal_coding n", len(nominal) == d["n_essays"])
    n_missing = sum((ratings[c].isna() | (ratings[c].astype(str).str.strip() == "")).sum()
                     for c in ["rater1", "rater2", "rater3"])
    check("rater_agreement: n_missing_cells matches",
          n_missing == d["essay_ratings"]["n_missing_cells"])
    for c in ["rater1", "rater2", "rater3"]:
        vals = pd.to_numeric(ratings[c], errors="coerce").dropna()
        check(f"rater_agreement: {c} in 1-5", vals.between(1, 5).all())
    categories = set(d["files"]["nominal_coding.csv"]["categories"])
    check("rater_agreement: nominal categories valid",
          set(nominal["rater_a_category"]) <= categories and
          set(nominal["rater_b_category"]) <= categories)
    check("rater_agreement: kappa in plausible moderate-substantial range",
          0.3 < d["nominal_coding"]["achieved_cohens_kappa"] < 0.9)


def verify_mixed_design_large():
    base = HERE / "mixed_design_large"
    d = json.loads((base / "ground_truth.json").read_text())
    pre = read_qualtrics_csv(base / "pre.csv")
    post = read_qualtrics_csv(base / "post.csv")
    fu = read_qualtrics_csv(base / "followup.csv")
    check("mixed_design_large: n_total pre", len(pre) == d["n_total_per_time"]["pre"])
    check("mixed_design_large: n_total post", len(post) == d["n_total_per_time"]["post"])
    check("mixed_design_large: n_total followup", len(fu) == d["n_total_per_time"]["followup"])
    for g, counts in d["n_per_group_per_time"].items():
        check(f"mixed_design_large: {g} n_pre", (pre["Q2"] == g).sum() == counts["pre"])
        check(f"mixed_design_large: {g} n_post", (post["Q2"] == g).sum() == counts["post"])
        check(f"mixed_design_large: {g} n_followup", (fu["Q2"] == g).sum() == counts["followup"])
    post_ids = set(post["Q1"])
    fu_ids = set(fu["Q1"])
    check("mixed_design_large: followup IDs are a subset of post IDs", fu_ids <= post_ids)
    dur = pd.to_numeric(post[d["duration_column"]], errors="coerce")
    check("mixed_design_large: n_speeders_post matches",
          (dur < d["speeder_threshold_seconds"]).sum() == d["n_speeders_post"])
    sc0 = pd.to_numeric(pre["SC0"], errors="coerce")
    row_sum = pre[d["test_items"]].astype(int).sum(axis=1)
    check("mixed_design_large: pre SC0 equals row sum of test items", (sc0 == row_sum).all())


def verify_stress_test():
    base = HERE / "stress_test"
    d = json.loads((base / "ground_truth.json").read_text())
    df = read_qualtrics_csv(base / "survey.csv", header_rows=d["header_rows"])
    check("stress_test: n_rows", len(df) == d["n_rows"])
    check("stress_test: n_columns", len(df.columns) == d["n_columns"])
    check("stress_test: open text column present", d["open_text_column"] in df.columns)


def main():
    verify_one_group()
    verify_three_groups()
    verify_messy()
    verify_linked()
    verify_regression_predictors()
    verify_categorical_outcomes()
    verify_scale_validation()
    verify_rater_agreement()
    verify_mixed_design_large()
    verify_stress_test()
    print(f"{passed} passed, {failed} failed")
    if failed:
        for f in failures:
            print(f"  FAIL: {f}")
        sys.exit(1)


if __name__ == "__main__":
    main()
