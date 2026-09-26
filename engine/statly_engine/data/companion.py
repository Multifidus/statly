"""Companion-labels pairs: the same responses exported twice, once as numbers and once as text.

Qualtrics lets a researcher download "numeric values" and "choice text" exports of one survey.
Given both, Statly keeps the numeric file as the data and uses the text file only to label each
numeric code (Q5_1: 1 = "Strongly disagree", ...). Detection is deliberately strict so two
waves of a survey are never mistaken for a pair:

- identical column names (after Qualtrics header handling) and row counts;
- identical ResponseId sets (rows aligned by ResponseId), or, without a ResponseId column,
  rows aligned by position;
- every column that differs between the files is numeric codes in one file and answer text
  in the other, always in the same direction, and at least one such column exists.

Functions take any object with `file_id`, `name` and `data` (raw-string DataFrame), so this
module does not import the importer.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

import pandas as pd

from statly_engine.data.columns import parse_numbers

ID_COLUMN = "ResponseId"


@dataclass
class CompanionMatch:
    values: object          # staged file with numeric codes
    labels: object          # staged file with answer text
    columns: list[str]      # columns that are numbers in `values` and text in `labels`
    order: list[int] = field(default_factory=list)  # labels row index for each values row


def _clean(s: pd.Series) -> pd.Series:
    return s.astype(object).where(s.notna(), "").map(lambda x: str(x).strip())


def _codes_like(vals: pd.Series) -> bool:
    """Every non-empty cell is a number, or a comma list of numbers (Qualtrics multi-select)."""
    ne = vals[vals != ""]
    if ne.empty:
        return True
    if parse_numbers(ne).notna().all():
        return True
    return ne.map(lambda t: all(p.strip() and not pd.isna(parse_numbers(pd.Series([p.strip()])).iloc[0])
                                for p in t.split(","))).all()


def _has_text(vals: pd.Series) -> bool:
    ne = vals[vals != ""]
    return bool(len(ne)) and parse_numbers(ne).isna().any()


def _alignment(a: pd.DataFrame, b: pd.DataFrame) -> list[int] | None:
    """Row index into `b` for each row of `a`, or None when the rows are not the same responses."""
    if ID_COLUMN not in a.columns:
        return list(range(len(a)))
    ia, ib = _clean(a[ID_COLUMN]), _clean(b[ID_COLUMN])
    if (ia == "").any() or (ib == "").any() or ia.duplicated().any() or ib.duplicated().any():
        return None
    if set(ia) != set(ib):
        return None
    pos = {v: i for i, v in enumerate(ib)}
    return [pos[v] for v in ia]


def match(a, b) -> CompanionMatch | None:
    """A CompanionMatch when `a` and `b` are one set of responses exported as codes and as text."""
    da, db = a.data, b.data
    if list(da.columns) != list(db.columns) or len(da) != len(db) or len(da) == 0:
        return None
    order = _alignment(da, db)
    if order is None:
        return None
    a_to_b, b_to_a = [], []
    for col in da.columns:
        va = _clean(da[col]).reset_index(drop=True)
        vb = _clean(db[col]).iloc[order].reset_index(drop=True)
        if (va == vb).all():
            continue
        if _codes_like(va) and _has_text(vb):
            a_to_b.append(col)
        elif _codes_like(vb) and _has_text(va):
            b_to_a.append(col)
        else:
            return None  # a column differs in some other way: different responses
    if a_to_b and not b_to_a:
        return CompanionMatch(values=a, labels=b, columns=a_to_b, order=order)
    if b_to_a and not a_to_b:
        inverse = [0] * len(order)
        for i, j in enumerate(order):
            inverse[j] = i
        return CompanionMatch(values=b, labels=a, columns=b_to_a, order=inverse)
    return None


def find(files: list) -> CompanionMatch | None:
    """First companion pair among `files` (checked pairwise, in order)."""
    for i in range(len(files)):
        for j in range(i + 1, len(files)):
            m = match(files[i], files[j])
            if m is not None:
                return m
    return None


def _num(text: str) -> float | None:
    v = parse_numbers(pd.Series([text])).iloc[0]
    return None if pd.isna(v) else float(v)


def pair_labels(m: CompanionMatch, proposals: dict[str, dict]) -> tuple[dict[str, list[dict]], list[tuple[str, str]]]:
    """Value labels per column from the row-by-row pairing of codes and text.

    Returns ({column: value_labels}, [(column, reason)] for columns left unlabelled). Cells that
    hold the same number in both files (e.g. -99) and the variable's missing codes are skipped."""
    labels_by_col: dict[str, list[dict]] = {}
    problems: list[tuple[str, str]] = []
    for col in m.columns:
        v = proposals.get(col)
        if v is None or v["dtype"] != "integer":
            continue  # multi-select code lists, decimals, dropped columns: no labels
        codes = _clean(m.values.data[col]).reset_index(drop=True)
        texts = _clean(m.labels.data[col]).iloc[m.order].reset_index(drop=True)
        missing = {float(c) for c in v["missing_codes"] if isinstance(c, (int, float))}
        per_code: dict[int, Counter] = {}
        per_text: dict[str, set[int]] = {}
        for c, t in zip(codes, texts):
            if not c or not t:
                continue
            code = _num(c)
            if code is None or code in missing or code != int(code):
                continue
            if _num(t) == code:
                continue
            per_code.setdefault(int(code), Counter())[t] += 1
            per_text.setdefault(t.casefold(), set()).add(int(code))
        if not per_code:
            continue
        split_code = next((c for c, cnt in sorted(per_code.items()) if len(cnt) > 1), None)
        if split_code is not None:
            shown = ", ".join(f'"{t}"' for t, _ in per_code[split_code].most_common(3))
            problems.append((col, f"the number {split_code} appears with different answers ({shown})"))
            continue
        shared = next((t for t, cs in per_text.items() if len(cs) > 1), None)
        if shared is not None:
            nums = ", ".join(str(c) for c in sorted(per_text[shared]))
            problems.append((col, f"the same answer appears with different numbers ({nums})"))
            continue
        labels_by_col[col] = [{"value": c, "label": cnt.most_common(1)[0][0]} for c, cnt in sorted(per_code.items())]
    return labels_by_col, problems


def apply_labels(proposals: dict[str, dict], labels_by_col: dict[str, list[dict]]) -> None:
    """Attach paired labels to the values file's proposed variables (in place)."""
    for col, labels in labels_by_col.items():
        v = proposals[col]
        codes = [lbl["value"] for lbl in labels]
        v["value_labels"] = [dict(lbl) for lbl in labels]
        if codes == list(range(1, len(codes) + 1)):
            v["level"] = "ordinal"
            v["response_range"] = {"min": 1, "max": len(codes)}
