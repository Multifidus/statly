"""Qualtrics-export detection and column heuristics (SPEC §5.2, §12).

Pure functions over raw-string grids/columns. The heuristics that also make sense
for plain CSV/XLSX (PII by value, choice-text response sets, multi-select, open
text, missing-code sentinels) take no Qualtrics-only inputs and are applied to
every file by the importer.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

import pandas as pd

from statly_engine.data.columns import nonempty_values, parse_numbers, split_tokens

METADATA_COLUMNS = [
    "StartDate", "EndDate", "Status", "IPAddress", "Progress", "Duration (in seconds)",
    "Finished", "RecordedDate", "ResponseId", "RecipientLastName", "RecipientFirstName",
    "RecipientEmail", "ExternalReference", "LocationLatitude", "LocationLongitude",
    "DistributionChannel", "UserLanguage",
]
_SIGNATURE = {"StartDate", "EndDate", "Status", "Progress", "Duration (in seconds)", "Finished",
              "RecordedDate", "ResponseId"}
TIMING_SUFFIXES = ("_First Click", "_Last Click", "_Page Submit", "_Click Count")
IMPORT_ID_RE = re.compile(r'^\{\s*"ImportId"\s*:\s*"([^"]*)"')
TEXT_SUFFIX_RE = re.compile(r"_TEXT$", re.IGNORECASE)
SCORE_RE = re.compile(r"^SC\d+$")
MATRIX_RE = re.compile(r"^(.+?)_(\d+)$")

# Structural PII by exact Qualtrics column name (flagged when the column has any value).
PII_BY_NAME = {
    "IPAddress": ("ip_address", "IP addresses can identify a respondent's device or location."),
    "RecipientLastName": ("name", "Respondent names directly identify people."),
    "RecipientFirstName": ("name", "Respondent names directly identify people."),
    "RecipientEmail": ("email", "Email addresses directly identify people."),
    "LocationLatitude": ("location", "Location coordinates can pinpoint where a respondent was."),
    "LocationLongitude": ("location", "Location coordinates can pinpoint where a respondent was."),
    "ExternalReference": ("external_reference",
                          "External references often hold student or employee IDs that identify people."),
}
# Generic column names (plain CSV/XLSX), compared case-insensitively.
PII_GENERIC_NAMES = {
    "email": "email", "e-mail": "email", "email address": "email",
    "name": "name", "first name": "name", "last name": "name", "firstname": "name",
    "lastname": "name", "full name": "name", "student name": "name",
    "ip": "ip_address", "ip address": "ip_address",
    "latitude": "location", "longitude": "location",
}
EMAIL_FULL_RE = r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$"
EMAIL_ANY_RE = r"[^@\s]+@[^@\s]+\.[A-Za-z]{2,}"
NAME_RE = r"^[A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+){1,3}$"
IPV4_RE = r"^\d{1,3}(?:\.\d{1,3}){3}$"

# Ordered response sets; each position lists accepted spellings (first = canonical).
RESPONSE_SETS: list[tuple[str, list[list[str]]]] = [
    ("agreement_4", [["Strongly disagree"], ["Disagree"], ["Agree"], ["Strongly agree"]]),
    ("agreement_5", [["Strongly disagree"], ["Disagree", "Somewhat disagree"],
                     ["Neither agree nor disagree", "Neutral", "Undecided"],
                     ["Agree", "Somewhat agree"], ["Strongly agree"]]),
    ("agreement_7", [["Strongly disagree"], ["Disagree"], ["Somewhat disagree"],
                     ["Neither agree nor disagree", "Neutral"], ["Somewhat agree"], ["Agree"],
                     ["Strongly agree"]]),
    ("satisfaction_5", [["Very dissatisfied", "Extremely dissatisfied"],
                        ["Dissatisfied", "Somewhat dissatisfied"],
                        ["Neither satisfied nor dissatisfied", "Neutral"],
                        ["Satisfied", "Somewhat satisfied"], ["Very satisfied", "Extremely satisfied"]]),
    ("frequency_5", [["Never"], ["Rarely"], ["Sometimes"], ["Often", "Most of the time"], ["Always"]]),
    ("likelihood_5", [["Extremely unlikely", "Very unlikely"], ["Somewhat unlikely", "Unlikely"],
                      ["Neither likely nor unlikely", "Neutral"], ["Somewhat likely", "Likely"],
                      ["Extremely likely", "Very likely"]]),
    ("quality_5", [["Poor", "Very poor"], ["Fair"], ["Good"], ["Very good"], ["Excellent"]]),
    ("importance_5", [["Not at all important"], ["Slightly important"], ["Moderately important"],
                      ["Very important"], ["Extremely important"]]),
]

STATUS_EXCLUDE_TEXT = ["Survey Preview", "Survey Test", "Spam"]
STATUS_EXCLUDE_CODES = [1.0, 2.0, 8.0]


# ---------------------------------------------------------------------------
# Header rows
# ---------------------------------------------------------------------------
def detect_header_rows(grid: pd.DataFrame, mode: str) -> tuple[bool, int]:
    """Returns (qualtrics_detected, header_rows_to_consume) for mode auto|on|off."""
    row0 = [str(v).strip() for v in grid.iloc[0].tolist()] if len(grid) else []
    has_signature = len(set(row0) & _SIGNATURE) >= 3
    has_import_ids = False
    if len(grid) >= 3:
        cells = [str(v).strip() for v in grid.iloc[2].tolist() if str(v).strip()]
        has_import_ids = bool(cells) and sum(bool(IMPORT_ID_RE.match(c)) for c in cells) >= 0.8 * len(cells)
    detected = has_signature or has_import_ids
    if mode == "off" or (mode == "auto" and not detected):
        return detected, 1
    if has_import_ids:
        return detected, 3
    return detected, min(2, len(grid))


@dataclass
class HeaderInfo:
    names: list[str]              # unique variable names (row 1)
    original_names: list[str]     # row-1 text as in the file
    question_texts: list[str | None]
    import_ids: list[str | None]
    header_texts: list[list[str]]


def split_header(grid: pd.DataFrame, header_rows: int) -> tuple[HeaderInfo, pd.DataFrame]:
    header = [[str(v) for v in grid.iloc[r].tolist()] for r in range(min(header_rows, len(grid)))]
    data = grid.iloc[header_rows:].reset_index(drop=True)
    width = grid.shape[1]
    names, original, qtexts, import_ids, htexts = [], [], [], [], []
    seen: set[str] = set()
    for j in range(width):
        raw_name = header[0][j].strip() if header else ""
        base = raw_name or f"V{j + 1}"
        if base == "_statly_row_id":
            base = "statly_row_id_column"
        name, k = base, 2
        while name in seen:
            name, k = f"{base}_{k}", k + 1
        seen.add(name)
        names.append(name)
        original.append(header[0][j] if header else name)
        qtexts.append(header[1][j] if header_rows >= 2 and len(header) >= 2 else None)
        imp = None
        if header_rows >= 3 and len(header) >= 3:
            m = IMPORT_ID_RE.match(header[2][j].strip())
            if m:
                imp = m.group(1)
            else:
                try:
                    imp = json.loads(header[2][j]).get("ImportId")
                except (ValueError, AttributeError):
                    imp = None
        import_ids.append(imp)
        htexts.append([h[j] for h in header])
    data.columns = names
    return HeaderInfo(names, original, qtexts, import_ids, htexts), data


# ---------------------------------------------------------------------------
# Column classification
# ---------------------------------------------------------------------------
def is_metadata_name(name: str) -> bool:
    return name in METADATA_COLUMNS


def is_timing_name(name: str) -> bool:
    return name.endswith(TIMING_SUFFIXES)


def is_text_entry_name(name: str) -> bool:
    return bool(TEXT_SUFFIX_RE.search(name))


def is_score_name(name: str) -> bool:
    return bool(SCORE_RE.match(name))


def matrix_groups(names: list[str], excluded: set[str]) -> dict[str, list[str]]:
    """Group Q5_1, Q5_2, ... by prefix (>= 2 members), keeping file order."""
    groups: dict[str, list[str]] = {}
    for n in names:
        if n in excluded:
            continue
        m = MATRIX_RE.match(n)
        if m:
            groups.setdefault(m.group(1), []).append(n)
    return {k: v for k, v in groups.items() if len(v) >= 2}


def detect_pii(name: str, raw: pd.Series, qualtrics: bool) -> dict | None:
    """PiiReason dict or None. Exact names first, then value heuristics."""
    vals = nonempty_values(raw)
    if qualtrics and name in PII_BY_NAME:
        if vals.empty:
            return None
        kind, why = PII_BY_NAME[name]
        return {"kind": kind, "explanation": why + " Consider dropping it (FERPA/IRB)."}
    generic = PII_GENERIC_NAMES.get(name.strip().casefold())
    if generic and not vals.empty:
        return {"kind": generic,
                "explanation": f"The column name suggests it holds {generic.replace('_', ' ')} data, "
                               "which can identify people. Consider dropping it (FERPA/IRB)."}
    if vals.empty:
        return None
    n = len(vals)
    if vals.str.match(EMAIL_FULL_RE).sum() >= 0.5 * n:
        return {"kind": "value_pattern",
                "explanation": "Most values look like email addresses, which identify people. "
                               "Consider dropping this column (FERPA/IRB)."}
    if vals.str.match(IPV4_RE).sum() >= 0.7 * n:
        return {"kind": "value_pattern",
                "explanation": "Most values look like IP addresses, which can identify a device or location."}
    if n >= 5 and vals.str.match(NAME_RE).sum() >= 0.7 * n and vals.nunique() >= 0.5 * n:
        return {"kind": "value_pattern",
                "explanation": "Most values look like people's names (two or more capitalized words). "
                               "Consider dropping this column (FERPA/IRB)."}
    return None


def has_embedded_email(raw: pd.Series) -> bool:
    vals = nonempty_values(raw)
    return not vals.empty and vals.str.contains(EMAIL_ANY_RE, regex=True).sum() >= 0.2 * len(vals)


def detect_response_set(raw: pd.Series) -> tuple[str, list[dict], list[float]] | None:
    """Text answers matching a known ordered response set.

    Returns (set_id, value_labels coded 1..k, sentinel missing codes found) or None.
    Numeric-looking cells are allowed only as missing-code sentinels (e.g. -99)."""
    vals = nonempty_values(raw)
    if vals.empty:
        return None
    num = parse_numbers(vals)
    numeric = vals[num.notna()]
    text = vals[num.isna()]
    if text.empty:
        return None
    sentinels = sorted({float(x) for x in parse_numbers(numeric)})
    if any(s not in (-9.0, -99.0, -999.0, -9999.0) for s in sentinels):
        return None
    observed = {}
    for t in text.unique():
        observed.setdefault(t.strip().casefold(), t.strip())
    best = None
    for set_id, positions in RESPONSE_SETS:
        lookup = {}
        for i, spellings in enumerate(positions):
            for sp in spellings:
                lookup[sp.casefold()] = i
        pos_of = {k: lookup.get(k) for k in observed}
        if any(p is None for p in pos_of.values()):
            continue
        if len(set(pos_of.values())) != len(pos_of):  # two spellings on one position
            continue
        coverage = len(pos_of) / len(positions)
        if best is None or coverage > best[0]:
            best = (coverage, set_id, positions, pos_of)
    if best is None:
        return None
    _, set_id, positions, pos_of = best
    by_pos = {p: observed[k] for k, p in pos_of.items()}
    labels = [{"value": i + 1, "label": by_pos.get(i, spellings[0])} for i, spellings in enumerate(positions)]
    return set_id, labels, sentinels


def detect_multiselect(raw: pd.Series, question_text: str | None) -> list[str] | None:
    """Comma-separated 'select all that apply' answers -> option list (first-seen order)."""
    vals = nonempty_values(raw)
    if len(vals) < 3 or vals.str.contains("\n").any():
        return None
    hinted = bool(question_text and re.search(r"select all|check all|all that apply", question_text, re.I))
    with_comma = vals.str.contains(",").mean()
    if with_comma < 0.2 and not hinted:
        return None
    options: dict[str, str] = {}
    for v in vals.unique():
        for t in split_tokens(v):
            options.setdefault(t.casefold(), t)
    if not 2 <= len(options) <= 40:
        return None
    if sum(len(o) for o in options.values()) / len(options) > 40:
        return None
    if not hinted and vals.nunique() < len(options):
        return None  # a repeated sentence with commas, not combinations of options
    return list(options.values())


def looks_open_text(raw: pd.Series) -> bool:
    vals = nonempty_values(raw)
    if vals.empty:
        return False
    words = vals.str.split().str.len()
    return bool((words >= 4).mean() >= 0.5 or vals.str.len().mean() >= 30)


def suggest_row_filters(data: pd.DataFrame, file_id: str) -> list[dict]:
    """Status / Finished / Progress filters with plain-language explanations.
    rows_removed = rows each filter WOULD remove on its own."""
    filters = []
    if "Status" in data.columns:
        status = data["Status"].astype(str).str.strip()
        num = parse_numbers(status[status != ""])
        if len(num) and num.notna().all():
            values: list = STATUS_EXCLUDE_CODES
            removed = int(parse_numbers(status).isin(values).sum())
            shown = "codes 1 (preview), 2 (test) and 8 (spam)"
        else:
            values = STATUS_EXCLUDE_TEXT
            removed = int(status.str.casefold().isin([v.casefold() for v in values]).sum())
            shown = "'Survey Preview', 'Survey Test' and 'Spam'"
        filters.append({
            "id": f"{file_id}_status", "kind": "exclude_values", "file_id": file_id, "variable": "Status",
            "values": values, "threshold": None, "rows_removed": removed,
            "explanation": (f"Removes rows whose Status is {shown}. These are responses you made while "
                            "previewing or testing the survey, or that Qualtrics marked as spam, so they are "
                            "not real participants. Recommended."),
        })
    if "Finished" in data.columns:
        fin = data["Finished"].astype(str).str.strip().str.casefold()
        filters.append({
            "id": f"{file_id}_unfinished", "kind": "exclude_unfinished", "file_id": file_id,
            "variable": "Finished", "values": None, "threshold": None,
            "rows_removed": int(fin.isin(["false", "0"]).sum()),
            "explanation": ("Removes responses that were not finished. Optional: partial responses still "
                            "contain usable answers, but some researchers exclude them."),
        })
    if "Progress" in data.columns:
        prog = parse_numbers(data["Progress"].astype(str).str.strip())
        filters.append({
            "id": f"{file_id}_progress", "kind": "progress_below", "file_id": file_id,
            "variable": "Progress", "values": None, "threshold": 100.0,
            "rows_removed": int((prog < 100).sum()),
            "explanation": ("Removes responses whose Progress is below the threshold you choose "
                            "(percent of the survey completed). Optional; adjust the threshold as needed."),
        })
    return filters


def row_filter_mask(data: pd.DataFrame, flt: dict) -> pd.Series:
    """True where the filter removes the row. Missing variable -> removes nothing."""
    var = flt.get("variable")
    if var is None or var not in data.columns:
        return pd.Series(False, index=data.index)
    col = data[var].astype(str).str.strip()
    kind = flt["kind"]
    if kind == "exclude_values":
        values = flt.get("values") or []
        text_vals = {str(v).casefold() for v in values if isinstance(v, str)}
        num_vals = {float(v) for v in values if not isinstance(v, str)}
        mask = col.str.casefold().isin(text_vals)
        if num_vals:
            mask |= parse_numbers(col).isin(num_vals)
        return mask
    if kind == "exclude_unfinished":
        return col.str.casefold().isin(["false", "0"])
    if kind == "progress_below":
        return parse_numbers(col) < float(flt.get("threshold") or 0)
    return pd.Series(False, index=data.index)
