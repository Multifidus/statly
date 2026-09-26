"""Encoding / delimiter sniffing and XLSX sheet handling (SPEC §5.1)."""

from __future__ import annotations

import pytest

from statly_engine.data.readers import detect_encoding, read_file, sniff_delimiter
from statly_engine.errors import FileUnreadable

from ._helpers import MESSY

ROWS = "name,score\nAnna,1\nBjörn,2\n"


@pytest.mark.parametrize("encoding,expected", [
    ("utf-8", "utf-8"), ("utf-8-sig", "utf-8-sig"), ("utf-16", "utf-16"),
    ("utf-16-le", "utf-16-le"), ("utf-16-be", "utf-16-be"),
])
def test_detect_encoding(tmp_path, encoding, expected):
    data = ROWS.encode(encoding)
    assert detect_encoding(data) == expected
    p = tmp_path / "f.csv"
    p.write_bytes(data)
    r = read_file(str(p))
    assert r.grid.iloc[2, 0] == "Björn" and r.encoding == expected


def test_cp1252_fallback(tmp_path):
    p = tmp_path / "f.csv"
    p.write_bytes("name;note\nZoë;café – ok\n".encode("cp1252"))
    r = read_file(str(p))
    assert r.delimiter == ";" and r.grid.iloc[1, 1] == "café – ok"


@pytest.mark.parametrize("delim", [",", "\t", ";", "|"])
def test_sniff_delimiter(delim):
    text = "\n".join(delim.join(f'"{c}"' if "," in c else c for c in row)
                     for row in [["a", "b", "c"], ["1", "x, y", "3"], ["4", "5", "6"]])
    assert sniff_delimiter(text) == delim


def test_xlsx_sheet_choice():
    r = read_file(str(MESSY / "messy.xlsx"))
    assert r.sheets == ["Notes", "Data"] and r.sheet_name == "Data" and r.issues
    notes = read_file(str(MESSY / "messy.xlsx"), sheet_name="Notes")
    assert notes.grid.shape[1] == 1
    with pytest.raises(FileUnreadable):
        read_file(str(MESSY / "messy.xlsx"), sheet_name="Nope")


def test_unreadable_files(tmp_path):
    with pytest.raises(FileUnreadable):
        read_file(str(tmp_path / "missing.csv"))
    (tmp_path / "old.xls").write_bytes(b"\xd0\xcf\x11\xe0")
    with pytest.raises(FileUnreadable, match="xlsx"):
        read_file(str(tmp_path / "old.xls"))
    (tmp_path / "empty.csv").write_bytes(b"")
    with pytest.raises(FileUnreadable):
        read_file(str(tmp_path / "empty.csv"))


def test_ragged_rows_padded(tmp_path):
    p = tmp_path / "ragged.csv"
    p.write_text("a,b\n1,2\n3,4,5\n", encoding="utf-8")
    r = read_file(str(p))
    assert r.grid.shape == (3, 3) and r.grid.iloc[0, 2] == ""
    assert r.issues == []


def test_unclosed_quote_merged_rows_warns(tmp_path):
    p = tmp_path / "broken.csv"
    p.write_text('name,age\n"Alice,30\nBob,x\n', encoding="utf-8")
    r = read_file(str(p))
    assert r.grid.shape[0] < 3  # rows got merged
    assert len(r.issues) == 1
    issue = r.issues[0]
    assert issue["code"] == "unclosed_quote_merged_rows"
    assert issue["severity"] == "caution"
    assert "quote mark" in issue["message"]
    assert issue["column"] is None


def test_normal_csv_has_no_quote_issue(tmp_path):
    p = tmp_path / "clean.csv"
    p.write_text("name,age\nAlice,30\nBob,25\n", encoding="utf-8")
    r = read_file(str(p))
    assert r.issues == []
