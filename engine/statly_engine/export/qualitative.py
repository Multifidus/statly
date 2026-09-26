"""Qualitative exports (SPEC §11.1): coded responses and the tag codebook as XLSX or DOCX.

- Coded responses XLSX: sheet "Coded responses" (row id, context variables, response, tag names,
  one 1/0 column per tag), sheet "Codebook", sheet "Summary" (counts and percentages per tag).
- Coded responses DOCX: responses grouped under a heading per tag, then the untagged ones.
- Codebook XLSX/DOCX: tag name, definition, color, number and percent of responses tagged.
"""

from __future__ import annotations

from statly_engine.export import run


def _cell(x) -> object:
    if isinstance(x, float) and x.is_integer():
        return int(x)
    return x


def _pct(k: int, n: int) -> str:
    return f"{100.0 * k / n:.1f}%" if n else "—"


def _tag_counts(book: dict, items: list[dict]) -> dict[str, int]:
    return {t["id"]: sum(1 for it in items if t["id"] in it["tag_ids"]) for t in book["tags"]}


CODEBOOK_HEADERS = ["Tag", "Definition", "Color", "Responses tagged", "Percent of responses"]


def codebook_rows(book: dict, items: list[dict]) -> list[list]:
    counts = _tag_counts(book, items)
    n = len(items)
    return [[t["name"], t["definition"], t["color"], counts[t["id"]], _pct(counts[t["id"]], n)]
            for t in book["tags"]]


def response_table(book: dict, items: list[dict], context: list[str]) -> tuple[list[str], list[list]]:
    names = {t["id"]: t["name"] for t in book["tags"]}
    headers = ["Row ID", *context, "Response", "Tags", *[t["name"] for t in book["tags"]]]
    rows = []
    for it in items:
        rows.append([it["row_id"], *[_cell(it["context"].get(c)) for c in context], it["text"],
                     ", ".join(names[t] for t in it["tag_ids"] if t in names),
                     *[1 if t["id"] in it["tag_ids"] else 0 for t in book["tags"]]])
    return headers, rows


def write_responses_xlsx(path: str, variable: str, book: dict, items: list[dict], context: list[str]) -> None:
    from statly_engine.export import write_xlsx_sheets

    headers, rows = response_table(book, items, context)
    n = len(items)
    coded = sum(1 for it in items if it["tag_ids"])
    summary = [["All responses", n, "100.0%" if n else "—"], ["Tagged with at least one tag", coded, _pct(coded, n)],
               ["Not tagged yet", n - coded, _pct(n - coded, n)]]
    counts = _tag_counts(book, items)
    summary += [[t["name"], counts[t["id"]], _pct(counts[t["id"]], n)] for t in book["tags"]]
    write_xlsx_sheets(path, [
        ("Coded responses", headers, rows),
        ("Codebook", CODEBOOK_HEADERS, codebook_rows(book, items)),
        ("Summary", [f"{variable}", "Responses", "Percent of responses"], summary),
    ])


def _context_line(it: dict, context: list[str]) -> str:
    parts = [f"{c}: {_cell(it['context'].get(c))}" for c in context if it["context"].get(c) is not None]
    return f"Row {it['row_id']}" + (f" ({'; '.join(parts)})" if parts else "")


def write_responses_docx(path: str, variable: str, book: dict, items: list[dict], context: list[str],
                         title: str | None = None) -> None:
    from statly_engine.export import docx as dx

    doc = dx.new_document()
    title = title or f"Coded responses: {variable}"
    doc.core_properties.title = title
    doc.add_paragraph(title, style="Title")
    n = len(items)
    coded = sum(1 for it in items if it["tag_ids"])
    dx.paragraph(doc, [run(f"{n} written responses to {variable}. {coded} ({_pct(coded, n)}) have at least one "
                           f"tag. A response can have more than one tag, so it can appear under several headings.")])
    for t in book["tags"]:
        tagged = [it for it in items if t["id"] in it["tag_ids"]]
        doc.add_paragraph(f"{t['name']} ({len(tagged)} responses, {_pct(len(tagged), n)})", style="Heading 1")
        if t["definition"]:
            dx.paragraph(doc, [run("Definition: ", italic=True), run(t["definition"])])
        for it in tagged:
            dx.paragraph(doc, [run(_context_line(it, context), bold=True)], space_after=0)
            dx.paragraph(doc, [run(it["text"])])
        if not tagged:
            dx.paragraph(doc, [run("No responses have this tag yet.", italic=True)])
    rest = [it for it in items if not it["tag_ids"]]
    if rest:
        doc.add_paragraph(f"Not tagged yet ({len(rest)} responses)", style="Heading 1")
        for it in rest:
            dx.paragraph(doc, [run(_context_line(it, context), bold=True)], space_after=0)
            dx.paragraph(doc, [run(it["text"])])
    doc.save(path)


def write_codebook_xlsx(path: str, book: dict, items: list[dict]) -> None:
    from statly_engine.export import write_xlsx_sheets

    write_xlsx_sheets(path, [("Tag codebook", CODEBOOK_HEADERS, codebook_rows(book, items))])


def write_codebook_docx(path: str, variable: str, book: dict, items: list[dict]) -> None:
    from statly_engine.export import docx as dx

    doc = dx.new_document()
    doc.core_properties.title = "Tag codebook"
    doc.add_paragraph("Tag codebook", style="Title")
    dx.paragraph(doc, [run(f"Tags used to code the written responses to {variable} ({len(items)} responses).")])
    rows = [[r[0], r[1], r[2], str(r[3]), r[4]] for r in codebook_rows(book, items)]
    dx.add_grid(doc, CODEBOOK_HEADERS, rows, font_size=10, widths=[1.2, 2.6, 0.8, 0.8, 0.8])
    doc.save(path)
