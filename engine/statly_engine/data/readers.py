"""File readers: CSV (encoding + delimiter sniffing) and XLSX (sheet listing).

Every reader returns a *grid*: a DataFrame of raw strings with integer column
labels, header rows included, "" for empty cells. Typing happens later
(`columns.py`), so CSV and XLSX share one code path and yield identical data.
"""

from __future__ import annotations

import csv
import datetime as _dt
import hashlib
import io
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from statly_engine.errors import FileUnreadable

CSV_EXTENSIONS = {".csv", ".tsv", ".txt", ".tab"}
XLSX_EXTENSIONS = {".xlsx", ".xlsm"}
DELIMITER_CANDIDATES = [",", "\t", ";", "|"]


@dataclass
class ReadResult:
    format: str  # "csv" | "xlsx"
    encoding: str | None
    delimiter: str | None
    sheets: list[str]
    sheet_name: str | None
    grid: pd.DataFrame  # raw strings, header rows included
    raw_bytes: bytes
    sha256: str
    issues: list[dict] = field(default_factory=list)


def read_bytes(path: str) -> bytes:
    try:
        return Path(path).read_bytes()
    except FileNotFoundError as exc:
        raise FileUnreadable(f"We couldn't find the file {path}.", path=path) from exc
    except OSError as exc:
        raise FileUnreadable(f"We couldn't open the file {path}: {exc.strerror}.", path=path) from exc


def detect_format(path: str, data: bytes) -> str:
    ext = Path(path).suffix.lower()
    if ext == ".xls":
        raise FileUnreadable(
            "This is an old-style Excel (.xls) file. Please re-save it as .xlsx or .csv and import that.",
            path=path,
        )
    if ext in XLSX_EXTENSIONS:
        return "xlsx"
    if ext in CSV_EXTENSIONS:
        return "csv"
    if data[:4] == b"PK\x03\x04":
        return "xlsx"
    return "csv"


# ---------------------------------------------------------------------------
# Encoding
# ---------------------------------------------------------------------------
def detect_encoding(data: bytes) -> str:
    """Best-guess text encoding. BOMs win; then BOM-less UTF-16; then UTF-8; then
    charset-normalizer on a bounded sample; cp1252 as the last resort."""
    if data.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"
    if data.startswith(b"\xff\xfe") or data.startswith(b"\xfe\xff"):
        return "utf-16"
    sample = data[:4096]
    if len(sample) >= 8:
        half = len(sample) // 2
        even_nul = sample[0::2].count(0)
        odd_nul = sample[1::2].count(0)
        if odd_nul > 0.3 * half and even_nul < 0.05 * half:
            return "utf-16-le"
        if even_nul > 0.3 * half and odd_nul < 0.05 * half:
            return "utf-16-be"
    try:
        data.decode("utf-8")
        return "utf-8"
    except UnicodeDecodeError:
        pass
    from charset_normalizer import from_bytes

    best = from_bytes(data[:200_000]).best()
    for enc in ([best.encoding] if best is not None else []) + ["cp1252", "latin-1"]:
        try:
            data.decode(enc)
            return enc
        except (UnicodeDecodeError, LookupError):
            continue
    return "latin-1"  # decodes any byte string


def decode(data: bytes, encoding: str, path: str) -> str:
    try:
        return data.decode(encoding)
    except (UnicodeDecodeError, LookupError) as exc:
        raise FileUnreadable(
            f"The file could not be read as {encoding} text. Try another encoding.",
            path=path,
            encoding=encoding,
        ) from exc


# ---------------------------------------------------------------------------
# Delimiter
# ---------------------------------------------------------------------------
def sniff_delimiter(text: str) -> str:
    """Pick the candidate delimiter giving the most consistent multi-column rows."""
    sample = text[:65536]
    cut = sample.rfind("\n")
    if cut > 0 and len(text) > len(sample):
        sample = sample[:cut]
    best, best_score = ",", (-1, -1)
    for delim in DELIMITER_CANDIDATES:
        try:
            rows = []
            for i, row in enumerate(csv.reader(io.StringIO(sample), delimiter=delim)):
                if row:
                    rows.append(row)
                if i >= 30:
                    break
        except csv.Error:
            continue
        if not rows or len(rows[0]) < 2:
            continue
        width = len(rows[0])
        consistent = sum(1 for r in rows if len(r) == width)
        score = (consistent, width)
        if score > best_score:
            best, best_score = delim, score
    return best


# ---------------------------------------------------------------------------
# CSV
# ---------------------------------------------------------------------------
def _grid_from_text(text: str, delimiter: str) -> pd.DataFrame:
    try:
        grid = pd.read_csv(
            io.StringIO(text),
            sep=delimiter,
            header=None,
            dtype=str,
            na_filter=False,
            keep_default_na=False,
            skip_blank_lines=True,
            engine="c",
        )
    except (pd.errors.ParserError, ValueError):
        # Ragged rows (more fields than the first line): fall back to the csv module.
        rows = [r for r in csv.reader(io.StringIO(text), delimiter=delimiter) if any(c != "" for c in r)]
        width = max((len(r) for r in rows), default=0)
        grid = pd.DataFrame([r + [""] * (width - len(r)) for r in rows], dtype=object)
    except pd.errors.EmptyDataError:
        return pd.DataFrame()
    grid = grid.fillna("")
    grid.columns = range(grid.shape[1])
    return grid


def read_csv(path: str, data: bytes, encoding: str | None, delimiter: str | None) -> ReadResult:
    enc = encoding or detect_encoding(data)
    text = decode(data, enc, path)
    if text.startswith("﻿"):  # BOM left by an explicit non-sig encoding choice
        text = text[1:]
    delim = delimiter or sniff_delimiter(text)
    grid = _grid_from_text(text, delim)
    return ReadResult(
        format="csv",
        encoding=enc,
        delimiter=delim,
        sheets=[],
        sheet_name=None,
        grid=grid,
        raw_bytes=data,
        sha256=hashlib.sha256(data).hexdigest(),
    )


# ---------------------------------------------------------------------------
# XLSX
# ---------------------------------------------------------------------------
def _cell_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "True" if value else "False"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, _dt.datetime):
        if value.time() == _dt.time(0, 0) and value.tzinfo is None:
            return value.date().isoformat()
        return value.isoformat(sep=" ")
    if isinstance(value, (_dt.date, _dt.time)):
        return value.isoformat()
    return str(value)


def _sheet_rows(ws) -> list[list[str]]:
    rows = [[_cell_text(v) for v in row] for row in ws.iter_rows(values_only=True)]
    while rows and not any(rows[-1]):
        rows.pop()
    rows = [r for r in rows if any(r)]
    width = 0
    for r in rows:
        for j in range(len(r) - 1, -1, -1):
            if r[j] != "":
                width = max(width, j + 1)
                break
    return [(r + [""] * (width - len(r)))[:width] for r in rows]


def read_xlsx(path: str, data: bytes, sheet_name: str | None) -> ReadResult:
    import openpyxl

    try:
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception as exc:  # noqa: BLE001 - openpyxl raises many types for corrupt files
        raise FileUnreadable(
            "This Excel file could not be opened. It may be damaged or password-protected.",
            path=path,
        ) from exc
    try:
        sheets = list(wb.sheetnames)
        issues: list[dict] = []
        if sheet_name is not None:
            if sheet_name not in sheets:
                raise FileUnreadable(f"The workbook has no sheet named '{sheet_name}'.", path=path, sheets=sheets)
            chosen, rows = sheet_name, _sheet_rows(wb[sheet_name])
        else:
            # No sheet chosen: pick the sheet holding the most cells (a notes/instructions
            # sheet usually comes first) and tell the user so they can switch.
            chosen, rows, best = sheets[0], [], -1
            for name in sheets:
                r = _sheet_rows(wb[name])
                size = sum(1 for row in r for c in row if c != "")
                if size > best:
                    chosen, rows, best = name, r, size
            if len(sheets) > 1:
                issues.append({
                    "code": "sheet_auto_selected",
                    "severity": "info",
                    "message": (
                        f"This workbook has {len(sheets)} sheets. We picked '{chosen}' because it "
                        "holds the most data; choose another sheet if that's not right."
                    ),
                    "column": None,
                })
    finally:
        wb.close()
    grid = pd.DataFrame(rows, dtype=object) if rows else pd.DataFrame()
    grid.columns = range(grid.shape[1])
    return ReadResult(
        format="xlsx",
        encoding=None,
        delimiter=None,
        sheets=sheets,
        sheet_name=chosen,
        grid=grid,
        raw_bytes=data,
        sha256=hashlib.sha256(data).hexdigest(),
        issues=issues,
    )


def read_file(path: str, *, sheet_name: str | None = None, encoding: str | None = None,
              delimiter: str | None = None) -> ReadResult:
    data = read_bytes(path)
    fmt = detect_format(path, data)
    result = read_xlsx(path, data, sheet_name) if fmt == "xlsx" else read_csv(path, data, encoding, delimiter)
    if result.grid.shape[0] == 0 or result.grid.shape[1] == 0:
        raise FileUnreadable("The file is empty: we didn't find any rows to import.", path=path)
    return result
