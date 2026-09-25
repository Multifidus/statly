"""APA 7 number formatting and styled text runs (SPEC §10.1).

Rules: italic statistical symbols; values that cannot exceed 1 in magnitude (p, r, alpha,
correlations, proportions of variance) have no leading zero; p to three decimals with a
"p < .001" floor; other statistics to two decimals. The engine is the single APA formatter:
tables carry these display strings, the frontend never re-formats numbers.
"""

from __future__ import annotations

import math

MINUS = "-"  # hyphen-minus: pastes cleanly into Word, Excel and plain text
EM_DASH = "—"  # APA placeholder for an empty / undefined cell


def finite(x) -> bool:
    return x is not None and isinstance(x, (int, float)) and math.isfinite(x)


def num(x, decimals: int = 2) -> str:
    """Fixed decimals with a leading zero (M, SD, t, F, d...). Non-finite -> em dash."""
    if not finite(x):
        return EM_DASH
    s = f"{x:.{decimals}f}"
    if s.startswith("-") and float(s) == 0:
        s = s[1:]  # no "-0.00"
    return s.replace("-", MINUS)


def no_zero(x, decimals: int = 2) -> str:
    """No leading zero, for values bounded by 1 (r, alpha, eta squared): .34, -.05, 1.00."""
    s = num(x, decimals)
    if s.startswith("0."):
        return s[1:]
    if s.startswith(MINUS + "0."):
        return MINUS + s[2:]
    return s


def integer(x) -> str:
    return str(int(x)) if finite(x) else EM_DASH


def df_text(df) -> str:
    """Integer df print without decimals; fractional (Welch, GG) df to two decimals."""
    if not finite(df):
        return EM_DASH
    return str(int(round(df))) if abs(df - round(df)) < 1e-9 else num(df, 2)


def p_value(p) -> str:
    """Table display: '.034', '< .001', '> .999'."""
    if not finite(p):
        return EM_DASH
    if p < 0.001:
        return "< .001"
    if p > 0.999:
        return "> .999"
    return no_zero(p, 3)


def p_relation(p) -> str:
    """In-text form after the italic p: ' = .034' or ' < .001'."""
    if not finite(p):
        return " = " + EM_DASH
    s = p_value(p)
    return " " + s if s[0] in "<>" else " = " + s


def ci_text(lower, upper, decimals: int = 2, bounded: bool = False) -> str:
    """'[0.12, 0.88]'. Open (one-sided) bounds print as -∞ / ∞."""
    fmt = no_zero if bounded else num
    lo = fmt(lower, decimals) if finite(lower) else MINUS + "∞"
    hi = fmt(upper, decimals) if finite(upper) else "∞"
    return f"[{lo}, {hi}]"


# ---------------------------------------------------------------------------
# Rich text (contracts AnalysisResult#/$defs/RichText)
# ---------------------------------------------------------------------------
class Rich:
    """Builder for a RichText run list. Adjacent runs with identical styling are merged.

    >>> Rich().i("t").t("(28) = 2.10, ").i("p").t(" = .045").runs
    """

    def __init__(self):
        self.runs: list[dict] = []

    def _add(self, text: str, italic=False, subscript=False, superscript=False) -> "Rich":
        if not text:
            return self
        run = {"text": text, "italic": italic, "subscript": subscript, "superscript": superscript}
        last = self.runs[-1] if self.runs else None
        if last and all(last[k] == run[k] for k in ("italic", "subscript", "superscript")):
            last["text"] += text
        else:
            self.runs.append(run)
        return self

    def t(self, text: str) -> "Rich":
        return self._add(text)

    def i(self, text: str) -> "Rich":
        return self._add(text, italic=True)

    def sub(self, text: str, italic: bool = False) -> "Rich":
        return self._add(text, italic=italic, subscript=True)

    def sup(self, text: str) -> "Rich":
        return self._add(text, superscript=True)

    def extend(self, other: "Rich | list[dict]") -> "Rich":
        for r in (other.runs if isinstance(other, Rich) else other):
            self._add(r["text"], r.get("italic", False), r.get("subscript", False), r.get("superscript", False))
        return self

    def symbol(self, sym: "str | Rich") -> "Rich":
        """Italic symbol; a Rich passes through (e.g. d with subscript 'av')."""
        return self.extend(sym) if isinstance(sym, Rich) else self.i(sym)

    def stat(self, sym, df: list | tuple, value, decimals: int = 2) -> "Rich":
        """'t(28.51) = 2.10' with italic symbol."""
        self.symbol(sym)
        if df:
            self.t("(" + ", ".join(df_text(d) for d in df) + ")")
        return self.t(" = " + num(value, decimals))

    def p(self, p) -> "Rich":
        return self.i("p").t(p_relation(p))

    def es(self, sym, value, lower, upper, level: float, bounded: bool = False) -> "Rich":
        """'d = 0.52, 95% CI [0.10, 0.94]'."""
        fmt = no_zero if bounded else num
        self.symbol(sym).t(" = " + fmt(value, 2))
        if finite(lower) or finite(upper):
            self.t(f", {level_text(level)} CI {ci_text(lower, upper, 2, bounded)}")
        return self

    def plain(self) -> str:
        return "".join(r["text"] for r in self.runs)


def level_text(level: float) -> str:
    pct = level * 100
    return f"{pct:.0f}%" if abs(pct - round(pct)) < 1e-9 else f"{pct:g}%"


def text(s: str) -> list[dict]:
    return Rich().t(s).runs


def italic(s: str) -> list[dict]:
    return Rich().i(s).runs


# ---------------------------------------------------------------------------
# Table cells (contracts AnalysisResult#/$defs/TableCell)
# ---------------------------------------------------------------------------
def cell_text(s: "str | Rich | list[dict]") -> dict:
    runs = s.runs if isinstance(s, Rich) else (text(s) if isinstance(s, str) else s)
    return {"type": "text", "text": runs}


def cell_num(x, decimals: int = 2, bounded: bool = False) -> dict:
    v = float(x) if finite(x) else None
    return {"type": "number", "value": v, "display": (no_zero if bounded else num)(x, decimals)}


def cell_int(x) -> dict:
    return {"type": "number", "value": float(x) if finite(x) else None, "display": integer(x)}


def cell_df(x) -> dict:
    return {"type": "number", "value": float(x) if finite(x) else None, "display": df_text(x)}


def cell_p(p) -> dict:
    return {"type": "p_value", "value": float(p) if finite(p) else None, "display": p_value(p)}


def cell_ci(lower, upper, decimals: int = 2, bounded: bool = False) -> dict:
    return {"type": "interval", "lower": float(lower) if finite(lower) else None,
            "upper": float(upper) if finite(upper) else None, "display": ci_text(lower, upper, decimals, bounded)}


def cell_empty() -> dict:
    return {"type": "empty"}


def column(key: str, header: "str | Rich", align: str = "decimal") -> dict:
    runs = header.runs if isinstance(header, Rich) else text(header)
    return {"key": key, "header": runs, "align": align}


def row(cells: list[dict], indent: int = 0, kind: str = "data") -> dict:
    return {"cells": cells, "indent": indent, "kind": kind}


def table(title: str, columns: list[dict], rows: list[dict], *, number: int | None = 1,
          column_groups: list[dict] | None = None, general_note: "Rich | str | None" = None,
          specific_notes: list | None = None, probability_notes: list | None = None) -> dict:
    """APA table: numbered, italic title (renderer italicizes), horizontal rules only, notes."""
    def rt(x):
        return x.runs if isinstance(x, Rich) else text(x)

    return {
        "number": number, "title": title, "columns": columns, "column_groups": column_groups or [],
        "rows": rows,
        "notes": {"general": rt(general_note) if general_note is not None else None,
                  "specific": [rt(n) for n in specific_notes or []],
                  "probability": [rt(n) for n in probability_notes or []]},
    }


def column_group(label: "str | Rich", first_column: int, span: int) -> dict:
    return {"label": label.runs if isinstance(label, Rich) else text(label), "first_column": first_column,
            "span": span}
