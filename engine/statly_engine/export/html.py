"""APA table -> self-contained HTML fragment for the clipboard (SPEC §10.3), plus a tab-separated
plain-text fallback. Inline styles only (Word ignores <style> blocks on paste): Times New Roman 12pt,
horizontal rules only (top, below the column headers, bottom; a short rule under each spanning
column-group label), bold table number, italic title, notes below.
"""

from __future__ import annotations

from html import escape

from statly_engine.export import (align_of, cell_runs, group_header, note_paragraphs, plain, table_label)

FONT = "font-family:'Times New Roman',Times,serif;font-size:12pt;"
RULE = "1px solid #000"
CELL = "padding:2pt 6pt;vertical-align:top;"


def runs_html(runs: list[dict]) -> str:
    out = []
    for r in runs:
        s = escape(r.get("text", ""))
        if r.get("subscript"):
            s = f"<sub>{s}</sub>"
        if r.get("superscript"):
            s = f"<sup>{s}</sup>"
        if r.get("italic"):
            s = f"<i>{s}</i>"
        if r.get("bold"):
            s = f"<b>{s}</b>"
        out.append(s)
    return "".join(out)


def _td(tag: str, inner: str, align: str, extra: str = "", colspan: int = 1) -> str:
    span = f' colspan="{colspan}"' if colspan > 1 else ""
    return f'<{tag}{span} style="{FONT}{CELL}text-align:{align};{extra}">{inner}</{tag}>'


def table_html(table: dict, number: int | None = None) -> str:
    cols = table["columns"]
    aligns = [align_of(c) for c in cols]
    parts = [f'<div style="{FONT}color:#000;">',
             f'<p style="{FONT}margin:0 0 6pt 0;"><b>{escape(table_label(table, number))}</b></p>',
             f'<p style="{FONT}margin:0 0 6pt 0;"><i>{escape(table.get("title", ""))}</i></p>',
             f'<table style="{FONT}border-collapse:collapse;border:none;">', "<thead>"]
    groups = group_header(table)
    if groups:
        cells = []
        for runs, first, span in groups:
            rule = f"border-bottom:{RULE};" if runs else ""
            cells.append(_td("th", runs_html(runs), "center", f"font-weight:normal;border-top:{RULE};{rule}", span))
        parts.append("<tr>" + "".join(cells) + "</tr>")
    top = "" if groups else f"border-top:{RULE};"
    parts.append("<tr>" + "".join(
        _td("th", runs_html(c["header"]), "left" if i == 0 and aligns[i] == "left" else "center",
            f"font-weight:normal;{top}border-bottom:{RULE};") for i, c in enumerate(cols)) + "</tr>")
    parts.append("</thead><tbody>")
    rows = table.get("rows") or []
    for ri, row in enumerate(rows):
        last = ri == len(rows) - 1
        bottom = f"border-bottom:{RULE};" if last else ""
        cells = []
        for ci, cell in enumerate(row["cells"][:len(cols)]):
            pad = f"padding-left:{6 + 12 * row.get('indent', 0)}pt;" if ci == 0 and row.get("indent") else ""
            inner = runs_html(cell_runs(cell))
            if row.get("kind") == "section_header" and ci == 0:
                inner = f"<i>{inner}</i>" if inner else inner
            cells.append(_td("td", inner, aligns[ci], pad + bottom))
        parts.append("<tr>" + "".join(cells) + "</tr>")
    if not rows:
        parts.append("<tr>" + "".join(_td("td", "", "center", f"border-bottom:{RULE};") for _ in cols) + "</tr>")
    parts.append("</tbody></table>")
    for para in note_paragraphs(table):
        parts.append(f'<p style="{FONT}margin:6pt 0 0 0;">{runs_html(para)}</p>')
    parts.append("</div>")
    return "".join(parts)


def table_plain_text(table: dict, number: int | None = None) -> str:
    """Tab-separated fallback: label, title, (group row), header row, body rows, notes."""
    ncol = len(table["columns"])
    lines = [table_label(table, number), table.get("title", "")]
    groups = group_header(table)
    if groups:
        row = [""] * ncol
        for runs, first, _span in groups:
            row[first] = plain(runs)
        lines.append("\t".join(row))
    lines.append("\t".join(plain(c["header"]) for c in table["columns"]))
    for r in table.get("rows") or []:
        cells = [plain(cell_runs(c)) for c in r["cells"][:ncol]]
        if cells and r.get("indent"):
            cells[0] = "  " * r["indent"] + cells[0]
        lines.append("\t".join(cells))
    for para in note_paragraphs(table):
        lines.append(plain(para))
    return "\n".join(lines) + "\n"
