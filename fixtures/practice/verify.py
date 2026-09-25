#!/usr/bin/env python3
"""
Reload every practice dataset file and assert it matches its
ground_truth.json. Prints only a final pass/fail summary line per SPEC.

CSV/TSV files are read with pandas using the correct encoding/delimiter for
that variant. messy.xlsx has no engine (openpyxl) installed in
engine/.venv, so it is read with a small stdlib-only OOXML reader instead
(mirrors the writer in generate.py).
"""
from __future__ import annotations

import json
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

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
    """Minimal stdlib OOXML reader matching generate.py's write_xlsx."""
    with zipfile.ZipFile(path) as z:
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        sheets = wb.find("m:sheets", NS)
        names = [s.get("name") for s in sheets.findall("m:sheet", NS)]
        idx = names.index(sheet_name) + 1
        sheet_xml = ET.fromstring(z.read(f"xl/worksheets/sheet{idx}.xml"))
        rows = []
        for row_el in sheet_xml.find("m:sheetData", NS).findall("m:row", NS):
            cells = []
            for c in row_el.findall("m:c", NS):
                t = c.get("t")
                if t == "inlineStr":
                    is_el = c.find("m:is", NS)
                    t_el = is_el.find("m:t", NS) if is_el is not None else None
                    cells.append(t_el.text if t_el is not None and t_el.text else "")
                else:
                    v_el = c.find("m:v", NS)
                    cells.append(v_el.text if v_el is not None else "")
            rows.append(cells)
        return rows


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
          set(("Notes", "Data")) <= set(
              [s.get("name") for s in ET.fromstring(
                  zipfile.ZipFile(base / "messy.xlsx").read("xl/workbook.xml")
              ).find("m:sheets", NS).findall("m:sheet", NS)]))
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


def main():
    verify_one_group()
    verify_three_groups()
    verify_messy()
    verify_linked()
    print(f"{passed} passed, {failed} failed")
    if failed:
        for f in failures:
            print(f"  FAIL: {f}")
        sys.exit(1)


if __name__ == "__main__":
    main()
