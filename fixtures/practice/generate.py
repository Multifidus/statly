#!/usr/bin/env python3
"""
Generate Statly practice datasets (SPEC.md section 11.4).

Deterministic, seeded, idempotent: `python generate.py` regenerates every
file below from scratch and always produces byte-identical output for a
given numpy/pandas version.

Uses numpy, pandas, openpyxl (for .xlsx output) and the Python standard
library.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np
import openpyxl
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
# XLSX writer (openpyxl)
# ---------------------------------------------------------------------------
def write_xlsx(path, sheets: dict):
    """sheets: dict[str, list[list]] -> writes an .xlsx with one sheet per key."""
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(title=name)
        for row in rows:
            ws.append(["" if v is None else v for v in row])
    wb.save(path)


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

    # Q10: pool of ~25 realistic student comments about the math class.
    # Drawn from a dedicated RNG stream (seeded independently of `rng`) so
    # adding this pool does not shift any other column's random draws, nor
    # the draws made by datasets generated after this one in main().
    q10_comments = [
        'I liked the pacing, the examples, and the "extra practice" set.\n'
        'Overall: solid, would recommend, 9/10.',
        "This class was really helpful, especially the office hours.",
        "I struggled with the pace at first, but it got better.",
        "",
        "Loved the group projects, hated the exams.",
        "Too much homework, not enough review before tests.",
        "The professor explained things clearly, and the TA was great too.",
        "Honestly, I think this was one of my favorite math classes.",
        "It was fine. Nothing special, nothing terrible.",
        'The "flipped classroom" approach didn\'t work for me.',
        "More practice problems would help, please add some.",
        "",
        "I wish we had more time on word problems, graphs, and functions.",
        "Great class overall, thanks for a good semester.",
        "The online videos were confusing, but the textbook helped.",
        "If you have questions about the final, email me at jsmith@school.edu.",
        "Not enough feedback on homework, exams were tough, and grading was slow.",
        "I really enjoyed working through proofs step by step.",
        "This was hard for me,\nbut I learned a lot in the end.",
        "The pacing was uneven: too slow in week 1, too fast by week 10.",
        "Best math teacher I've had, would take another class with them.",
        "",
        "Study groups were helpful, especially before quizzes.",
        "I'd recommend adding more review sessions, practice quizzes, and examples.",
        "Feel free to reach out at abarnes@school.edu with any follow-up questions.",
    ]
    q10_rng = np.random.default_rng(SEED + 10)

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

        # Q10: open-ended, drawn from a pool of ~25 realistic comments
        # (commas, quotes, embedded newlines, blanks, email look-alikes).
        d["Q10"] = q10_comments[int(q10_rng.integers(0, len(q10_comments)))]

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
    n_q10_blank = sum(1 for d in rows if not d["Q10"])
    n_q10_distinct = len({d["Q10"] for d in rows})
    n_q10_email_hits = sum(1 for d in rows if "@" in d["Q10"])

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
        "q10_pool_size": len(q10_comments),
        "n_q10_distinct_values": n_q10_distinct,
        "n_q10_blank": n_q10_blank,
        "n_q10_email_lookalike_hits": n_q10_email_hits,
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
            "Q10 is drawn from a pool of ~25 realistic student comments (CSV-quoting test:"
            " commas, embedded double quotes, embedded newlines); a few rows are blank,"
            " and a couple contain an email look-alike string though Q10 is not flagged"
            " as a PII column.",
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
# Dataset (e): regression_predictors
# ===========================================================================
def gen_regression_predictors(rng: np.random.Generator, outdir: Path):
    n = 220
    genders = ["Male", "Female", "Nonbinary"]
    gender_p = [0.45, 0.48, 0.07]
    programs = ["Education", "Psychology", "Business"]
    program_p = [0.40, 0.35, 0.25]
    program_effect = {"Education": 0.0, "Psychology": 3.0, "Business": -2.0}

    motivation_ids = [f"Q8_{i}" for i in range(1, 7)]
    motivation_text = {
        iid: f"Motivation item {i}: statement about study motivation"
        for i, iid in enumerate(motivation_ids, start=1)
    }

    pretest = np.clip(rng.normal(65, 12, n), 0, 100)
    hours = np.clip(rng.normal(8, 4, n), 0.5, None)
    gender_arr = rng.choice(genders, size=n, p=gender_p)
    program_arr = rng.choice(programs, size=n, p=program_p)
    prog_eff = np.array([program_effect[p] for p in program_arr])

    b_pretest, b_hours, intercept, resid_sd = 0.6, 1.5, 15.0, 8.0
    noise = rng.normal(0, resid_sd, n)
    posttest = intercept + b_pretest * pretest + b_hours * hours + prog_eff + noise
    posttest = np.clip(posttest, 0, 100)

    # Planted outliers (fixed indices, traceable via ResponseId in ground_truth).
    outlier_idx = [17, 188]
    posttest[outlier_idx[0]] = 6.0  # residual outlier: high pretest/hours, very low posttest
    hours[outlier_idx[1]] = 42.0  # leverage outlier: implausible hours_studied
    posttest[outlier_idx[1]] = min(100.0, posttest[outlier_idx[1]] + 8)

    minutes = np.clip(hours * 60 + rng.normal(0, 12, n), 0, None)  # collinear with hours
    gpa = np.clip(2.0 + (pretest - 65) * 0.018 + rng.normal(0, 0.4, n), 0, 4)
    motiv_latent = rng.normal(3.0, 0.8, n)
    motiv_items = {
        iid: [likert_round(motiv_latent[i] + rng.normal(0, 0.6)) for i in range(n)]
        for iid in motivation_ids
    }
    pass_fail = np.where(posttest >= 60, "Pass", "Fail")

    gpa_missing = rng.random(n) < 0.05
    motiv_missing_mask = {iid: rng.random(n) < 0.04 for iid in motivation_ids}

    rows = []
    for i in range(n):
        d = metadata_row(rng, i, f"R_E_{i:04d}")
        d["Q2"] = gender_arr[i]
        d["Q3"] = program_arr[i]
        d["Q4"] = round(float(hours[i]), 2)
        d["Q5"] = "" if gpa_missing[i] else round(float(gpa[i]), 2)
        d["Q6"] = round(float(pretest[i]), 1)
        d["Q7"] = round(float(posttest[i]), 1)
        for iid in motivation_ids:
            d[iid] = "" if motiv_missing_mask[iid][i] else motiv_items[iid][i]
        d["Q9"] = pass_fail[i]
        d["Q10"] = round(float(minutes[i]), 1)
        rows.append(d)

    outlier_response_ids = [rows[i]["ResponseId"] for i in outlier_idx]

    columns = METADATA_NAMES + ["Q2", "Q3", "Q4", "Q5", "Q6", "Q7"] + motivation_ids + ["Q9", "Q10"]
    qtext = {
        "Q2": "What is your gender?",
        "Q3": "What is your program?",
        "Q4": "About how many hours per week did you study?",
        "Q5": "What is your current GPA (0-4 scale)?",
        "Q6": "Pretest score (0-100)",
        "Q7": "Posttest score (0-100)",
        "Q9": "Did you pass the course?",
        "Q10": "About how many minutes per week did you study?",
    }
    qtext.update(motivation_text)
    table = build_qualtrics_matrix(columns, qtext, rows, three_header=True)
    save_csv(table, outdir / "survey.csv")

    corr_hours_minutes = float(np.corrcoef(hours, minutes)[0, 1])
    n_missing_gpa = int(gpa_missing.sum())
    n_missing_motivation = int(sum(mask.sum() for mask in motiv_missing_mask.values()))

    gt = {
        "dataset": "regression_predictors",
        "n": n,
        "files": ["survey.csv"],
        "header_rows": 3,
        "outcome_column": "Q7",
        "predictor_columns": ["Q6", "Q4", "Q3"],
        "group_columns": ["Q2", "Q3"],
        "pass_fail_column": "Q9",
        "motivation_scale_items": motivation_ids,
        "collinear_pair": {"hours_column": "Q4", "minutes_column": "Q10",
                            "achieved_correlation": round(corr_hours_minutes, 4)},
        "true_design": {
            "model": "Q7 ~ intercept + b_pretest*Q6 + b_hours*Q4 + program_effect + noise",
            "intercept": intercept, "b_pretest": b_pretest, "b_hours": b_hours,
            "program_effect": program_effect, "residual_sd": resid_sd,
        },
        "outliers": {"indices_0based": outlier_idx, "response_ids": outlier_response_ids,
                     "description": ["residual outlier: posttest far below model prediction",
                                      "leverage outlier: hours_studied implausibly high (42)"]},
        "missing": {"gpa_missing_cells": n_missing_gpa,
                    "motivation_missing_cells": n_missing_motivation},
        "gotchas": [
            "Posttest (Q7) is planted as a linear function of pretest (Q6) + hours_studied"
            " (Q4) + a small program (Q3) effect, plus noise.",
            "Q10 (minutes_studied) is near-collinear with Q4 (hours_studied) — a"
            " multicollinearity/VIF demo for multiple regression.",
            "Two planted outliers: a residual outlier (row with ResponseId "
            f"{outlier_response_ids[0]}) and a leverage outlier ({outlier_response_ids[1]}).",
            "Q5 (GPA) and the Q8_1..Q8_6 motivation items have missing cells (blank in CSV).",
            "Q9 (pass/fail) is derived from posttest >= 60 — usable as a logistic"
            " regression outcome.",
        ],
    }
    (outdir / "ground_truth.json").write_text(json.dumps(gt, indent=2) + "\n")
    return gt


# ===========================================================================
# Dataset (f): categorical_outcomes
# ===========================================================================
def gen_categorical_outcomes(rng: np.random.Generator, outdir: Path):
    n = 300
    programs = ["Education", "Psychology", "Business"]
    program_p = [0.40, 0.35, 0.25]
    pass_p_by_program = {"Education": 0.55, "Psychology": 0.75, "Business": 0.85}

    program_arr = rng.choice(programs, size=n, p=program_p)
    pass_fail = np.array([
        "Pass" if rng.random() < pass_p_by_program[p] else "Fail" for p in program_arr
    ])

    extra_credit_p = 0.03  # rare event -> sparse 2x2 with expected counts < 5
    extra_credit = np.where(rng.random(n) < extra_credit_p, "Yes", "No")

    office_pre = np.where(rng.random(n) < 0.30, "Yes", "No")
    office_post = office_pre.copy()
    no_idx = np.where(office_pre == "No")[0]
    yes_idx = np.where(office_pre == "Yes")[0]
    office_post[no_idx[rng.random(len(no_idx)) < 0.25]] = "Yes"
    office_post[yes_idx[rng.random(len(yes_idx)) < 0.05]] = "No"

    base = rng.random(n)
    item1 = np.where(base < 0.40, "Yes", "No")
    item2 = np.where(base < 0.55, "Yes", "No")
    item3 = np.where(base < 0.70, "Yes", "No")

    def flip_some(arr, p):
        m = rng.random(len(arr)) < p
        out = arr.copy()
        out[m] = np.where(out[m] == "Yes", "No", "Yes")
        return out

    item1, item2, item3 = flip_some(item1, 0.05), flip_some(item2, 0.05), flip_some(item3, 0.05)

    rows = []
    for i in range(n):
        d = metadata_row(rng, i, f"R_F_{i:04d}")
        d["Q2"] = program_arr[i]
        d["Q3"] = pass_fail[i]
        d["Q4"] = extra_credit[i]
        d["Q5_pre"] = office_pre[i]
        d["Q5_post"] = office_post[i]
        d["Q6_1"] = item1[i]
        d["Q6_2"] = item2[i]
        d["Q6_3"] = item3[i]
        rows.append(d)

    columns = METADATA_NAMES + ["Q2", "Q3", "Q4", "Q5_pre", "Q5_post", "Q6_1", "Q6_2", "Q6_3"]
    qtext = {
        "Q2": "What is your program?",
        "Q3": "Did you pass the course?",
        "Q4": "Did you use an extra-credit opportunity?",
        "Q5_pre": "Did you use office hours before midterm?",
        "Q5_post": "Did you use office hours after midterm?",
        "Q6_1": "Used a study group this term?",
        "Q6_2": "Used a tutor this term?",
        "Q6_3": "Used the writing center this term?",
    }
    table = build_qualtrics_matrix(columns, qtext, rows, three_header=True)
    save_csv(table, outdir / "survey.csv")

    df = pd.DataFrame(rows)
    prog_ct = pd.crosstab(df["Q2"], df["Q3"])
    credit_ct = pd.crosstab(df["Q4"], df["Q3"])
    row_t, col_t = credit_ct.sum(axis=1), credit_ct.sum(axis=0)
    expected = pd.DataFrame(
        np.outer(row_t, col_t) / n, index=credit_ct.index, columns=credit_ct.columns)
    min_expected = float(expected.values.min())

    b = int(((df["Q5_pre"] == "No") & (df["Q5_post"] == "Yes")).sum())
    c = int(((df["Q5_pre"] == "Yes") & (df["Q5_post"] == "No")).sum())

    def endorse_rate(col):
        return round(float((df[col] == "Yes").mean()), 4)

    gt = {
        "dataset": "categorical_outcomes",
        "n": n,
        "files": ["survey.csv"],
        "header_rows": 3,
        "program_x_passfail": {
            "columns": ["Q2", "Q3"],
            "target_pass_rate_by_program": pass_p_by_program,
            "achieved_contingency_table": {str(k): {str(k2): int(v2) for k2, v2 in v.items()}
                                            for k, v in prog_ct.to_dict().items()},
        },
        "sparse_2x2": {
            "columns": ["Q4", "Q3"], "target_rare_event_rate": extra_credit_p,
            "achieved_min_expected_count": round(min_expected, 3),
            "note": "expected count(s) < 5 -> Fisher's exact test recommended over chi-square.",
        },
        "mcnemar_pair": {
            "columns": ["Q5_pre", "Q5_post"], "discordant_no_to_yes": b, "discordant_yes_to_no": c,
            "note": "linked yes/no pre/post pair (same respondents, same row) for McNemar's test.",
        },
        "cochran_q_items": {
            "columns": ["Q6_1", "Q6_2", "Q6_3"],
            "achieved_endorsement_rate": {c: endorse_rate(c) for c in ["Q6_1", "Q6_2", "Q6_3"]},
            "note": "three repeated yes/no items with increasing endorsement -> Cochran's Q.",
        },
        "gotchas": [
            "Q2 x Q3 (program x pass/fail) is a 3x2 table with a planted association"
            " (pass rate rises Education < Psychology < Business).",
            f"Q4 x Q3 is a sparse 2x2 (min expected count {round(min_expected, 2)} < 5)"
            " — use Fisher's exact test, not chi-square.",
            "Q5_pre/Q5_post is a linked yes/no pair (same respondents) for McNemar's test,"
            f" with {b} No->Yes switches vs {c} Yes->No switches.",
            "Q6_1/Q6_2/Q6_3 are three repeated yes/no items (same respondents) for"
            " Cochran's Q, with rising endorsement across items.",
        ],
    }
    (outdir / "ground_truth.json").write_text(json.dumps(gt, indent=2) + "\n")
    return gt


# ===========================================================================
# Dataset (g): scale_validation
# ===========================================================================
def gen_scale_validation(rng: np.random.Generator, outdir: Path):
    n = 320
    n_items = 15
    item_ids = [f"Q4_{i}" for i in range(1, n_items + 1)]
    factor_of = {}
    for i in range(1, 6):
        factor_of[f"Q4_{i}"] = 1
    for i in range(6, 11):
        factor_of[f"Q4_{i}"] = 2
    for i in range(11, 16):
        factor_of[f"Q4_{i}"] = 3
    reverse_items = {"Q4_3", "Q4_9"}
    cross_load_item = "Q4_11"
    cross_loading_secondary = 0.35

    loadings = {iid: float(rng.uniform(0.6, 0.8)) for iid in item_ids}
    factors = rng.normal(0, 1, size=(n, 3))

    item_vals = {}
    for iid in item_ids:
        f = factor_of[iid]
        loading = loadings[iid]
        uniq_var = 1 - loading ** 2
        latent = loading * factors[:, f - 1]
        if iid == cross_load_item:
            latent = latent + cross_loading_secondary * factors[:, 0]
            uniq_var = max(0.1, 1 - loading ** 2 - cross_loading_secondary ** 2)
        err = rng.normal(0, np.sqrt(uniq_var), n)
        raw = 3.0 + (latent + err)
        if iid in reverse_items:
            raw = 6.0 - raw
        item_vals[iid] = [likert_round(x) for x in raw]

    n_quiz = 20
    quiz_ids = [f"Q5_{i}" for i in range(1, n_quiz + 1)]
    ability = rng.normal(0, 1, n)
    very_easy = {"Q5_1", "Q5_2"}
    very_hard = {"Q5_19", "Q5_20"}
    neg_discrim = "Q5_10"
    quiz_difficulty = {}
    for iid in quiz_ids:
        if iid in very_easy:
            b_diff = -2.5
        elif iid in very_hard:
            b_diff = 2.5
        else:
            b_diff = float(rng.uniform(-1, 1))
        quiz_difficulty[iid] = b_diff

    quiz_vals = {}
    for iid in quiz_ids:
        b_diff = quiz_difficulty[iid]
        ability_eff = -ability if iid == neg_discrim else ability
        p = 1 / (1 + np.exp(-(ability_eff - b_diff)))
        quiz_vals[iid] = (rng.random(n) < p).astype(int)
    sc0 = sum(quiz_vals[iid] for iid in quiz_ids)

    rows = []
    for i in range(n):
        d = metadata_row(rng, i, f"R_G_{i:04d}")
        for iid in item_ids:
            d[iid] = item_vals[iid][i]
        for iid in quiz_ids:
            d[iid] = int(quiz_vals[iid][i])
        d["SC0"] = int(sc0[i])
        rows.append(d)

    columns = METADATA_NAMES + item_ids + quiz_ids + ["SC0"]
    qtext = {iid: f"Matrix item {i}: statement about study skills"
                   f"{' (reverse-worded)' if iid in reverse_items else ''}"
              for i, iid in enumerate(item_ids, start=1)}
    qtext.update({iid: f"Quiz item {i} (correct=1, incorrect=0)"
                  for i, iid in enumerate(quiz_ids, start=1)})
    qtext["SC0"] = "Total correct (0-20)"
    table = build_qualtrics_matrix(columns, qtext, rows, three_header=True)
    save_csv(table, outdir / "survey.csv")

    quiz_arr = np.array([quiz_vals[iid] for iid in quiz_ids])  # items x n
    p_vals = quiz_arr.mean(axis=1)
    total = sc0.astype(float)
    item_total_r = {}
    for j, iid in enumerate(quiz_ids):
        rest = total - quiz_arr[j]
        r = float(np.corrcoef(quiz_arr[j], rest)[0, 1])
        item_total_r[iid] = round(r, 4)
    var_total = float(total.var(ddof=1))
    kr20 = (n_quiz / (n_quiz - 1)) * (1 - float((p_vals * (1 - p_vals)).sum()) / var_total)

    gt = {
        "dataset": "scale_validation",
        "n": n,
        "files": ["survey.csv"],
        "header_rows": 3,
        "likert_scale": {
            "items": item_ids,
            "planted_factors": {
                "Factor1": [i for i in item_ids if factor_of[i] == 1],
                "Factor2": [i for i in item_ids if factor_of[i] == 2],
                "Factor3": [i for i in item_ids if factor_of[i] == 3],
            },
            "target_loadings_range": [0.6, 0.8],
            "achieved_loadings": {k: round(v, 3) for k, v in loadings.items()},
            "reverse_worded_items": sorted(reverse_items),
            "cross_loading_item": cross_load_item,
            "cross_loading_secondary_factor": "Factor1",
            "cross_loading_secondary_target": cross_loading_secondary,
        },
        "quiz": {
            "items": quiz_ids,
            "score_column": "SC0",
            "very_easy_items": sorted(very_easy),
            "very_hard_items": sorted(very_hard),
            "negatively_discriminating_item": neg_discrim,
            "achieved_p_values": {iid: round(float(p_vals[j]), 4) for j, iid in enumerate(quiz_ids)},
            "achieved_item_total_correlation": item_total_r,
            "achieved_kr20": round(float(kr20), 4),
        },
        "gotchas": [
            "15-item Likert matrix Q4_1..Q4_15 has 3 planted factors of 5 items each"
            " (loadings ~.6-.8) — EFA should recover a 3-factor structure.",
            f"{cross_load_item} cross-loads on Factor1 in addition to its primary factor.",
            "Q4_3 and Q4_9 are reverse-worded and must be reverse-scored before EFA/alpha.",
            "20-item right/wrong quiz Q5_1..Q5_20 with SC0 total for KR-20 and item analysis.",
            "Q5_1/Q5_2 are very easy (p > .9), Q5_19/Q5_20 are very hard (p < .15),"
            f" and {neg_discrim} has a negative item-total correlation"
            f" ({item_total_r[neg_discrim]}) — item analysis should flag it for removal.",
        ],
    }
    (outdir / "ground_truth.json").write_text(json.dumps(gt, indent=2) + "\n")
    return gt


# ===========================================================================
# Dataset (h): rater_agreement
# ===========================================================================
def gen_rater_agreement(rng: np.random.Generator, outdir: Path):
    n = 60
    true_quality = rng.normal(3, 0.9, n)

    def rater_score(noise_sd):
        val = true_quality + rng.normal(0, noise_sd, n)
        return np.clip(np.round(val), 1, 5).astype(int)

    r1, r2, r3 = rater_score(0.8), rater_score(0.8), rater_score(0.8)

    rows = []
    for i in range(n):
        rows.append({"essay_id": f"E{i + 1:03d}", "rater1": int(r1[i]),
                     "rater2": int(r2[i]), "rater3": int(r3[i])})
    missing_spec = [(3, "rater2"), (10, "rater1"), (25, "rater3"), (40, "rater2"), (55, "rater1")]
    for row_i, col in missing_spec:
        rows[row_i][col] = ""

    with open(outdir / "essay_ratings.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["essay_id", "rater1", "rater2", "rater3"])
        for row in rows:
            w.writerow([row["essay_id"], row["rater1"], row["rater2"], row["rater3"]])

    complete_r1 = np.array([r for r in r1])
    pairwise_rs = [
        float(np.corrcoef(r1, r2)[0, 1]),
        float(np.corrcoef(r1, r3)[0, 1]),
        float(np.corrcoef(r2, r3)[0, 1]),
    ]

    categories = ["Thesis clarity", "Evidence use", "Organization", "Mechanics"]
    true_cat = rng.choice(categories, size=n, p=[0.30, 0.30, 0.25, 0.15])
    agree_p = 0.75

    def rater_code(true_c):
        out = []
        for c in true_c:
            if rng.random() < agree_p:
                out.append(c)
            else:
                others = [x for x in categories if x != c]
                out.append(others[int(rng.integers(0, 3))])
        return out

    rater_b = rater_code(true_cat)
    with open(outdir / "nominal_coding.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["essay_id", "rater_a_category", "rater_b_category"])
        for i in range(n):
            w.writerow([f"E{i + 1:03d}", true_cat[i], rater_b[i]])

    po = float(np.mean(np.array(true_cat) == np.array(rater_b)))
    a_counts = pd.Series(true_cat).value_counts(normalize=True)
    b_counts = pd.Series(rater_b).value_counts(normalize=True)
    pe = float(sum(a_counts.get(c, 0) * b_counts.get(c, 0) for c in categories))
    kappa = (po - pe) / (1 - pe)

    gt = {
        "dataset": "rater_agreement",
        "n_essays": n,
        "files": {
            "essay_ratings.csv": {"format": "plain CSV, one row per essay", "raters": 3, "scale": "1-5"},
            "nominal_coding.csv": {"format": "plain CSV", "raters": 2, "n_categories": len(categories),
                                    "categories": categories},
        },
        "essay_ratings": {
            "target_agreement": "moderate (planted via shared true-quality score + rater noise SD 0.8)",
            "achieved_pairwise_pearson_r": {"r1_r2": round(pairwise_rs[0], 4),
                                             "r1_r3": round(pairwise_rs[1], 4),
                                             "r2_r3": round(pairwise_rs[2], 4)},
            "n_missing_cells": len(missing_spec),
            "missing_cells": [{"row_essay_id": rows[i]["essay_id"], "column": c}
                               for i, c in missing_spec],
        },
        "nominal_coding": {
            "target_agreement_rate": agree_p,
            "achieved_observed_agreement": round(po, 4),
            "achieved_expected_agreement": round(pe, 4),
            "achieved_cohens_kappa": round(kappa, 4),
        },
        "gotchas": [
            "essay_ratings.csv is a plain CSV (no Qualtrics header) with 3 raters scoring"
            " 60 essays 1-5; ICC(2,1) should land in the moderate range.",
            f"{len(missing_spec)} rating cells are blank (missing) — ICC must handle"
            " incomplete raters per essay.",
            "nominal_coding.csv has 2 raters coding essays into 4 unordered categories"
            f" for Cohen's kappa (achieved kappa {round(kappa, 3)}).",
        ],
    }
    (outdir / "ground_truth.json").write_text(json.dumps(gt, indent=2) + "\n")
    return gt


# ===========================================================================
# Dataset (i): mixed_design_large
# ===========================================================================
def gen_mixed_design_large(rng: np.random.Generator, outdir: Path):
    groups = ["Control", "Intervention A", "Intervention B"]
    n_per_group = 150
    keep_post = {"Control": 140, "Intervention A": 142, "Intervention B": 145}
    keep_fu = {"Control": 125, "Intervention A": 128, "Intervention B": 132}

    scale_ids = [f"Q3_{i}" for i in range(1, 9)]
    test_ids = [f"Q4_{i}" for i in range(1, 26)]
    item_difficulty = {iid: float(rng.uniform(-1, 1)) for iid in test_ids}

    scale_target = {
        "Control": {"pre": 3.0, "post": 3.0, "fu": 3.0},
        "Intervention A": {"pre": 3.0, "post": 3.4, "fu": 3.5},
        "Intervention B": {"pre": 3.0, "post": 4.0, "fu": 4.1},
    }
    test_target_p = {
        "Control": {"pre": 0.50, "post": 0.51, "fu": 0.50},
        "Intervention A": {"pre": 0.50, "post": 0.60, "fu": 0.58},
        "Intervention B": {"pre": 0.50, "post": 0.72, "fu": 0.68},
    }

    def make_id():
        letters = "".join(chr(65 + int(rng.integers(0, 26))) for _ in range(2))
        day = int(rng.integers(1, 29))
        return f"{letters}{day:02d}"

    total_n = n_per_group * 3
    all_ids, id_list = set(), []
    while len(all_ids) < total_n:
        cand = make_id()
        if cand not in all_ids:
            all_ids.add(cand)
            id_list.append(cand)
    id_iter = iter(id_list)
    group_ids = {g: [next(id_iter) for _ in range(n_per_group)] for g in groups}
    person_offset = {pid: rng.normal(0, 0.4) for g in groups for pid in group_ids[g]}

    retained = {}
    for g in groups:
        ids_g = group_ids[g]
        post_ids = list(rng.choice(ids_g, size=keep_post[g], replace=False))
        fu_ids = list(rng.choice(post_ids, size=keep_fu[g], replace=False))
        retained[g] = {"pre": ids_g, "post": post_ids, "fu": fu_ids}

    prefix_map = {"pre": "R_I_PRE_", "post": "R_I_POST_", "fu": "R_I_FU_"}
    tables = {}
    speeder_response_ids = []
    counter = 0
    for time_key in ["pre", "post", "fu"]:
        rows = []
        for g in groups:
            target_scale_mean = scale_target[g][time_key]
            target_p = test_target_p[g][time_key]
            theta_target = np.log(np.clip(target_p, 0.05, 0.95) / (1 - np.clip(target_p, 0.05, 0.95)))
            for pid in retained[g][time_key]:
                counter += 1
                d = metadata_row(rng, counter, f"{prefix_map[time_key]}{counter:05d}")
                d["Q1"] = pid
                d["Q2"] = g
                off = person_offset[pid]
                latent_scale = target_scale_mean + off + rng.normal(0, 0.3)
                for iid in scale_ids:
                    d[iid] = likert_round(latent_scale + rng.normal(0, 0.7))
                theta_i = theta_target + off + rng.normal(0, 0.4)
                n_correct = 0
                for iid in test_ids:
                    p = 1 / (1 + np.exp(-(theta_i - item_difficulty[iid])))
                    correct = rng.random() < p
                    d[iid] = int(correct)
                    n_correct += int(correct)
                d["SC0"] = n_correct
                if time_key == "post" and rng.random() < 0.04:
                    d["Duration (in seconds)"] = int(rng.integers(8, 59))
                    speeder_response_ids.append(d["ResponseId"])
                rows.append(d)
        rng.shuffle(rows)
        tables[time_key] = rows

    columns = METADATA_NAMES + ["Q1", "Q2"] + scale_ids + test_ids + ["SC0"]
    qtext = {"Q1": "Please enter your unique ID (first two initials + birth day, e.g. AB05)",
             "Q2": "Group"}
    qtext.update({iid: f"Scale item {i}: engagement statement"
                  for i, iid in enumerate(scale_ids, start=1)})
    qtext.update({iid: f"Test item {i} (correct=1, incorrect=0)"
                  for i, iid in enumerate(test_ids, start=1)})
    qtext["SC0"] = "Total correct (0-25)"

    for time_key, fname in [("pre", "pre.csv"), ("post", "post.csv"), ("fu", "followup.csv")]:
        table = build_qualtrics_matrix(columns, qtext, tables[time_key], three_header=True)
        save_csv(table, outdir / fname)

    n_total_per_time = {"pre": n_per_group * len(groups),
                         "post": sum(keep_post.values()), "fu": sum(keep_fu.values())}

    gt = {
        "dataset": "mixed_design_large",
        "id_column": "Q1",
        "group_column": "Q2",
        "groups": groups,
        "linked": True,
        "n_per_group_per_time": {
            g: {"pre": n_per_group, "post": keep_post[g], "followup": keep_fu[g]} for g in groups
        },
        "n_total_per_time": {"pre": n_total_per_time["pre"], "post": n_total_per_time["post"],
                              "followup": n_total_per_time["fu"]},
        "scale_items": scale_ids,
        "test_items": test_ids,
        "score_column": "SC0",
        "duration_column": "Duration (in seconds)",
        "speeder_threshold_seconds": 60,
        "n_speeders_post": len(speeder_response_ids),
        "speeder_response_ids_post": speeder_response_ids,
        "true_design": {
            "scale_mean_target_by_group_time": scale_target,
            "test_proportion_correct_target_by_group_time": test_target_p,
            "pattern": "group x time interaction: Intervention B improves most,"
                       " Intervention A improves moderately, Control stays flat.",
        },
        "gotchas": [
            "3 groups (Q2) x 3 time points (pre.csv/post.csv/followup.csv), linked by"
            " self-generated ID Q1 -> a genuine mixed (between x within) ANOVA design.",
            "Realistic dropout: fewer rows at post/followup than pre, per group"
            " (see n_per_group_per_time); followup respondents are a subset of post respondents.",
            "8-item engagement scale (Q3_1..Q3_8) and a 25-item test"
            " (Q4_1..Q4_25, item-level 0/1 with SC0 total).",
            "Planted group x time interaction: Intervention B improves most, Control is flat.",
            f"{len(speeder_response_ids)} post-timepoint rows have Duration (in seconds) < 60"
            " (speeders) for a row-filter demo.",
        ],
    }
    (outdir / "ground_truth.json").write_text(json.dumps(gt, indent=2) + "\n")
    return gt


# ===========================================================================
# Dataset (j): stress_test
# ===========================================================================
def gen_stress_test(rng: np.random.Generator, outdir: Path):
    n = 2000
    n_blocks = 14
    items_per_block = 20

    columns = METADATA_NAMES + ["Q2", "Q3"]
    for b in range(n_blocks):
        qid_base = 10 + b
        for item in range(1, items_per_block + 1):
            columns.append(f"Q{qid_base}_{item}")
    columns.append("Q99")
    assert len(columns) == 300, len(columns)

    qtext = {"Q2": "What is your gender?", "Q3": "What is your program?"}
    for b in range(n_blocks):
        qid_base = 10 + b
        for item in range(1, items_per_block + 1):
            qtext[f"Q{qid_base}_{item}"] = f"Block {b + 1} item {item}: matrix statement"
    qtext["Q99"] = "Any other comments? (open-ended)"

    rows = []
    genders = ["Male", "Female", "Nonbinary"]
    programs = ["Education", "Psychology", "Business"]
    for i in range(n):
        d = metadata_row(rng, i, f"R_J_{i:05d}")
        d["Q2"] = genders[int(rng.integers(0, 3))]
        d["Q3"] = programs[int(rng.integers(0, 3))]
        for b in range(n_blocks):
            qid_base = 10 + b
            for item in range(1, items_per_block + 1):
                d[f"Q{qid_base}_{item}"] = int(rng.integers(1, 6))
        d["Q99"] = f"Open text response {i}: sample comment about the course."
        rows.append(d)

    table = build_qualtrics_matrix(columns, qtext, rows, three_header=True)
    save_csv(table, outdir / "survey.csv")

    gt = {
        "dataset": "stress_test",
        "n_rows": n,
        "n_columns": len(columns),
        "header_rows": 3,
        "metadata_columns": len(METADATA_NAMES),
        "demographic_columns": ["Q2", "Q3"],
        "n_matrix_blocks": n_blocks,
        "items_per_block": items_per_block,
        "open_text_column": "Q99",
        "purpose": "performance testing only — shape matters, not planted effects.",
        "gotchas": [
            f"2,000 rows x 300 columns — import, Variable Interview, and matrix"
            f" auto-detection should stay responsive at this size.",
            f"{n_blocks} separate 20-item matrix blocks (Q10_1..Q23_20) for"
            " matrix-grouping/scale-suggestion performance.",
            "Q99 is a free-text open-ended column (qualitative module performance).",
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
    e, f, g, h, i, j = (all_gt["regression_predictors"], all_gt["categorical_outcomes"],
                         all_gt["scale_validation"], all_gt["rater_agreement"],
                         all_gt["mixed_design_large"], all_gt["stress_test"])
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
  (`Data`) holds the 3-row-header table. Written with `openpyxl`.

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

## e. regression_predictors/

**Purpose:** multiple/hierarchical regression and logistic regression practice
— one file, one cohort, continuous outcome plus a derived pass/fail outcome.

**Files:** `survey.csv` — 3-row Qualtrics header, {e['n']} undergraduates.

**Columns:** metadata + gender `Q2`, program `Q3` (3 levels), hours_studied
`Q4`, GPA `Q5`, pretest `Q6`, posttest `Q7`, motivation Likert `Q8_1..Q8_6`,
pass/fail `Q9`, minutes_studied `Q10`.

**Ground-truth design:** `{e['true_design']['model']}` with
intercept={e['true_design']['intercept']},
b_pretest={e['true_design']['b_pretest']},
b_hours={e['true_design']['b_hours']}, program effects
{e['true_design']['program_effect']}, residual SD={e['true_design']['residual_sd']}.

**Gotchas planted:**
- Q10 (minutes_studied) is near-collinear with Q4 (hours_studied), achieved
  r={e['collinear_pair']['achieved_correlation']} (VIF/multicollinearity demo).
- Two planted outliers (see `ground_truth.json['outliers']`): a residual
  outlier and a leverage outlier.
- Q5 (GPA) and the Q8 motivation items have missing cells.
- Q9 (pass/fail) is derived from posttest >= 60 (logistic regression outcome).

## f. categorical_outcomes/

**Purpose:** chi-square, Fisher's exact, McNemar, and Cochran's Q practice.

**Files:** `survey.csv` — 3-row Qualtrics header, {f['n']} respondents.

**Columns:** metadata + program `Q2`, pass/fail `Q3`, rare-event extra-credit
flag `Q4`, linked office-hours pre/post pair `Q5_pre`/`Q5_post`, three
repeated yes/no items `Q6_1..Q6_3`.

**Gotchas planted:**
- Q2 x Q3 is a 3x2 table with a planted association (pass rate rises
  Education < Psychology < Business).
- Q4 x Q3 is a sparse 2x2, achieved minimum expected count
  {f['sparse_2x2']['achieved_min_expected_count']} (< 5) — use Fisher's exact.
- Q5_pre/Q5_post is a linked yes/no pair (McNemar), with
  {f['mcnemar_pair']['discordant_no_to_yes']} No->Yes vs
  {f['mcnemar_pair']['discordant_yes_to_no']} Yes->No switches.
- Q6_1/Q6_2/Q6_3 are three repeated yes/no items (Cochran's Q) with rising
  endorsement.

## g. scale_validation/

**Purpose:** EFA/CFA and KR-20/item-analysis practice.

**Files:** `survey.csv` — 3-row Qualtrics header, {g['n']} respondents.

**Columns:** metadata + 15-item Likert matrix `Q4_1..Q4_15` + 20-item
right/wrong quiz `Q5_1..Q5_20` + `SC0` (quiz total).

**Ground-truth design:** 3 planted factors of 5 items each
({', '.join(g['likert_scale']['planted_factors'].keys())}), target loadings
0.6-0.8; {g['likert_scale']['cross_loading_item']} cross-loads on Factor1;
Q4_3 and Q4_9 are reverse-worded. Quiz: Q5_1/Q5_2 very easy, Q5_19/Q5_20 very
hard, {g['quiz']['negatively_discriminating_item']} negatively discriminating
(achieved item-total r
{g['quiz']['achieved_item_total_correlation'][g['quiz']['negatively_discriminating_item']]}).
Achieved KR-20 = {g['quiz']['achieved_kr20']}.

**Gotchas planted:**
- Q4_3 and Q4_9 must be reverse-scored before EFA/alpha.
- Q4_11 cross-loads — EFA suppression threshold should show it on 2 factors.
- The negatively-discriminating quiz item should be flagged by item analysis.

## h. rater_agreement/

**Purpose:** ICC and Cohen's kappa practice.

**Files:** `essay_ratings.csv` (plain CSV, {h['n_essays']} essays x 3 raters,
1-5 scale) + `nominal_coding.csv` (plain CSV, 2 raters x 4 unordered
categories).

**Ground-truth design:** essay ratings share a per-essay true-quality score
plus independent rater noise (SD 0.8) for moderate agreement (achieved
pairwise Pearson r: {h['essay_ratings']['achieved_pairwise_pearson_r']}).
Nominal coding: raters agree with probability
{h['nominal_coding']['target_agreement_rate']}, achieved Cohen's kappa
{h['nominal_coding']['achieved_cohens_kappa']}.

**Gotchas planted:**
- {h['essay_ratings']['n_missing_cells']} rating cells in `essay_ratings.csv`
  are blank — ICC must handle incomplete raters per essay.
- Both files are plain CSV, not Qualtrics exports.

## i. mixed_design_large/

**Purpose:** mixed (between x within) ANOVA at a realistic sample size, with
dropout and a row-filter (speeder) demo.

**Files:** `pre.csv`, `post.csv`, `followup.csv` (3-row Qualtrics header),
linked by self-generated ID `Q1`.

**Columns:** metadata + `Q1` (ID) + group `Q2` (3 levels) + 8-item scale
`Q3_1..Q3_8` + 25-item test `Q4_1..Q4_25` (item-level 0/1) + `SC0`.

**n per group/time (realistic dropout, followup subset of post):**
{json.dumps(i['n_per_group_per_time'], indent=2)}

**Gotchas planted:**
- Planted group x time interaction: Intervention B improves most,
  Intervention A improves moderately, Control stays flat.
- {i['n_speeders_post']} post-timepoint rows have `Duration (in seconds)` < 60
  (speeders) for a row-filter demo.
- Followup respondents are a subset of post respondents (real dropout, not
  independent resampling).

## j. stress_test/

**Purpose:** performance testing with a large, wide Qualtrics export.

**Files:** `survey.csv` — 3-row Qualtrics header, {j['n_rows']} respondents x
{j['n_columns']} columns.

**Columns:** 17 metadata + demographics `Q2`/`Q3` + {j['n_matrix_blocks']}
matrix blocks of {j['items_per_block']} items each + one open-text column
`Q99`.

**Note:** no planted statistical effects — this dataset exists to exercise
import, Variable Interview, and matrix auto-detection performance at scale.

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
    all_gt["regression_predictors"] = gen_regression_predictors(rng, HERE / "regression_predictors")
    all_gt["categorical_outcomes"] = gen_categorical_outcomes(rng, HERE / "categorical_outcomes")
    all_gt["scale_validation"] = gen_scale_validation(rng, HERE / "scale_validation")
    all_gt["rater_agreement"] = gen_rater_agreement(rng, HERE / "rater_agreement")
    all_gt["mixed_design_large"] = gen_mixed_design_large(rng, HERE / "mixed_design_large")
    all_gt["stress_test"] = gen_stress_test(rng, HERE / "stress_test")
    write_readme(all_gt, HERE / "README.md")
    print("Generated practice datasets:")
    for name in all_gt:
        print(f"  - {name}/")


if __name__ == "__main__":
    main()
