"""reportlab rendering helpers: the same APA layout as the DOCX report (Times, 1-inch margins, APA
tables with horizontal rules only, numbered figures). Fonts: the system Times New Roman family when
present (macOS/Windows; Liberation Serif on Linux) so Greek statistical symbols (χ², η², ω²) render;
otherwise reportlab's built-in Times (Latin-1 only). No network access.
"""

from __future__ import annotations

import io
from html import escape
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import landscape, letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (Image, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table,
                                TableStyle)

from statly_engine.export import (align_of, cell_runs, group_header, note_paragraphs, plain, run,
                                  table_label)

_FONT_CANDIDATES = [
    # (regular, bold, italic, bold-italic)
    ("/System/Library/Fonts/Supplemental/Times New Roman.ttf",
     "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf",
     "/System/Library/Fonts/Supplemental/Times New Roman Italic.ttf",
     "/System/Library/Fonts/Supplemental/Times New Roman Bold Italic.ttf"),
    ("C:/Windows/Fonts/times.ttf", "C:/Windows/Fonts/timesbd.ttf", "C:/Windows/Fonts/timesi.ttf",
     "C:/Windows/Fonts/timesbi.ttf"),
    ("/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
     "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
     "/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf",
     "/usr/share/fonts/truetype/liberation/LiberationSerif-BoldItalic.ttf"),
]
_font_family: str | None = None


def font_family() -> str:
    """Register (once) and return the report font family name."""
    global _font_family
    if _font_family is not None:
        return _font_family
    _font_family = "Times-Roman"
    for paths in _FONT_CANDIDATES:
        if all(Path(p).is_file() for p in paths):
            try:
                names = ("StatlySerif", "StatlySerif-Bold", "StatlySerif-Italic", "StatlySerif-BoldItalic")
                for name, p in zip(names, paths):
                    pdfmetrics.registerFont(TTFont(name, p))
                pdfmetrics.registerFontFamily("StatlySerif", normal=names[0], bold=names[1], italic=names[2],
                                              boldItalic=names[3])
                _font_family = "StatlySerif"
                break
            except Exception:  # noqa: BLE001 - unreadable font file: try the next candidate
                continue
    return _font_family


def _faces() -> tuple[str, str]:
    fam = font_family()
    return (fam, "StatlySerif-Bold") if fam == "StatlySerif" else ("Times-Roman", "Times-Bold")


def style(size: float = 12, align=TA_LEFT, leading: float | None = None, space_after: float = 6,
          bold: bool = False, first_indent: float = 0) -> ParagraphStyle:
    regular, bold_face = _faces()
    return ParagraphStyle("s", fontName=bold_face if bold else regular, fontSize=size,
                          leading=leading or size * 1.2, alignment=align, spaceAfter=space_after,
                          firstLineIndent=first_indent)


def runs_markup(runs: list[dict]) -> str:
    out = []
    for r in runs:
        s = escape(r.get("text", ""), quote=False)
        if r.get("subscript"):
            s = f"<sub>{s}</sub>"
        if r.get("superscript"):
            s = f"<super>{s}</super>"
        if r.get("italic"):
            s = f"<i>{s}</i>"
        if r.get("bold"):
            s = f"<b>{s}</b>"
        out.append(s)
    return "".join(out)


def para(runs: list[dict], st: ParagraphStyle | None = None) -> Paragraph:
    return Paragraph(runs_markup(runs) or "&nbsp;", st or style())


_TA = {"left": TA_LEFT, "center": TA_CENTER, "right": TA_RIGHT}


def apa_table(table: dict, number: int | None, avail_width: float) -> list:
    """Flowables for one APA table (label, title, grid, notes). Font shrinks (12 -> 8pt) until the
    natural column widths fit the text block; remaining overflow wraps inside cells."""
    cols = table["columns"]
    aligns = [align_of(c) for c in cols]
    groups = group_header(table)
    body = table.get("rows") or []
    regular, _ = _faces()
    head_runs = [c["header"] for c in cols]
    body_runs = [[cell_runs(c) for c in r["cells"][:len(cols)]] for r in body]

    def natural(size: float) -> list[float]:
        widths = []
        for ci in range(len(cols)):
            texts = [plain(head_runs[ci])] + [plain(r[ci]) if ci < len(r) else "" for r in body_runs]
            w = max(pdfmetrics.stringWidth(t, regular, size) for t in texts)
            indent = max((12 * r.get("indent", 0) for r in body), default=0) if ci == 0 else 0
            widths.append(w + indent + 8)
        return widths

    size = 12.0
    widths = natural(size)
    while sum(widths) > avail_width and size > 8:
        size -= 0.5
        widths = natural(size)
    if sum(widths) > avail_width:
        widths = [w * avail_width / sum(widths) for w in widths]

    def cell_style(align: str, indent: int = 0) -> ParagraphStyle:
        st = style(size, _TA[align], space_after=0)
        st.leftIndent = 12 * indent
        return st

    data, cmds = [], [("VALIGN", (0, 0), (-1, -1), "BOTTOM"), ("LEFTPADDING", (0, 0), (-1, -1), 4),
                      ("RIGHTPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 2),
                      ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]
    if groups:
        row = [""] * len(cols)
        for runs, first, span in groups:
            row[first] = para(runs, cell_style("center"))
            if span > 1:
                cmds.append(("SPAN", (first, 0), (first + span - 1, 0)))
            if runs:
                cmds.append(("LINEBELOW", (first, 0), (first + span - 1, 0), 0.75, colors.black))
        data.append(row)
    data.append([para(h, cell_style("left" if i == 0 and aligns[i] == "left" else "center"))
                 for i, h in enumerate(head_runs)])
    n_head = len(data)
    for r, cells in zip(body, body_runs):
        row = []
        for ci, runs in enumerate(cells):
            if r.get("kind") == "section_header" and ci == 0:
                runs = [{**x, "italic": True} for x in runs]
            row.append(para(runs, cell_style(aligns[ci], r.get("indent", 0) if ci == 0 else 0)))
        data.append(row + [""] * (len(cols) - len(row)))
    if not body:
        data.append([""] * len(cols))
    cmds += [("LINEABOVE", (0, 0), (-1, 0), 0.75, colors.black),
             ("LINEBELOW", (0, n_head - 1), (-1, n_head - 1), 0.75, colors.black),
             ("LINEBELOW", (0, -1), (-1, -1), 0.75, colors.black)]
    grid = Table(data, colWidths=widths, repeatRows=n_head, hAlign="LEFT")
    grid.setStyle(TableStyle(cmds))
    head = [para([run(table_label(table, number), bold=True)], style(12, space_after=6)),
            para([run(table.get("title", ""), italic=True)], style(12, space_after=6))]
    out = [KeepTogether(head + [grid])]
    for p in note_paragraphs(table):
        out.append(para(p, style(size if size < 12 else 12, space_after=0)))
    out.append(Spacer(1, 12))
    return out


def figure(png: bytes, number: int, title: str, note: str | None, avail_width: float,
           max_height: float = 6.5 * inch) -> list:
    from PIL import Image as PILImage

    with PILImage.open(io.BytesIO(png)) as im:
        w_px, h_px = im.size
        dpi = (im.info.get("dpi") or (96, 96))[0] or 96
    w = min(w_px / float(dpi) * inch, avail_width)
    h = w * h_px / w_px
    if h > max_height:
        h, w = max_height, max_height * w_px / h_px
    img = Image(io.BytesIO(png), width=w, height=h)
    img.hAlign = "CENTER"
    items = [para([run(f"Figure {number}", bold=True)], style(12, space_after=6)),
             para([run(title, italic=True)], style(12, space_after=6)), img]
    if note:
        items.append(para([run("Note.", italic=True), run(" " + note)], style(12, space_after=0)))
    return [KeepTogether(items), Spacer(1, 12)]


def grid(headers: list[str], rows: list[list], widths: list[float], size: float = 9) -> Table:
    """APA-ruled plain grid (codebook / Test Log). Cells are strings or RichText runs."""
    st = style(size, space_after=0)
    data = [[para([run(h)], st) for h in headers]]
    for r in rows:
        data.append([para([run(v)] if isinstance(v, str) else v, st) for v in r])
    t = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                           ("LINEABOVE", (0, 0), (-1, 0), 0.75, colors.black),
                           ("LINEBELOW", (0, 0), (-1, 0), 0.75, colors.black),
                           ("LINEBELOW", (0, -1), (-1, -1), 0.75, colors.black)]))
    return t


def build(path: str, story: list, title: str, author: str | None, wide: bool = False) -> None:
    size = landscape(letter) if wide else letter
    doc = SimpleDocTemplate(path, pagesize=size, leftMargin=inch, rightMargin=inch, topMargin=inch,
                            bottomMargin=inch, title=title, author=author or "", creator="Statly")
    regular, _ = _faces()

    def page_number(canvas, d):
        canvas.saveState()
        canvas.setFont(regular, 12)
        canvas.drawRightString(size[0] - inch, size[1] - 0.6 * inch, str(d.page))
        canvas.restoreState()

    doc.build(story, onFirstPage=page_number, onLaterPages=page_number)


def text_width(wide: bool = False) -> float:
    return (landscape(letter) if wide else letter)[0] - 2 * inch
