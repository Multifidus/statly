#!/usr/bin/env python3
"""
Generate Statly practice datasets (SPEC.md section 11.4).

Deterministic, seeded, idempotent: `python generate.py` regenerates every
file below from scratch and always produces byte-identical output for a
given numpy/pandas version.

Uses only numpy, pandas and the Python standard library (no openpyxl —
engine/.venv does not have it installed, so the .xlsx file for the messy
dataset is written by hand with a minimal OOXML writer, see `write_xlsx`).
"""
from __future__ import annotations

import csv
import html
import json
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 20260924
HERE = Path(__file__).resolve().parent

# ---------------------------------------------------------------------------
# Qualtrics metadata columns (SPEC 5.2)
# ---------------------------------------------------------------------------
METADATA_COLS = [
    ("StartDate", "Start Date"),
    ("EndDate", "End Date"),
    ("Status", "Response Type"),
    ("IPAddress", "IP Address"),
    ("Progress", "Progress"),
    ("Duration (in seconds)", "Duration (in seconds)"),
    ("Finished", "Finished"),
    ("RecordedDate", "Recorded Date"),
    ("ResponseId", "Response ID"),
    ("RecipientLastName", "Recipient Last Name"),
    ("RecipientFirstName", "Recipient First Name"),
    ("RecipientEmail", "Recipient Email"),
    ("ExternalReference", "External Data Reference"),
    ("LocationLatitude", "Location Latitude"),
    ("LocationLongitude", "Location Longitude"),
    ("DistributionChannel", "Distribution Channel"),
    ("UserLanguage", "User Language"),
]
METADATA_NAMES = [c for c, _ in METADATA_COLS]


def metadata_row(rng, i, response_id, *, finished=True, progress=100,
                  status="IP Address", pii=False):
    """One dict of metadata-column values for a single respondent row."""
    day = 1 + (i % 27)
    start = f"2026-02-{day:02d} {8 + (i % 9):02d}:{(i * 7) % 60:02d}:{(i * 13) % 60:02d}"
    dur = int(rng.integers(60, 900))
    row = {
        "StartDate": start,
        "EndDate": start,
        "Status": status,
        "IPAddress": f"10.{(i * 3) % 255}.{(i * 7) % 255}.{(i * 11) % 255}" if pii else "",
        "Progress": progress,
        "Duration (in seconds)": dur,
        "Finished": "True" if finished else "False",
        "RecordedDate": start,
        "ResponseId": response_id,
        "RecipientLastName": "",
        "RecipientFirstName": "",
        "RecipientEmail": "",
        "ExternalReference": "",
        "LocationLatitude": round(float(rng.uniform(25, 48)), 6) if pii else "",
        "LocationLongitude": round(float(rng.uniform(-122, -70)), 6) if pii else "",
        "DistributionChannel": "anonymous",
        "UserLanguage": "EN",
    }
    return row


# ---------------------------------------------------------------------------
# Generic Qualtrics CSV writer: builds the 2/3 header rows + data rows and
# writes with the requested encoding/delimiter.
# ---------------------------------------------------------------------------
def build_qualtrics_matrix(columns, question_text, data_rows, *, three_header=True):
    """columns: list of short IDs in order (including metadata columns).
    question_text: dict short_id -> row-2 text.
    data_rows: list of dicts short_id -> value.
    Returns list-of-lists ready to write to CSV (headers + data).
    """
    row1 = list(columns)
    row2 = [question_text.get(c, c) for c in columns]
    rows = [row1, row2]
    if three_header:
        row3 = [json.dumps({"ImportId": c}) for c in columns]
        rows.append(row3)
    for d in data_rows:
        rows.append(["" if d.get(c, "") is None else d.get(c, "") for c in columns])
    return rows


def save_csv(rows, path, *, encoding="utf-8", delimiter=","):
    with open(path, "w", encoding=encoding, newline="") as f:
        w = csv.writer(f, delimiter=delimiter)
        w.writerows(rows)


# ---------------------------------------------------------------------------
# Minimal stdlib-only XLSX writer (no openpyxl available in engine/.venv)
# ---------------------------------------------------------------------------
def _col_letter(idx):
    idx += 1
    s = ""
    while idx:
        idx, rem = divmod(idx - 1, 26)
        s = chr(65 + rem) + s
    return s


def write_xlsx(path, sheets: dict):
    """sheets: OrderedDict[str, list[list]] -> writes a minimal valid .xlsx."""
    names = list(sheets.keys())

    sheet_overrides = "\n".join(
        f'<Override PartName="/xl/worksheets/sheet{i + 1}.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        for i in range(len(names))
    )
    content_types = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
{sheet_overrides}
</Types>"""

    root_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"""

    sheet_entries = "\n".join(
        f'<sheet name="{html.escape(name)}" sheetId="{i + 1}" r:id="rId{i + 1}"/>'
        for i, name in enumerate(names)
    )
    workbook_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
{sheet_entries}
</sheets>
</workbook>"""

    wb_rels_entries = "\n".join(
        f'<Relationship Id="rId{i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i + 1}.xml"/>'
        for i in range(len(names))
    )
    wb_rels = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
{wb_rels_entries}
</Relationships>"""

    def cell_xml(r_idx, c_idx, value):
        ref = f"{_col_letter(c_idx)}{r_idx + 1}"
        if value is None or value == "":
            return f'<c r="{ref}"/>'
        if isinstance(value, bool):
            text = html.escape(str(value), quote=False)
            return f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{text}</t></is></c>'
        if isinstance(value, (int, float)):
            return f'<c r="{ref}"><v>{value}</v></c>'
        text = html.escape(str(value), quote=False)
        return f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{text}</t></is></c>'

    sheet_xmls = []
    for rows in sheets.values():
        row_xmls = []
        for r_idx, row in enumerate(rows):
            cells = "".join(cell_xml(r_idx, c_idx, val) for c_idx, val in enumerate(row))
            row_xmls.append(f'<row r="{r_idx + 1}">{cells}</row>')
        sheet_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>
{''.join(row_xmls)}
</sheetData>
</worksheet>"""
        sheet_xmls.append(sheet_xml)

    path = Path(path)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", root_rels)
        z.writestr("xl/workbook.xml", workbook_xml)
        z.writestr("xl/_rels/workbook.xml.rels", wb_rels)
        for i, sxml in enumerate(sheet_xmls):
            z.writestr(f"xl/worksheets/sheet{i + 1}.xml", sxml)


def likert_round(x):
    return int(np.clip(round(x), 1, 5))


# ===========================================================================
# Dataset (a): one_group_prepost_likert
# ===========================================================================
def gen_one_group_prepost_likert(rng: np.random.Generator, outdir: Path):
    n = 60
    n_items = 10
    reverse_items = {"Q3_3", "Q3_8"}
    item_ids = [f"Q3_{i}" for i in range(1, n_items + 1)]
    item_text = {
        iid: f"Matrix item {i}: statement about the training program ({'reverse-worded' if iid in reverse_items else 'positively worded'})"
        for i, iid in enumerate(item_ids, start=1)
    }

    true_sd = 0.85
    target_d = 0.5
    pre_mean = 3.0
    post_mean = pre_mean + target_d * true_sd

    theta_pre = rng.normal(pre_mean, true_sd, n)
    theta_post = rng.normal(post_mean, true_sd, n)

    def make_rows(theta, response_prefix):
        rows = []
        for i in range(n):
            d = metadata_row(rng, i, f"{response_prefix}{i + 1:04d}")
            for iid in item_ids:
                latent = (6 - theta[i]) if iid in reverse_items else theta[i]
                val = likert_round(latent + rng.normal(0, 0.6))
                d[iid] = val
            rows.append(d)
        return rows

    pre_rows = make_rows(theta_pre, "R_A_PRE_")
    post_rows = make_rows(theta_post, "R_A_POST_")

    columns = METADATA_NAMES + item_ids
    qtext = {iid: item_text[iid] for iid in item_ids}

    pre_table = build_qualtrics_matrix(columns, qtext, pre_rows, three_header=True)
    post_table = build_qualtrics_matrix(columns, qtext, post_rows, three_header=True)

    save_csv(pre_table, outdir / "pre.csv")
    save_csv(post_table, outdir / "post.csv")

    # Compute achieved scale-level stats (reverse-scored) for ground truth.
    def scale_scores(rows):
        out = []
        for d in rows:
            vals = [(6 - d[iid]) if iid in reverse_items else d[iid] for iid in item_ids]
            out.append(np.mean(vals))
        return np.array(out)

    pre_scale = scale_scores(pre_rows)
    post_scale = scale_scores(post_rows)
    pooled_sd = np.sqrt((pre_scale.var(ddof=1) + post_scale.var(ddof=1)) / 2)
    achieved_d = (post_scale.mean() - pre_scale.mean()) / pooled_sd

    gt = {
        "dataset": "one_group_prepost_likert",
        "n_pre": n,
        "n_post": n,
        "matrix_items": item_ids,
        "reverse_worded_items": sorted(reverse_items),
        "likert_coding": "numeric 1-5",
        "header_rows": 3,
        "linked": False,
        "note": "pre.csv and post.csv are independent Qualtrics exports of the same"
                " cohort (no shared ID); compare via SPEC 5.4 aggregate mode.",
        "true_design": {
            "pre_mean_target": pre_mean,
            "post_mean_target": post_mean,
            "item_sd_target": true_sd,
            "target_cohens_d": target_d,
        },
        "achieved": {
            "pre_scale_mean": round(float(pre_scale.mean()), 4),
            "post_scale_mean": round(float(post_scale.mean()), 4),
            "pooled_sd": round(float(pooled_sd), 4),
            "cohens_d": round(float(achieved_d), 4),
        },
        "gotchas": [
            "10-item Likert matrix Q3_1..Q3_10 with 3-row Qualtrics header.",
            "Q3_3 and Q3_8 are negatively worded and must be reverse-scored"
            " (6 - x on a 1-5 scale) before scale scoring.",
            "pre.csv and post.csv share identical question text/IDs for"
            " multi-file stacking (SPEC 5.3) but have independent ResponseIds"
            " (aggregate mode only, no linking ID present).",
        ],
    }
    (outdir / "ground_truth.json").write_text(json.dumps(gt, indent=2) + "\n")
    return gt


# ===========================================================================
# Dataset (b): three_groups_prepost_followup
# ===========================================================================
def gen_three_groups_prepost_followup(rng: np.random.Generator, outdir: Path):
    n_items = 20
    choices = ["A", "B", "C", "D"]
    item_ids = [f"Q4_{i}" for i in range(1, n_items + 1)]
    item_text = {iid: f"Knowledge item {i}: which statement is correct?" for i, iid in
                 enumerate(item_ids, start=1)}
    answer_key = {iid: choices[rng.integers(0, 4)] for iid in item_ids}
    item_difficulty = {iid: float(rng.uniform(-1.0, 1.0)) for iid in item_ids}

    groups = {
        "Control": {"n_pre": 44, "post_keep": 38, "fu_keep": 30,
                    "target_p": {"pre": 0.50, "post": 0.52, "fu": 0.50}},
        "Intervention A": {"n_pre": 46, "post_keep": 41, "fu_keep": 35,
                            "target_p": {"pre": 0.50, "post": 0.62, "fu": 0.58}},
        "Intervention B": {"n_pre": 45, "post_keep": 40, "fu_keep": 33,
                            "target_p": {"pre": 0.50, "post": 0.72, "fu": 0.65}},
    }

    def logit(p):
        return np.log(p / (1 - p))

    def sim_items(theta):
        row = {}
        n_correct = 0
        for iid in item_ids:
            p = 1 / (1 + np.exp(-(theta - item_difficulty[iid])))
            correct = rng.random() < p
            if correct:
                ans = answer_key[iid]
            else:
                wrong = [c for c in choices if c != answer_key[iid]]
                ans = wrong[rng.integers(0, 3)]
            row[iid] = ans
            n_correct += int(ans == answer_key[iid])
        return row, n_correct

    time_defs = [
        ("pre", "n_pre", "R_B_PRE_"),
        ("post", "post_keep", "R_B_POST_"),
        ("fu", "fu_keep", "R_B_FU_"),
    ]

    tables = {}
    achieved = {}
    counter = 0
    for time_key, size_key, prefix in time_defs:
        rows = []
        for gname, gspec in groups.items():
            n_g = gspec[size_key]
            target_p = gspec["target_p"][time_key]
            theta_target = logit(np.clip(target_p, 0.05, 0.95))
            n_correct_list = []
            for _ in range(n_g):
                counter += 1
                theta_i = theta_target + rng.normal(0, 0.5)
                d = metadata_row(rng, counter, f"{prefix}{counter:04d}")
                item_row, n_correct = sim_items(theta_i)
                d.update(item_row)
                d["Q2"] = gname
                d["SC0"] = n_correct
                rows.append(d)
                n_correct_list.append(n_correct)
            achieved.setdefault(gname, {})[time_key] = {
                "n": n_g,
                "mean_proportion_correct": round(float(np.mean(n_correct_list)) / n_items, 4),
            }
        rng.shuffle(rows)
        tables[time_key] = rows

    columns = METADATA_NAMES + ["Q2"] + item_ids + ["SC0"]
    qtext = {"Q2": "Which group are you in?"}
    qtext.update(item_text)
    qtext["SC0"] = "Total score (auto-scored)"

    for time_key, fname in [("pre", "pre.csv"), ("post", "post.csv"), ("fu", "followup.csv")]:
        table = build_qualtrics_matrix(columns, qtext, tables[time_key], three_header=True)
        save_csv(table, outdir / fname)

    with open(outdir / "answer_key.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["item", "question_text", "correct_answer"])
        for iid in item_ids:
            w.writerow([iid, item_text[iid], answer_key[iid]])

    gt = {
        "dataset": "three_groups_prepost_followup",
        "group_variable": "Q2",
        "groups": list(groups.keys()),
        "n_per_group_per_time": {
            g: {"pre": gs["n_pre"], "post": gs["post_keep"], "followup": gs["fu_keep"]}
            for g, gs in groups.items()
        },
        "n_total_per_time": {
            "pre": sum(g["n_pre"] for g in groups.values()),
            "post": sum(g["post_keep"] for g in groups.values()),
            "followup": sum(g["fu_keep"] for g in groups.values()),
        },
        "linked": False,
        "note": "Unequal group sizes; rows shrink pre->post->followup"
                " simulating dropout (independent samples per time, no ID link).",
        "n_items": n_items,
        "item_choices": choices,
        "answer_key_file": "answer_key.csv",
        "score_column": "SC0",
        "true_design": {
            "target_proportion_correct": {g: gs["target_p"] for g, gs in groups.items()},
            "pattern": "post: B > A > Control; followup: partial fade toward baseline"
                       " but ordering (B > A > Control) preserved",
        },
        "achieved": achieved,
        "gotchas": [
            "20-item raw-choice (A-D) knowledge test scored via answer_key.csv,"
            " not pre-scored — Phase 1/2 must apply the key to compute SC0-equivalent.",
            "SC0 column present alongside raw items (Qualtrics scored-test column).",
            "Group variable Q2 uses text choices, not numeric codes.",
            "Unequal n per group and per time point; row counts shrink across"
            " pre -> post -> followup (dropout).",
            "True effect: Intervention B > Intervention A > Control at post,"
            " with partial fade (but same ordering) at follow-up.",
        ],
    }
    (outdir / "ground_truth.json").write_text(json.dumps(gt, indent=2) + "\n")
    return gt


# ===========================================================================
# Dataset (c): messy_qualtrics
# ===========================================================================
def gen_messy_qualtrics(rng: np.random.Generator, outdir: Path):
    n_real = 100
    n_preview = 3
    n_spam = 2
    n_duplicate_identity = 2
    n_unfinished = 6

    matrix_ids = [f"Q5_{i}" for i in range(1, 7)]
    reverse_items = {"Q5_4"}
    matrix_text = {
        iid: f"Matrix statement {i} about classroom experience"
        f"{' (reverse-worded)' if iid in reverse_items else ''}"
        for i, iid in enumerate(matrix_ids, start=1)
    }

    q6_values = [1, 2, 4, 5, 7]
    q6_labels = {1: "Strongly disagree", 2: "Disagree", 4: "Neutral",
                 5: "Agree", 7: "Strongly agree"}

    multiselect_options = ["Textbook", "Online videos", "Study group", "Tutor",
                            "Practice problems", "Office hours", "Flashcards", "Other"]

    timing_cols = ["Q1_First Click", "Q1_Last Click", "Q1_Page Submit", "Q1_Click Count"]

    duplicate_identity = {"first": "Jordan", "last": "Reyes", "email": "jordan.reyes@example.edu"}

    def make_row(i, *, status="IP Address", finished=True, progress=100, is_dup=False):
        d = metadata_row(rng, i, f"R_C_{i:05d}", finished=finished, progress=progress,
                          status=status, pii=True)
        if is_dup:
            d["RecipientFirstName"] = duplicate_identity["first"]
            d["RecipientLastName"] = duplicate_identity["last"]
            d["RecipientEmail"] = duplicate_identity["email"]
        else:
            d["RecipientFirstName"] = f"First{i}"
            d["RecipientLastName"] = f"Last{i}"
            d["RecipientEmail"] = f"student{i}@example.edu"

        # Q1: consent item + timing metadata
        d["Q1"] = "Yes"
        d["Q1_First Click"] = round(float(rng.uniform(0, 3)), 2)
        d["Q1_Last Click"] = round(float(rng.uniform(3, 8)), 2)
        d["Q1_Page Submit"] = round(float(rng.uniform(8, 15)), 2)
        d["Q1_Click Count"] = int(rng.integers(1, 4))

        # Q5 matrix, numeric 1-5 with occasional -99 missing code
        for iid in matrix_ids:
            if rng.random() < 0.03:
                d[iid] = -99
            else:
                latent = 3.0 + rng.normal(0, 0.9)
                val = likert_round((6 - latent) if iid in reverse_items else latent)
                d[iid] = val

        # Q6: odd Qualtrics recode values {1,2,4,5,7}
        if rng.random() < 0.02:
            d["Q6"] = -99
        else:
            d["Q6"] = int(q6_values[rng.integers(0, len(q6_values))])

        # Q7: multi-select comma-separated
        k = int(rng.integers(1, 4))
        picks = list(rng.choice(multiselect_options, size=k, replace=False))
        d["Q7"] = ", ".join(picks)
        d["Q7_8_TEXT"] = "Peer tutoring center" if "Other" in picks else ""

        # Q9: open-ended that happens to contain email-like text (PII trap)
        d["Q9"] = f"You can reach me at student{i}@example.edu if you need more detail."

        # Q10: open-ended, multi-line with commas and quotes
        d["Q10"] = (f'I liked the pacing, the examples, and the "extra practice" set.\n'
                     f'Overall: solid, would recommend, 9/10.')

        d["SC0"] = int(rng.integers(60, 100))
        return d

    rows = []
    idx = 1
    for _ in range(n_real):
        rows.append(make_row(idx, progress=100, finished=True))
        idx += 1
    # duplicate identity: two respondents share name/email
    dup_ids = [idx, idx + 1]
    for _ in range(n_duplicate_identity):
        rows.append(make_row(idx, progress=100, finished=True, is_dup=True))
        idx += 1
    # unfinished (Progress < 100)
    for _ in range(n_unfinished):
        rows.append(make_row(idx, progress=int(rng.integers(10, 95)), finished=False))
        idx += 1
    # survey preview rows
    for _ in range(n_preview):
        rows.append(make_row(idx, status="Survey Preview", progress=100, finished=True))
        idx += 1
    # spam rows
    for _ in range(n_spam):
        rows.append(make_row(idx, status="Spam", progress=int(rng.integers(0, 30)), finished=False))
        idx += 1

    rng.shuffle(rows)
    n_total = len(rows)

    columns = (METADATA_NAMES + ["Q1"] + timing_cols + matrix_ids + ["Q6"] +
               ["Q7", "Q7_8_TEXT", "Q9", "Q10", "SC0"])
    qtext = {
        "Q1": "Do you consent to participate?",
        "Q1_First Click": "Q1 - First Click",
        "Q1_Last Click": "Q1 - Last Click",
        "Q1_Page Submit": "Q1 - Page Submit",
        "Q1_Click Count": "Q1 - Click Count",
        "Q6": "How satisfied are you with the course overall?",
        "Q7": "Which study strategies did you use? (select all that apply)",
        "Q7_8_TEXT": "Which study strategies did you use? - Other, please specify",
        "Q9": "Is there anything else you'd like to share? (open-ended)",
        "Q10": "Please describe your overall experience.",
        "SC0": "Total score",
    }
    qtext.update(matrix_text)

    full_table = build_qualtrics_matrix(columns, qtext, rows, three_header=True)
    two_header_table = [full_table[0], full_table[1]] + full_table[3:]

    save_csv(full_table, outdir / "messy_3header.csv", encoding="utf-8-sig")
    save_csv(two_header_table, outdir / "messy_2header.csv", encoding="utf-8")
    save_csv(full_table, outdir / "messy_utf16.csv", encoding="utf-16", delimiter="\t")

    # Text-choice variant: recode Q5_1..Q5_6 and Q6 to text labels.
    numeric_to_text = {1: "Strongly disagree", 2: "Disagree", 3: "Neutral",
                       4: "Agree", 5: "Strongly agree"}
    text_rows = []
    for d in rows:
        d2 = dict(d)
        for iid in matrix_ids:
            v = d2[iid]
            d2[iid] = numeric_to_text.get(v, v) if v != -99 else -99
        v6 = d2["Q6"]
        d2["Q6"] = q6_labels.get(v6, v6) if v6 != -99 else -99
        text_rows.append(d2)
    text_table = build_qualtrics_matrix(columns, qtext, text_rows, three_header=True)
    save_csv(text_table, outdir / "messy_text_choices.csv", encoding="utf-8")

    # XLSX variant: sheet 1 = notes/instructions, sheet 2 (data) = 3-header + data.
    notes_sheet = [["Statly practice fixture"],
                   ["Data is on the second sheet ('Data')."],
                   ["Generated by fixtures/practice/generate.py, seed 20260924."]]
    data_sheet = full_table
    write_xlsx(outdir / "messy.xlsx", {"Notes": notes_sheet, "Data": data_sheet})

    n_unfinished = sum(1 for d in rows if d["Finished"] == "False")
    n_missing99 = sum(
        1 for d in rows for iid in matrix_ids + ["Q6"] if d[iid] == -99
    )

    gt = {
        "dataset": "messy_qualtrics",
        "files": {
            "messy_3header.csv": {"encoding": "utf-8-sig", "delimiter": ",", "header_rows": 3},
            "messy_2header.csv": {"encoding": "utf-8", "delimiter": ",", "header_rows": 2},
            "messy_utf16.csv": {"encoding": "utf-16", "delimiter": "\t", "header_rows": 3},
            "messy_text_choices.csv": {"encoding": "utf-8", "delimiter": ",", "header_rows": 3,
                                        "note": "Q5_1..Q5_6 and Q6 use text choice labels"},
            "messy.xlsx": {"sheets": ["Notes", "Data"], "data_sheet": "Data", "header_rows": 3},
        },
        "n_rows_total": n_total,
        "n_survey_preview": n_preview,
        "n_spam": n_spam,
        "n_valid_after_status_filter": n_total - n_preview - n_spam,
        "n_unfinished": n_unfinished,
        "pii_columns": ["IPAddress", "RecipientFirstName", "RecipientLastName",
                         "RecipientEmail", "LocationLatitude", "LocationLongitude"],
        "pii_lookalike_columns": ["Q9"],
        "matrix_block": {"columns": matrix_ids, "reverse_worded_items": sorted(reverse_items)},
        "multiselect_column": "Q7",
        "multiselect_options": multiselect_options,
        "multiselect_other_text_column": "Q7_8_TEXT",
        "timing_columns": timing_cols,
        "score_column": "SC0",
        "q6_recode_values": q6_values,
        "missing_code": -99,
        "n_missing_code_cells": n_missing99,
        "open_ended_columns": ["Q9", "Q10"],
        "duplicate_identity": {
            "first_name": duplicate_identity["first"],
            "last_name": duplicate_identity["last"],
            "email": duplicate_identity["email"],
            "n_rows_sharing_identity": 2,
        },
        "gotchas": [
            "3 'Survey Preview' and 2 'Spam' rows in Status, to be excluded by the row filter.",
            "6 unfinished responses (Progress < 100) among the valid rows.",
            "PII populated: IPAddress, Recipient first/last/email, lat/long.",
            "Q9 (open text) contains email-look-alike strings though not flagged as a PII column.",
            "Q5_1..Q5_6 matrix with Q5_4 reverse-worded.",
            "Q7 multi-select comma-separated with Q7_8_TEXT 'Other, please specify'.",
            "Q1_First/Last Click, Q1_Page Submit, Q1_Click Count are timing metadata.",
            "SC0 is a scored-test total column.",
            "Q6 uses non-contiguous Qualtrics recode values {1,2,4,5,7}, not 1-5.",
            "-99 used as a missing-value code in Q5_* and Q6.",
            "Q10 is multi-line free text containing commas and quotes (CSV-quoting test).",
            "Two respondents share identical first/last name and email (not duplicate ResponseIds).",
            "Same underlying data across messy_3header/2header/utf16/text_choices/xlsx"
            " so parsers can be cross-checked for identical row/col counts.",
        ],
    }
    (outdir / "ground_truth.json").write_text(json.dumps(gt, indent=2) + "\n")
    return gt


# ===========================================================================
# Dataset (d): linked_id_prepost
# ===========================================================================
def gen_linked_id_prepost(rng: np.random.Generator, outdir: Path):
    n_pre = 80
    pre_only_n = 5
    post_only_n = 4
    dup_n = 2
    matched_n = n_pre - pre_only_n  # 75

    def make_id(i):
        letters = "".join(chr(65 + int(rng.integers(0, 26))) for _ in range(2))
        day = int(rng.integers(1, 29))
        return f"{letters}{day:02d}"

    ids = []
    seen = set()
    while len(ids) < n_pre:
        cand = make_id(len(ids))
        if cand not in seen:
            seen.add(cand)
            ids.append(cand)

    pre_only_ids = ids[:pre_only_n]
    matched_ids = ids[pre_only_n:]  # 75
    assert len(matched_ids) == matched_n

    true_pre = rng.normal(65, 15, n_pre)
    true_pre = np.clip(true_pre, 0, 100)
    id_to_pre_score = dict(zip(ids, true_pre))

    def normalize_case_whitespace(rng, s):
        variant = int(rng.integers(0, 4))
        if variant == 0:
            return s.lower()
        if variant == 1:
            return f"  {s.upper()}  "
        if variant == 2:
            return f"{s}\t"
        return s

    pre_rows = []
    for i, sid in enumerate(ids):
        d = metadata_row(rng, i, f"R_D_PRE_{i:04d}")
        d["Q1"] = sid
        d["Q4"] = round(float(id_to_pre_score[sid]), 1)
        pre_rows.append(d)
    rng.shuffle(pre_rows)

    post_only_ids = [f"NW{10 + j:02d}" for j in range(post_only_n)]

    post_records = []  # (id_for_file, score)
    for sid in matched_ids:
        gain = rng.normal(5, 8)
        score = float(np.clip(id_to_pre_score[sid] + gain, 0, 100))
        post_records.append((sid, score))
    for sid in post_only_ids:
        score = float(np.clip(rng.normal(65, 15), 0, 100))
        post_records.append((sid, score))

    dup_source = list(rng.choice(matched_ids, size=dup_n, replace=False))
    for sid in dup_source:
        base_score = dict(post_records)[sid]
        retake_score = float(np.clip(base_score + rng.normal(0, 5), 0, 100))
        post_records.append((sid, retake_score))

    post_rows = []
    for j, (sid, score) in enumerate(post_records):
        d = metadata_row(rng, 1000 + j, f"R_D_POST_{j:04d}")
        d["Q1"] = normalize_case_whitespace(rng, sid)
        d["Q4"] = round(score, 1)
        post_rows.append(d)
    rng.shuffle(post_rows)

    columns = METADATA_NAMES + ["Q1", "Q4"]
    qtext = {
        "Q1": "Please enter your unique ID (first two initials + birth day, e.g. AB05)",
        "Q4": "Assessment score (0-100)",
    }
    pre_table = build_qualtrics_matrix(columns, qtext, pre_rows, three_header=True)
    post_table = build_qualtrics_matrix(columns, qtext, post_rows, three_header=True)
    save_csv(pre_table, outdir / "pre.csv")
    save_csv(post_table, outdir / "post.csv")

    n_post_rows = len(post_rows)
    n_post_unique = len(set(matched_ids) | set(post_only_ids))

    gt = {
        "dataset": "linked_id_prepost",
        "id_column": "Q1",
        "outcome_column": "Q4",
        "n_pre_rows": n_pre,
        "n_pre_unique_ids": n_pre,
        "n_post_rows": n_post_rows,
        "n_post_unique_ids_after_normalization": n_post_unique,
        "n_matched_after_normalization": matched_n,
        "n_pre_only": pre_only_n,
        "n_post_only": post_only_n,
        "n_duplicated_ids_in_post": dup_n,
        "duplicated_ids": sorted(set(dup_source)),
        "id_normalization_needed": True,
        "id_normalization_note": "post.csv IDs vary in case and have leading/trailing"
                                  " whitespace/tabs relative to pre.csv; must be"
                                  " trimmed and case-folded before matching (SPEC 5.4).",
        "true_design": {
            "pre_mean_target": 65, "pre_sd_target": 15,
            "post_gain_mean_target": 5, "post_gain_sd_target": 8,
        },
        "gotchas": [
            "post.csv has more physical rows (81) than unique post IDs (79)"
            " because 2 IDs are duplicated (retake); n_post_rows counts all rows.",
            "5 IDs appear only in pre.csv (pre-only, excluded from paired analyses).",
            "4 IDs appear only in post.csv (post-only, e.g. late add).",
            "ID case/whitespace must be normalized before matching pre/post.",
            "Q4 is a continuous 0-100 outcome present in both files.",
        ],
    }
    (outdir / "ground_truth.json").write_text(json.dumps(gt, indent=2) + "\n")
    return gt


# ===========================================================================
# README generation
# ===========================================================================
def write_readme(all_gt: dict, outpath: Path):
    a, b, c, d = (all_gt["one_group_prepost_likert"], all_gt["three_groups_prepost_followup"],
                  all_gt["messy_qualtrics"], all_gt["linked_id_prepost"])
    text = f"""# Statly practice datasets

Generated by `generate.py` (numpy `Generator`, seed `{SEED}`). Deterministic and
idempotent: running `python generate.py` regenerates every file below from
scratch. Verify with `python verify.py`.

Each dataset directory has a `ground_truth.json` with the exact counts and
planted values a test can assert against — this README explains the design
in prose; `ground_truth.json` is the source of truth for numbers.

## a. one_group_prepost_likert/

**Purpose:** simplest pre/post design — one cohort, one Likert scale, two
separate Qualtrics exports (aggregate mode only, no linking ID).

**Files:** `pre.csv`, `post.csv` — 3-row Qualtrics header, {a['n_pre']} respondents
each, identical question text/short IDs in both files (for multi-file
stacking, SPEC 5.3).

**Columns:** standard 17 Qualtrics metadata columns + matrix `Q3_1..Q3_10`
(1-5 numeric Likert).

**Ground-truth design:** items simulated from a per-respondent latent trait,
target pre mean {a['true_design']['pre_mean_target']}, target post mean
{a['true_design']['post_mean_target']:.3f} (item SD
{a['true_design']['item_sd_target']}), target Cohen's d =
{a['true_design']['target_cohens_d']}. Achieved (reverse-scored) scale-level d =
{a['achieved']['cohens_d']}.

**Gotchas planted:**
- Q3_3 and Q3_8 are negatively worded and require reverse-scoring (`6 - x`).
- pre/post are independent Qualtrics exports (no shared ID) — only
  aggregate-mode (independent-samples) comparisons are valid.

## b. three_groups_prepost_followup/

**Purpose:** 3-group x 3-timepoint design with a raw-choice knowledge test
and an external answer key, unequal n and dropout.

**Files:** `pre.csv`, `post.csv`, `followup.csv` (3-row Qualtrics header) +
`answer_key.csv` (item, question_text, correct_answer).

**Columns:** metadata + group variable `Q2` (text choices: {', '.join(b['groups'])})
+ 20 raw-choice items `Q4_1..Q4_20` (A-D) + `SC0` (total score).

**Ground-truth design:** per-respondent ability simulated via a 2PL-style
item-response model against a fixed item bank; target proportion-correct by
group/time is in `ground_truth.json['true_design']`. Planted pattern:
Intervention B > Intervention A > Control at post, with partial fade toward
baseline (same ordering preserved) at follow-up.

**n per group/time (post/followup n < pre, simulating dropout):**
{json.dumps(b['n_per_group_per_time'], indent=2)}

**Gotchas planted:**
- Items are raw choices, not pre-scored — must be scored against `answer_key.csv`.
- `SC0` scored-total column is present alongside the raw items.
- `Q2` group variable uses text labels, not numeric codes.
- Unequal group sizes; row counts shrink pre -> post -> followup (no linking ID; independent samples per time).

## c. messy_qualtrics/

**Purpose:** one survey's data exported/re-encoded five different ways, to
exercise Qualtrics-format parsing edge cases (SPEC 5.1, 5.2, 12).

**Files (same {c['n_rows_total']} underlying rows in each):**
- `messy_3header.csv` — UTF-8 with BOM, 3-row header, comma-delimited.
- `messy_2header.csv` — UTF-8, 2-row header (older Qualtrics export), comma-delimited.
- `messy_utf16.csv` — UTF-16LE with BOM, 3-row header, **tab**-delimited.
- `messy_text_choices.csv` — UTF-8, 3-row header; `Q5_1..Q5_6` and `Q6` use
  text choice labels instead of numeric codes.
- `messy.xlsx` — two sheets; sheet 1 (`Notes`) is instructions, sheet 2
  (`Data`) holds the 3-row-header table. Written by a small stdlib-only OOXML
  writer in `generate.py` (openpyxl is not installed in `engine/.venv`).

**Gotchas planted (see `ground_truth.json` for exact counts):**
- {c['n_survey_preview']} `Survey Preview` and {c['n_spam']} `Spam` rows in `Status` (row filter target).
- {c['n_unfinished']} unfinished responses (`Progress` < 100).
- PII populated: IPAddress, Recipient first/last/email, lat/long.
- `Q9` open text contains email-look-alike strings (PII heuristic trap; not
  itself flagged as a structural PII column).
- Matrix `Q5_1..Q5_6` with `Q5_4` reverse-worded.
- Multi-select `Q7` (comma-separated) with `Q7_8_TEXT` ("Other, please specify").
- Timing columns `Q1_First Click`, `Q1_Last Click`, `Q1_Page Submit`, `Q1_Click Count`.
- Score column `SC0`.
- `Q6` uses non-contiguous Qualtrics recode values `{c['q6_recode_values']}`, not 1-5.
- `-99` missing-value code used in `Q5_*`/`Q6` ({c['n_missing_code_cells']} cells).
- `Q10` open text is multi-line with embedded commas and quotes.
- Two respondents share identical first/last name and email (not duplicate
  ResponseIds) — `{c['duplicate_identity']['first_name']} {c['duplicate_identity']['last_name']}`.

## d. linked_id_prepost/

**Purpose:** exercise ID-linking/normalization logic (SPEC 5.4).

**Files:** `pre.csv` ({d['n_pre_rows']} rows, all unique IDs), `post.csv`
({d['n_post_rows']} rows).

**Columns:** metadata + self-generated ID `Q1` + continuous outcome `Q4` (0-100).

**Design:** {d['n_matched_after_normalization']} of the pre IDs also appear in
post (after case/whitespace normalization); {d['n_pre_only']} pre IDs never
return ({d['n_pre_only']} pre-only); {d['n_post_only']} IDs appear only in post
(late adds); {d['n_duplicated_ids_in_post']} IDs appear twice in post
(retakes), so post.csv has {d['n_post_rows']} physical rows but only
{d['n_post_unique_ids_after_normalization']} unique IDs after normalization.

**Gotchas planted:**
- `Q1` IDs in `post.csv` vary in case and have stray leading/trailing
  whitespace/tabs relative to `pre.csv` — must be trimmed + case-folded
  before matching.
- Row count vs. unique-ID count differ in `post.csv` because of the 2 duplicated IDs.
- `Q4` is a simple continuous 0-100 outcome, simulated with a true mean gain
  of {d['true_design']['post_gain_mean_target']} points (SD
  {d['true_design']['post_gain_sd_target']}) for matched respondents.

## Regenerating

```
engine/.venv/bin/python fixtures/practice/generate.py
engine/.venv/bin/python fixtures/practice/verify.py
```
"""
    outpath.write_text(text)


# ===========================================================================
# main
# ===========================================================================
def main():
    rng = np.random.default_rng(SEED)
    all_gt = {}
    all_gt["one_group_prepost_likert"] = gen_one_group_prepost_likert(
        rng, HERE / "one_group_prepost_likert")
    all_gt["three_groups_prepost_followup"] = gen_three_groups_prepost_followup(
        rng, HERE / "three_groups_prepost_followup")
    all_gt["messy_qualtrics"] = gen_messy_qualtrics(rng, HERE / "messy_qualtrics")
    all_gt["linked_id_prepost"] = gen_linked_id_prepost(rng, HERE / "linked_id_prepost")
    write_readme(all_gt, HERE / "README.md")
    print("Generated practice datasets:")
    for name in all_gt:
        print(f"  - {name}/")


if __name__ == "__main__":
    main()
