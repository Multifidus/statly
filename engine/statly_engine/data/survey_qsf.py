"""Qualtrics survey-definition (.qsf) parser.

Pure function: QSF text/bytes/dict -> `Survey`, a JSON-serializable description of every
question and the data-export columns it produces (name, label, value labels, measurement
level). `survey_apply` matches that description to an imported dataset.

Export column naming (Qualtrics defaults):
  single-answer MC        -> tag                     (value = recode value of the choice)
  multi-answer MC         -> tag_<choiceId>          (1 = selected)
  matrix (Likert, single) -> tag_<rowPos>            (value = recode value of the answer column)
  matrix (multi answer)   -> tag_<rowPos>_<answerId> (1 = selected)
  text entry              -> tag, or tag_<choiceId> for form fields
  choice "other" text     -> tag_<choiceId>_TEXT
  slider                  -> tag_<choiceId>
  timing                  -> tag_First Click / _Last Click / _Page Submit / _Click Count
Matrix statements are numbered by their 1-based position in ChoiceOrder, not by choice id: a real
export of a matrix with ChoiceOrder [1, 15, 16, 17, 18] has columns Q131_1..Q131_5. Row export tags
(ChoiceDataExportTags) replace tag_<rowPos> when present. Two questions producing the same column
name (duplicate export tags) are disambiguated like the importer does for repeated header names:
the later one becomes name_2, name_3, ...

Unknown or unsupported constructs never raise: the question is kept with kind "other", no
columns, and a note saying why.
"""

from __future__ import annotations

import html
import json
import re
from dataclasses import asdict, dataclass, field
from typing import Any

import pandas as pd

from statly_engine.data import qualtrics as qx
from statly_engine.errors import FileUnreadable

TIMING_SUFFIXES = ("First Click", "Last Click", "Page Submit", "Click Count")
SINGLE_SELECTORS = {"SAVR", "SAHR", "SACOL", "DL", "SB", "NPS"}
MULTI_SELECTORS = {"MAVR", "MAHR", "MACOL", "MSB"}
TEXT_SELECTORS = {"SL", "ML", "ESTB", "PW"}
LIKERT_SUBSELECTORS = {"SingleAnswer", "DL", "DND"}
NO_DATA_TYPES = {"DB", "Meta", "Captcha", "Draw"}  # carry no answer columns worth labelling
FILE_TYPES = {"FileUpload", "SignatureBox"}         # exported as file id/name/size/type columns

_TAG_RE = re.compile(r"<[^>]+>")
_BREAK_RE = re.compile(r"<\s*(br|/p|/div|/li|/h\d)\s*/?\s*>", re.IGNORECASE)
_WS_RE = re.compile(r"\s+")


@dataclass
class ColumnSpec:
    name: str
    label: str
    value_labels: list[dict] = field(default_factory=list)  # [{"value": code, "label": text}] in display order
    level: str = "nominal"                                    # nominal | ordinal | scale | text
    group: str | None = None                                  # matrix tag for matrix statements


@dataclass
class Question:
    tag: str
    qid: str
    text: str
    kind: str                     # single | multi | matrix | text | slider | other
    question_type: str
    selector: str | None
    required: bool
    columns: list[ColumnSpec] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    in_trash: bool = False        # deleted in the editor: listed, but never part of a data export


@dataclass
class Survey:
    name: str
    questions: list[Question] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)

    def columns(self) -> list[ColumnSpec]:
        """Columns a data export would contain (Trash questions excluded)."""
        return [c for q in self.questions if not q.in_trash for c in q.columns]

    def suggested_scales(self) -> list[dict]:
        """Matrix questions with >= 3 ordinal statements -> {name, label, items}."""
        out = []
        for q in self.questions:
            if q.in_trash:
                continue
            items = [c.name for c in q.columns if q.kind == "matrix" and c.level == "ordinal" and c.group == q.tag]
            if len(items) >= 3:
                out.append({"name": q.tag, "label": q.text, "items": items})
        return out


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def clean_text(raw: Any) -> str:
    """Strips HTML tags, decodes entities (&nbsp; -> space) and collapses whitespace."""
    if raw is None:
        return ""
    s = _BREAK_RE.sub(" ", str(raw))
    s = _TAG_RE.sub("", s)
    s = html.unescape(s).replace("\xa0", " ")
    return _WS_RE.sub(" ", s).strip()


def _code(raw: Any) -> int | float | str:
    """Recode values arrive as strings ("4"); keep numbers numeric."""
    if isinstance(raw, bool):
        return int(raw)
    if isinstance(raw, (int, float)):
        return int(raw) if float(raw).is_integer() else float(raw)
    s = str(raw).strip()
    try:
        f = float(s)
    except ValueError:
        return s
    return int(f) if f.is_integer() else f


def _as_map(raw: Any) -> dict[str, Any]:
    """QSF maps keyed by id sometimes arrive as lists (1-based) or as [] when empty."""
    if isinstance(raw, dict):
        return {str(k): v for k, v in raw.items()}
    if isinstance(raw, list):
        return {str(i + 1): v for i, v in enumerate(raw) if v is not None}
    return {}


def _order(payload: dict, map_key: str, order_key: str) -> list[str]:
    items = _as_map(payload.get(map_key))
    order = [str(x) for x in payload.get(order_key) or [] if str(x) in items]
    seen = set(order)
    rest = sorted((k for k in items if k not in seen), key=lambda k: (not k.isdigit(), int(k) if k.isdigit() else 0, k))
    return list(dict.fromkeys(order)) + rest


def _options(payload: dict, map_key: str, order_key: str, recode: bool = True) -> list[dict]:
    """Ordered [{id, label, code, text_entry}] for Choices or Answers.

    With `recode`, RecodeValues give the stored codes and VariableNaming the value labels (for a
    matrix these are keyed by answer id, so matrix rows are read with recode=False)."""
    items = _as_map(payload.get(map_key))
    recodes = _as_map(payload.get("RecodeValues")) if recode else {}
    naming = _as_map(payload.get("VariableNaming")) if recode else {}
    out = []
    for cid in _order(payload, map_key, order_key):
        item = items[cid] if isinstance(items[cid], dict) else {"Display": items[cid]}
        label = clean_text(naming.get(cid)) or clean_text(item.get("Display")) or f"Choice {cid}"
        code = _code(recodes[cid]) if cid in recodes and str(recodes[cid]).strip() != "" else _code(cid)
        text_entry = str(item.get("TextEntry", "")).lower() in ("true", "1", "on")
        out.append({"id": cid, "label": label, "code": code, "text_entry": text_entry})
    return out


def _value_labels(opts: list[dict]) -> list[dict]:
    return [{"value": o["code"], "label": o["label"]} for o in opts]


def _is_ordinal(labels: list[str]) -> bool:
    """True when the labels form a known ordered response set, listed in its order."""
    if len(labels) < 2:
        return False
    hit = qx.detect_response_set(pd.Series(labels, dtype="object"))
    if hit is None:
        return False
    rank = {vl["label"].casefold(): i for i, vl in enumerate(hit[1])}
    pos = [rank.get(lbl.casefold()) for lbl in labels]
    if any(p is None for p in pos):
        return False
    return pos == sorted(pos) or pos == sorted(pos, reverse=True)


def _required(payload: dict) -> bool:
    settings = (payload.get("Validation") or {}).get("Settings") or {}
    return str(settings.get("ForceResponse", "")).upper() in ("ON", "TRUE", "1")


def _text_cols(tag: str, opts: list[dict], question: str) -> list[ColumnSpec]:
    return [ColumnSpec(f"{tag}_{o['id']}_TEXT", f"{question} - {o['label']} - Text", [], "text")
            for o in opts if o["text_entry"]]


# ---------------------------------------------------------------------------
# Per-type builders (each returns (kind, columns, notes))
# ---------------------------------------------------------------------------
def _mc(tag: str, text: str, p: dict, selector: str) -> tuple[str, list[ColumnSpec], list[str]]:
    opts = _options(p, "Choices", "ChoiceOrder")
    if selector in SINGLE_SELECTORS:
        level = "ordinal" if selector == "NPS" or _is_ordinal([o["label"] for o in opts]) else "nominal"
        cols = [ColumnSpec(tag, text, _value_labels(opts), level)]
        return "single", cols + _text_cols(tag, opts, text), []
    if selector in MULTI_SELECTORS:
        cols = [ColumnSpec(f"{tag}_{o['id']}", f"{text} - {o['label']}", [{"value": 1, "label": o["label"]}],
                           "nominal") for o in opts]
        return "multi", cols + _text_cols(tag, opts, text), []
    return "other", [], [f"Multiple-choice layout '{selector}' is not supported; no columns produced."]


def _matrix(tag: str, text: str, p: dict, selector: str, sub: str | None) -> tuple[str, list[ColumnSpec], list[str]]:
    rows = _options(p, "Choices", "ChoiceOrder", recode=False)
    answers = _options(p, "Answers", "AnswerOrder")
    row_tags = _as_map(p.get("ChoiceDataExportTags"))

    positions = {r["id"]: i for i, r in enumerate(rows, 1)}

    def row_name(r: dict) -> str:
        custom = row_tags.get(r["id"])
        return str(custom).strip() if custom not in (None, "", False) else f"{tag}_{positions[r['id']]}"

    if selector in ("Likert", "Bipolar") and (sub or "SingleAnswer") in LIKERT_SUBSELECTORS:
        vls = _value_labels(answers)
        cols = [ColumnSpec(row_name(r), r["label"], list(vls), "ordinal", tag) for r in rows]
        for r in rows:
            if r["text_entry"]:
                cols.append(ColumnSpec(f"{row_name(r)}_TEXT", f"{r['label']} - Text", [], "text", tag))
        return "matrix", cols, []
    if selector == "Likert" and sub == "MultipleAnswer":
        cols = [ColumnSpec(f"{row_name(r)}_{a['id']}", f"{r['label']} - {a['label']}",
                           [{"value": 1, "label": a["label"]}], "nominal", tag) for r in rows for a in answers]
        return "matrix", cols, []
    return "other", [], [f"Matrix layout '{selector}/{sub}' is not supported; no columns produced."]


def _text_entry(tag: str, text: str, p: dict, selector: str) -> tuple[str, list[ColumnSpec], list[str]]:
    if selector in TEXT_SELECTORS:
        return "text", [ColumnSpec(tag, text, [], "text")], []
    if selector == "FORM":
        opts = _options(p, "Choices", "ChoiceOrder")
        return "text", [ColumnSpec(f"{tag}_{o['id']}", f"{text} - {o['label']}", [], "text") for o in opts], []
    return "other", [], [f"Text-entry layout '{selector}' is not supported; no columns produced."]


def _slider(tag: str, text: str, p: dict) -> tuple[str, list[ColumnSpec], list[str]]:
    opts = _options(p, "Choices", "ChoiceOrder")
    return "slider", [ColumnSpec(f"{tag}_{o['id']}", f"{text} - {o['label']}", [], "scale") for o in opts], []


def _timing(tag: str, text: str) -> tuple[str, list[ColumnSpec], list[str]]:
    cols = [ColumnSpec(f"{tag}_{s}", f"{tag} - {s}", [], "scale") for s in TIMING_SUFFIXES]
    return "other", cols, ["Page timer: timing metadata, not a question."]


def _question(p: dict) -> Question:
    qid = str(p.get("QuestionID") or "")
    tag = str(p.get("DataExportTag") or qid or "").strip()
    qtype = str(p.get("QuestionType") or "")
    selector = p.get("Selector")
    sub = p.get("SubSelector")
    text = clean_text(p.get("QuestionText")) or clean_text(p.get("QuestionDescription")) or tag
    try:
        if not tag:
            kind, cols, notes = "other", [], ["Question has no export tag; no columns produced."]
        elif qtype == "MC":
            kind, cols, notes = _mc(tag, text, p, str(selector))
        elif qtype == "Matrix":
            kind, cols, notes = _matrix(tag, text, p, str(selector), sub)
        elif qtype == "TE":
            kind, cols, notes = _text_entry(tag, text, p, str(selector))
        elif qtype == "Slider":
            kind, cols, notes = _slider(tag, text, p)
        elif qtype == "Timing":
            kind, cols, notes = _timing(tag, text)
        elif qtype in FILE_TYPES:
            kind, cols, notes = "other", [], [f"'{qtype}' answers are uploaded files (exported as file id, name, "
                                              "size and type); no labelled columns produced."]
        elif qtype in NO_DATA_TYPES:
            kind, cols, notes = "other", [], [f"'{qtype}' element carries no answer data."]
        else:
            kind, cols, notes = "other", [], [f"Question type '{qtype or 'unknown'}' is not supported; "
                                              "no columns produced."]
    except (TypeError, ValueError, AttributeError, KeyError) as exc:  # malformed payload
        kind, cols, notes = "other", [], [f"Question could not be read ({type(exc).__name__}); no columns produced."]
    return Question(tag, qid, text, kind, qtype, None if selector is None else str(selector), _required(p),
                    cols, notes)


def _block_order(elements: list[dict]) -> tuple[list[str], set[str]]:
    """QuestionIDs in block order, and those sitting in the Trash block (not exported)."""
    order, trash = [], set()
    for el in elements:
        if el.get("Element") != "BL":
            continue
        payload = el.get("Payload")
        blocks = payload.values() if isinstance(payload, dict) else payload if isinstance(payload, list) else []
        for block in blocks:
            if not isinstance(block, dict):
                continue
            ids = [str(be.get("QuestionID")) for be in block.get("BlockElements") or []
                   if isinstance(be, dict) and be.get("Type") == "Question" and be.get("QuestionID")]
            if block.get("Type") == "Trash":
                trash.update(ids)
            else:
                order.extend(ids)
    return list(dict.fromkeys(order)), trash


def _qid_key(qid: str) -> tuple:
    m = re.match(r"^QID(\d+)", qid)
    return (0, int(m.group(1)), qid) if m else (1, 0, qid)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def parse_qsf(source: str | bytes | dict) -> Survey:
    """Parses a .qsf document (text, bytes or already-decoded JSON) into a `Survey`."""
    if isinstance(source, (bytes, bytearray)):
        try:
            source = bytes(source).decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise FileUnreadable("This survey file isn't UTF-8 text, so it can't be a Qualtrics .qsf file.") from exc
    if isinstance(source, str):
        try:
            doc = json.loads(source.lstrip("﻿"))
        except ValueError as exc:
            raise FileUnreadable("This survey file isn't valid JSON, so it can't be a Qualtrics .qsf file.") from exc
    else:
        doc = source
    if not isinstance(doc, dict) or not isinstance(doc.get("SurveyElements"), list):
        raise FileUnreadable("This file doesn't look like a Qualtrics survey (.qsf): no SurveyElements found.")

    entry = doc.get("SurveyEntry") if isinstance(doc.get("SurveyEntry"), dict) else {}
    elements = [e for e in doc["SurveyElements"] if isinstance(e, dict)]
    payloads = {}
    for el in elements:
        p = el.get("Payload")
        if el.get("Element") == "SQ" and isinstance(p, dict):
            payloads.setdefault(str(p.get("QuestionID") or el.get("PrimaryAttribute") or ""), p)

    # Export order = block order; questions in no block follow by QID; Trash questions come last.
    order, trash = _block_order(elements)
    active = [q for q in order if q in payloads]
    placed = set(active) | trash
    active += sorted((q for q in payloads if q not in placed), key=_qid_key)
    trashed = [q for q in payloads if q in trash]

    survey = Survey(name=clean_text(entry.get("SurveyName")) or "Untitled survey")
    if trashed:
        survey.notes.append(f"{len(trashed)} deleted question(s) sit in the survey's Trash; they are listed but "
                            "are not part of data exports.")
    # Duplicate export column names (e.g. two questions tagged Q131) are disambiguated the way the
    # importer disambiguates repeated header names: the later column gets _2, _3, ...
    seen: set[str] = set()
    tag_count: dict[str, int] = {}
    for qid in active:
        q = _question(payloads[qid])
        tag_count[q.tag] = tag_count.get(q.tag, 0) + 1
        if tag_count[q.tag] == 2:
            survey.notes.append(f"Export tag '{q.tag}' is used by more than one question.")
        for c in q.columns:
            base, name, k = c.name, c.name, 2
            while name in seen:
                name, k = f"{base}_{k}", k + 1
            if name != base:
                q.notes.append(f"Column '{base}' is also produced by an earlier question; this one is "
                               f"exported as '{name}'.")
                c.name = name
            seen.add(name)
        survey.questions.append(q)
    for qid in trashed:
        q = _question(payloads[qid])
        q.in_trash = True
        q.notes.append("In the survey's Trash: not part of data exports.")
        survey.questions.append(q)
    return survey
