"""Cleaned/scored dataset export (SPEC §10.3): the current snapshot as XLSX or CSV.

- Columns follow Variables-screen order (display_order); the internal row id is never written.
- include_metadata_columns=false drops Qualtrics metadata/timing columns (is_metadata).
- options.label_row adds variable labels (falling back to the name) as a second header row.
- options.blank_missing_codes (default true) writes user-declared missing codes (e.g. -99) as empty
  cells, matching how every analysis treats them; the codebook lists the codes.
- options.exclude_pii (default false) drops columns flagged as personally identifying; the result
  always lists the PII columns written so the app can warn before sharing.
- CSV is UTF-8 with a BOM (Excel opens it without mangling accents), comma separated.
"""

from __future__ import annotations

import csv
import datetime as _dt
import math

import pandas as pd

from statly_engine.data.missing import coded_mask
from statly_engine.export import xlsx_value


def select_variables(meta: dict, include_metadata: bool, exclude_pii: bool) -> list[dict]:
    out = []
    for v in sorted(meta["variables"], key=lambda x: x["display_order"]):
        if v.get("is_metadata") and not include_metadata:
            continue
        if v.get("is_pii") and exclude_pii:
            continue
        out.append(v)
    return out


def _cell(x):
    if x is None or x is pd.NA or x is pd.NaT:
        return None
    if isinstance(x, float) and math.isnan(x):
        return None
    if isinstance(x, pd.Timestamp):
        return x.to_pydatetime()
    if hasattr(x, "item") and not isinstance(x, (str, bytes)):
        try:
            return x.item()
        except (ValueError, AttributeError):
            return x
    return x


def columns(df: pd.DataFrame, variables: list[dict], blank_missing_codes: bool) -> list[list]:
    cols = []
    for v in variables:
        col = df[v["name"]]
        vals = [_cell(x) for x in col.tolist()]
        if blank_missing_codes and v.get("missing_codes"):
            mask = coded_mask(col, v["missing_codes"]).to_numpy(dtype=bool)
            vals = [None if m else x for x, m in zip(vals, mask)]
        cols.append(vals)
    return cols


def _csv_text(x) -> str:
    if x is None:
        return ""
    if isinstance(x, bool):
        return "TRUE" if x else "FALSE"
    if isinstance(x, float) and x.is_integer() and abs(x) < 1e15:
        return str(int(x))
    if isinstance(x, (_dt.datetime, _dt.date)):
        return x.isoformat(sep=" ") if isinstance(x, _dt.datetime) else x.isoformat()
    return str(x)


def write(path: str, fmt: str, df: pd.DataFrame, variables: list[dict], label_row: bool,
          blank_missing_codes: bool) -> None:
    names = [v["name"] for v in variables]
    labels = [v.get("label") or v["name"] for v in variables]
    cols = columns(df, variables, blank_missing_codes)
    n = len(df)
    if fmt == "csv":
        with open(path, "w", encoding="utf-8-sig", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(names)
            if label_row:
                w.writerow(labels)
            for i in range(n):
                w.writerow([_csv_text(c[i]) for c in cols])
        return
    from openpyxl import Workbook
    from openpyxl.cell import WriteOnlyCell
    from openpyxl.styles import Font

    wb = Workbook(write_only=True)
    ws = wb.create_sheet("Data")
    ws.freeze_panes = "A3" if label_row else "A2"
    bold, ital = Font(bold=True), Font(italic=True)

    def styled(values, font):
        out = []
        for val in values:
            c = WriteOnlyCell(ws, value=val)
            c.font = font
            out.append(c)
        return out

    ws.append(styled(names, bold))
    if label_row:
        ws.append(styled(labels, ital))
    for i in range(n):
        ws.append([xlsx_value(ws, c[i]) for c in cols])
    wb.save(path)

