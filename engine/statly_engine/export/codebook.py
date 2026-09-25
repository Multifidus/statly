"""Codebook (SPEC §10.3): one row per variable with name, label, question text, role, level, value
labels, reverse-scoring, scale membership and scoring rule, missing codes, and the computed-variable
definition in words. Written as XLSX (sheet "Codebook" + sheet "Scales") or DOCX (landscape).
"""

from __future__ import annotations

HEADERS = ["Name", "Label", "Question text", "Role", "Level", "Value labels", "Reverse-scored",
           "Scale", "Scoring rule", "Missing codes", "Computed as"]
SCALE_HEADERS = ["Scale", "Items", "Scoring", "Minimum answered items", "Score variable"]

ROLE_WORDS = {
    "unassigned": "Not assigned", "identifier": "Identifier", "group": "Group", "time": "Time point",
    "test_item": "Test item", "test_total": "Test total", "likert_item": "Likert item",
    "scale_score": "Scale score", "demographic": "Demographic", "open_text": "Open-ended text", "ignore": "Ignored",
}


def _v(x) -> str:
    """Codes as written by the user: 1 not 1.0."""
    if isinstance(x, float) and x.is_integer():
        return str(int(x))
    return str(x)


def _operand(o: dict) -> str:
    return o["variable"] + (f" at {o['time_level']}" if o.get("time_level") else "")


def _min_items_words(n_items: int, method: str, min_items: int | None) -> str:
    if min_items is None:
        return "at least one item answered" if method == "mean" else "all items answered"
    return f"at least {min_items} of {n_items} items answered"


def computed_words(c: dict | None) -> str:
    if not c:
        return ""
    op = c["op"]
    if op == "difference":
        return f"Difference score: {_operand(c['minuend'])} minus {_operand(c['subtrahend'])}."
    if op == "normalized_gain":
        return (f"Normalized gain (Hake's g): ({_operand(c['post'])} minus {_operand(c['pre'])}) divided by "
                f"({_v(c['max_score'])} minus {_operand(c['pre'])}); missing when the pre score equals "
                f"{_v(c['max_score'])}.")
    if op in ("scale_mean", "scale_sum"):
        kind = "Mean" if op == "scale_mean" else "Sum"
        items = c["items"]
        rule = _min_items_words(len(items), "mean" if op == "scale_mean" else "sum", c.get("min_items"))
        return (f"{kind} of {len(items)} items ({', '.join(items)}), reverse-coded items reversed first; "
                f"requires {rule}.")
    if op == "recode":
        parts = []
        for r in c["rules"]:
            if r.get("from_values") is not None:
                src = ", ".join(_v(x) for x in r["from_values"])
            else:
                rg = r.get("from_range") or {}
                src = f"{_v(rg.get('min'))} to {_v(rg.get('max'))}"
            to = "missing" if r.get("to") is None else _v(r["to"])
            parts.append(f"{src} → {to}")
        other = "kept as is" if c.get("unmatched") == "keep" else "set to missing"
        return f"Recode of {c['source']}: " + "; ".join(parts) + f"; other values {other}."
    return ""


def _reverse_words(v: dict) -> str:
    if not v.get("reverse_coded"):
        return "No"
    rr = v.get("response_range")
    if rr:
        return f"Yes ({_v(rr['min'])}–{_v(rr['max'])}, scored as {_v(rr['min'] + rr['max'])} − x)"
    return "Yes"


def scale_rule(s: dict) -> str:
    n = len(s["items"])
    kind = "Mean" if s["scoring_method"] == "mean" else "Sum"
    return f"{kind} of {n} items; {_min_items_words(n, s['scoring_method'], s.get('min_items'))}"


def rows(meta: dict) -> list[list[str]]:
    scales = {s["id"]: s for s in meta.get("scales") or []}
    member_of: dict[str, list[dict]] = {}
    for s in scales.values():
        for item in s["items"]:
            member_of.setdefault(item, []).append(s)
    score_of = {s["score_variable"]: s for s in scales.values() if s.get("score_variable")}
    out = []
    for v in sorted(meta["variables"], key=lambda x: x["display_order"]):
        mem = member_of.get(v["name"], [])
        if v.get("scale_id") in scales and scales[v["scale_id"]] not in mem:
            mem.append(scales[v["scale_id"]])
        scale_names = [s["name"] for s in mem]
        rules = [scale_rule(s) for s in mem]
        if v["name"] in score_of:
            s = score_of[v["name"]]
            scale_names.append(f"{s['name']} (score)")
            rules.append(scale_rule(s))
        out.append([
            v["name"], v.get("label") or "", v.get("question_text") or "", ROLE_WORDS.get(v["role"], v["role"]),
            v["level"].capitalize(), "; ".join(f"{_v(x['value'])} = {x['label']}" for x in v.get("value_labels") or []),
            _reverse_words(v), "; ".join(scale_names), "; ".join(rules),
            ", ".join(_v(x) for x in v.get("missing_codes") or []), computed_words(v.get("computed")),
        ])
    return out


def scale_rows(meta: dict) -> list[list[str]]:
    out = []
    for s in meta.get("scales") or []:
        n = len(s["items"])
        mi = s.get("min_items")
        out.append([s["name"], ", ".join(s["items"]), "Mean" if s["scoring_method"] == "mean" else "Sum",
                    str(mi) if mi is not None else ("1" if s["scoring_method"] == "mean" else str(n)),
                    s.get("score_variable") or ""])
    return out


def write_xlsx(path: str, meta: dict) -> None:
    from statly_engine.export import write_xlsx_sheets

    write_xlsx_sheets(path, [("Codebook", HEADERS, rows(meta)), ("Scales", SCALE_HEADERS, scale_rows(meta))])


def write_docx(path: str, meta: dict, title: str = "Codebook") -> None:
    from statly_engine.export import docx as dx

    doc = dx.new_document(landscape=True)
    doc.core_properties.title = title
    doc.add_paragraph(title, style="Title")
    dx.add_grid(doc, HEADERS, rows(meta), font_size=8,
                widths=[0.8, 0.8, 1.3, 0.6, 0.6, 1.0, 0.6, 0.6, 0.9, 0.5, 1.3])
    srows = scale_rows(meta)
    if srows:
        doc.add_paragraph("Scales", style="Heading 1")
        dx.add_grid(doc, SCALE_HEADERS, srows, font_size=10)
    doc.save(path)
