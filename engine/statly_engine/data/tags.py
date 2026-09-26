"""Qualitative coding of open-ended responses (SPEC §11.1): tag codebook, tag applications,
paged response reader with search spans, tag summaries, and yes/no variables made from tags.

The codebook (contracts/TagCodebook.json) is session state kept per dataset on the DatasetStore
(tags reference rows by the stable `_statly_row_id`, so they survive every snapshot). It is written
into `ProjectFile.tag_codebook` by `project.save` / `project.autosave` and restored by
`project.load` (`attach_codebook` / `restore_codebook`). Everything else here is a pure function of
(data, codebook, request).
"""

from __future__ import annotations

import copy
import re

import pandas as pd

from statly_engine.data import variables as var_ops
from statly_engine.data.columns import slug, to_cell
from statly_engine.data.store import ROW_ID, DatasetStore
from statly_engine.errors import InvalidParams, StaleOrUnknown

# Okabe-Ito colorblind-safe palette (black swapped for a mid grey so it shows in both themes).
PALETTE = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#D55E00", "#F0E442", "#999999"]
MAX_PAGE = 500
YES_NO_LABELS = [{"value": 0, "label": "No"}, {"value": 1, "label": "Yes"}]
_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_ATTR = "tag_codebooks"  # DatasetStore attribute: dataset_id -> codebook dict


# ---------------------------------------------------------------------------
# Session storage
# ---------------------------------------------------------------------------
def _books(store: DatasetStore) -> dict[str, dict]:
    books = getattr(store, _ATTR, None)
    if books is None:
        books = {}
        setattr(store, _ATTR, books)
    return books


def empty_codebook() -> dict:
    return {"schema_version": 1, "tags": [], "applications": []}


def codebook(store: DatasetStore, dataset_id: str) -> dict:
    """The live codebook for a loaded dataset (created empty on first use)."""
    store.get(dataset_id)  # unknown dataset -> StaleOrUnknown
    return _books(store).setdefault(dataset_id, empty_codebook())


def attach_codebook(store: DatasetStore, project: dict) -> dict:
    """project.save / autosave: the engine's codebook for the project's dataset becomes
    `tag_codebook` (the frontend's copy is kept when the engine holds none)."""
    meta = project.get("dataset_meta")
    book = _books(store).get(meta["dataset_id"]) if isinstance(meta, dict) else None
    if book is None:
        return project
    return {**project, "tag_codebook": copy.deepcopy(book) if (book["tags"] or book["applications"]) else None}


def restore_codebook(store: DatasetStore, project: dict) -> None:
    """project.load: make the saved codebook the live one for the loaded dataset."""
    meta = project.get("dataset_meta")
    if not isinstance(meta, dict):
        return
    saved = project.get("tag_codebook")
    _books(store)[meta["dataset_id"]] = copy.deepcopy(saved) if saved else empty_codebook()


# ---------------------------------------------------------------------------
# Codebook CRUD
# ---------------------------------------------------------------------------
def _tag(book: dict, tag_id: str) -> dict:
    for t in book["tags"]:
        if t["id"] == tag_id:
            return t
    raise InvalidParams("That tag isn't in the codebook any more.", tag_id=tag_id)


def upsert_tag(store: DatasetStore, dataset_id: str, spec: dict) -> dict:
    book = codebook(store, dataset_id)
    name = (spec.get("name") or "").strip()
    if not name:
        raise InvalidParams("Give the tag a name.")
    tag_id = spec.get("id")
    for t in book["tags"]:
        if t["name"].casefold() == name.casefold() and t["id"] != tag_id:
            raise InvalidParams(f"There is already a tag called '{t['name']}'. Choose another name.")
    color = spec.get("color")
    if color is not None and not _COLOR_RE.match(color):
        raise InvalidParams("A tag color must look like #0072B2.")
    definition = (spec.get("definition") or "").strip()
    if tag_id is not None:
        tag = _tag(book, tag_id)
        tag.update(name=name, definition=definition, color=color or tag["color"])
    else:
        taken = {t["id"] for t in book["tags"]}
        base = "tag_" + slug(name).lower()
        tag_id, k = base, 1
        while tag_id in taken:
            k += 1
            tag_id = f"{base}_{k}"
        used = {t["color"].upper() for t in book["tags"]}
        auto = next((c for c in PALETTE if c.upper() not in used), PALETTE[len(book["tags"]) % len(PALETTE)])
        tag = {"id": tag_id, "name": name, "color": color or auto, "definition": definition}
        book["tags"].append(tag)
    return {"codebook": copy.deepcopy(book), "tag": dict(tag)}


def delete_tag(store: DatasetStore, dataset_id: str, tag_id: str) -> dict:
    book = codebook(store, dataset_id)
    _tag(book, tag_id)
    book["tags"] = [t for t in book["tags"] if t["id"] != tag_id]
    apps = []
    for a in book["applications"]:
        ids = [t for t in a["tag_ids"] if t != tag_id]
        if ids:
            apps.append({**a, "tag_ids": ids})
    book["applications"] = apps
    return {"codebook": copy.deepcopy(book)}


# ---------------------------------------------------------------------------
# Applying tags
# ---------------------------------------------------------------------------
def _text_var(meta: dict, name: str) -> dict:
    for v in meta["variables"]:
        if v["name"] == name:
            if v["dtype"] != "string":
                raise InvalidParams(f"'{name}' doesn't hold written answers, so it can't be tagged.", variable=name)
            return v
    raise InvalidParams(f"There is no variable called '{name}'.", variable=name)


def _app_index(book: dict, variable: str) -> dict[int, list[str]]:
    return {a["row_id"]: a["tag_ids"] for a in book["applications"] if a["variable"] == variable}


def apply(store: DatasetStore, dataset_id: str, row_id: int, variable: str, tag_ids: list[str]) -> dict:
    """Set the tags on one response (replaces its previous tags; [] removes them all)."""
    state = store.get(dataset_id)
    book = codebook(store, dataset_id)
    _text_var(state.meta, variable)
    if not (state.df[ROW_ID] == row_id).any():
        raise StaleOrUnknown("That response is no longer in the dataset.", row_id=row_id)
    known = {t["id"] for t in book["tags"]}
    unknown = [t for t in tag_ids if t not in known]
    if unknown:
        raise InvalidParams("Some of those tags aren't in the codebook any more.", tag_ids=unknown)
    order = {t["id"]: i for i, t in enumerate(book["tags"])}
    ids = sorted(dict.fromkeys(tag_ids), key=order.__getitem__)
    apps = [a for a in book["applications"] if not (a["row_id"] == row_id and a["variable"] == variable)]
    if ids:
        apps.append({"row_id": int(row_id), "variable": variable, "tag_ids": ids})
        apps.sort(key=lambda a: (a["variable"], a["row_id"]))
    book["applications"] = apps
    return {"row_id": int(row_id), "variable": variable, "tag_ids": ids}


# ---------------------------------------------------------------------------
# Reading responses
# ---------------------------------------------------------------------------
def _key(x):
    """Comparable form of a cell/filter value (1 == 1.0 == '1' is NOT assumed for text)."""
    x = to_cell(x)
    if isinstance(x, bool) or x is None:
        return x
    if isinstance(x, (int, float)):
        return float(x)
    return str(x)


def _responses_mask(df: pd.DataFrame, variable: str) -> pd.Series:
    text = df[variable]
    return text.notna() & (text.astype("string").str.strip().fillna("") != "")


def _filter_mask(df: pd.DataFrame, meta: dict, filters: list[dict]) -> pd.Series:
    mask = pd.Series(True, index=df.index)
    names = {v["name"] for v in meta["variables"]}
    for f in filters or []:
        name = f["variable"]
        if name not in names:
            raise InvalidParams(f"There is no variable called '{name}'.", variable=name)
        wanted = {_key(v) for v in f["values"]}
        col = df[name].astype(object)
        mask &= col.map(lambda x: _key(x) in wanted).astype(bool)
    return mask


def _terms(search: str | None) -> list[str]:
    """Search words; "quoted phrases" stay together. Case-insensitive; a response must contain all terms."""
    if not search or not search.strip():
        return []
    out = [a or b for a, b in re.findall(r'"([^"]+)"|(\S+)', search)]
    return [t.casefold() for t in out if t.strip()]


def _utf16(text: str, i: int) -> int:
    return len(text[:i].encode("utf-16-le")) // 2


def match_spans(text: str, terms: list[str]) -> list[list[int]] | None:
    """Merged [start, end) spans of every term occurrence, in UTF-16 code units (JS string
    indices), or None when some term does not occur."""
    if not terms:
        return []
    low = text.casefold()
    # casefold can change length (e.g. 'ß' -> 'ss'); fall back to lower() for those texts.
    if len(low) != len(text):
        low = text.lower()
        if len(low) != len(text):
            low = text
    spans: list[tuple[int, int]] = []
    for t in terms:
        found = [m.start() for m in re.finditer(re.escape(t), low)]
        if not found:
            return None
        spans += [(s, s + len(t)) for s in found]
    spans.sort()
    merged: list[list[int]] = []
    for s, e in spans:
        if merged and s <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])
    return [[_utf16(text, s), _utf16(text, e)] for s, e in merged]


def responses(store: DatasetStore, params: dict) -> dict:
    state = store.get(params["dataset_id"])
    meta, df = state.meta, state.df
    variable = params["variable"]
    _text_var(meta, variable)
    book = codebook(store, params["dataset_id"])
    apps = _app_index(book, variable)
    context = list(params.get("context_variables") or [])
    names = {v["name"] for v in meta["variables"]}
    for c in context:
        if c not in names:
            raise InvalidParams(f"There is no variable called '{c}'.", variable=c)
    mask = _responses_mask(df, variable) & _filter_mask(df, meta, params.get("filters") or [])
    tag_filter = params.get("tag_filter")  # None | "untagged" | tag id
    if tag_filter is not None:
        if tag_filter == "untagged":
            mask &= ~df[ROW_ID].isin([r for r, ids in apps.items() if ids])
        else:
            _tag(book, tag_filter)
            mask &= df[ROW_ID].isin([r for r, ids in apps.items() if tag_filter in ids])
    sub = df.loc[mask]
    terms = _terms(params.get("search"))
    texts = sub[variable].astype(object).tolist()
    rids = [int(r) for r in sub[ROW_ID].tolist()]
    hits: list[tuple[int, int, list[list[int]]]] = []  # (position in sub, row_id, spans)
    for i, (rid, text) in enumerate(zip(rids, texts)):
        spans = match_spans(str(text), terms)
        if spans is not None:
            hits.append((i, rid, spans))
    offset, limit = int(params.get("offset", 0)), int(params.get("limit", 100))
    if limit < 1 or limit > MAX_PAGE:
        raise InvalidParams(f"limit must be between 1 and {MAX_PAGE}.")
    page = hits[offset:offset + limit]
    ctx_cols = {c: sub[c].astype(object).tolist() for c in context}
    items = [{
        "row_id": rid, "text": str(texts[i]), "matches": spans, "tag_ids": list(apps.get(rid, [])),
        "context": {c: to_cell(ctx_cols[c][i]) for c in context},
    } for i, rid, spans in page]
    return {"snapshot_id": meta["snapshot_id"], "variable": variable, "offset": offset,
            "total": len(hits), "total_responses": int(_responses_mask(df, variable).sum()), "items": items}


# ---------------------------------------------------------------------------
# Summaries
# ---------------------------------------------------------------------------
def _pct(k: int, n: int) -> float | None:
    return round(100.0 * k / n, 1) if n else None


def _counts(book: dict, rows: list[int], apps: dict[int, list[str]]) -> list[dict]:
    n = len(rows)
    out = []
    for t in book["tags"]:
        k = sum(1 for r in rows if t["id"] in apps.get(r, ()))
        out.append({"tag_id": t["id"], "count": k, "percent": _pct(k, n)})
    return out


def _levels(meta: dict, name: str, values: list) -> list[tuple[object, str]]:
    """(key, label) per level: value-label order first, then any other values sorted."""
    v = next(x for x in meta["variables"] if x["name"] == name)
    missing = {_key(c) for c in v.get("missing_codes") or []}
    present = {_key(x) for x in values} - {None} - missing
    out, seen = [], set()
    for vl in v.get("value_labels") or []:
        k = _key(vl["value"])
        if k in present and k not in seen:
            out.append((k, vl["label"]))
            seen.add(k)
    rest = sorted(present - seen, key=lambda k: (not isinstance(k, float), k if isinstance(k, float) else str(k)))
    for k in rest:
        label = str(int(k)) if isinstance(k, float) and k.is_integer() else str(k)
        out.append((k, label))
    return out


def summary(store: DatasetStore, params: dict) -> dict:
    state = store.get(params["dataset_id"])
    meta, df = state.meta, state.df
    variable = params["variable"]
    _text_var(meta, variable)
    book = codebook(store, params["dataset_id"])
    apps = _app_index(book, variable)
    answered = df.loc[_responses_mask(df, variable)]
    rows = [int(r) for r in answered[ROW_ID].tolist()]
    coded = sum(1 for r in rows if apps.get(r))
    out = {
        "snapshot_id": meta["snapshot_id"], "variable": variable, "n_responses": len(rows), "n_coded": coded,
        "n_uncoded": len(rows) - coded, "tags": [dict(t) for t in book["tags"]],
        "overall": _counts(book, rows, apps), "by": None, "groups": [], "n_missing_group": 0,
    }
    by = params.get("by")
    if by:
        if by not in {v["name"] for v in meta["variables"]}:
            raise InvalidParams(f"There is no variable called '{by}'.", variable=by)
        keys = [_key(x) for x in answered[by].astype(object).tolist()]
        levels = _levels(meta, by, keys)
        wanted = {k for k, _ in levels}
        out["by"] = by
        out["n_missing_group"] = sum(1 for k in keys if k not in wanted)
        for k, label in levels:
            grp = [r for r, kk in zip(rows, keys) if kk == k]
            value = int(k) if isinstance(k, float) and k.is_integer() else k
            out["groups"].append({"value": value, "label": label, "n_responses": len(grp),
                                  "counts": _counts(book, grp, apps)})
    return out


# ---------------------------------------------------------------------------
# Tags -> yes/no variables
# ---------------------------------------------------------------------------
def _yes_no_label(variable: str, tag_name: str) -> str:
    return f"{variable} tagged '{tag_name}' (1 = yes, 0 = no)"


def to_variables_op(book: dict, created: list[dict]):
    def op(df: pd.DataFrame, meta: dict, params: dict):
        variable = params["variable"]
        _text_var(meta, variable)
        tag_ids = params.get("tag_ids") or [t["id"] for t in book["tags"]]
        if not tag_ids:
            raise InvalidParams("Add at least one tag to the codebook first.")
        tags = [_tag(book, t) for t in dict.fromkeys(tag_ids)]
        apps = _app_index(book, variable)
        has_text = _responses_mask(df, variable)
        df = df.copy()
        after = variable
        for t in tags:
            base = f"{variable}_{slug(t['name']).lower()}"
            label = _yes_no_label(variable, t["name"])
            existing = next((v for v in meta["variables"] if v["name"] == base), None)
            reuse = existing is not None and existing.get("label") == label and existing["dtype"] == "integer"
            name = base if reuse else var_ops._unique_name(meta, base)
            tagged = df[ROW_ID].map(lambda r, tid=t["id"]: tid in apps.get(int(r), ())).astype(bool)
            values = pd.array([(1 if y else 0) if h else None for y, h in zip(tagged, has_text)], dtype="Int64")
            df[name] = values
            if not reuse:
                new = var_ops.new_variable(
                    name, label=label, role="unassigned", level="nominal", dtype="integer",
                    value_labels=copy.deepcopy(YES_NO_LABELS), response_range=None,
                    question_text=f"Made from the tag '{t['name']}' on {variable}: {t['definition']}".strip(": "))
                var_ops._validate_var(new)
                var_ops._insert_after(meta, new, after)
            after = name
            yes = int((pd.Series(values) == 1).sum())
            no = int((pd.Series(values) == 0).sum())
            created.append({"tag_id": t["id"], "variable": name, "n_yes": yes, "n_no": no,
                            "n_missing": int(len(df) - yes - no), "updated": reuse})
        n = len(tags)
        label = f"Made yes/no variable{'s' if n > 1 else ''} from {n} tag{'s' if n > 1 else ''}"
        return df, meta, [], label
    return op


def to_variables(store: DatasetStore, params: dict) -> dict:
    book = codebook(store, params["dataset_id"])
    created: list[dict] = []
    res = var_ops.apply(store, params, to_variables_op(book, created))
    return {**res, "created": created}


# ---------------------------------------------------------------------------
# Export rows
# ---------------------------------------------------------------------------
def coded_rows(store: DatasetStore, dataset_id: str, variable: str, context: list[str]) -> tuple[dict, list[dict]]:
    """(codebook, [{row_id, text, tag_ids, context}]) for every non-empty response, in row order."""
    res = responses(store, {"dataset_id": dataset_id, "variable": variable, "context_variables": context,
                            "offset": 0, "limit": MAX_PAGE})
    items = list(res["items"])
    while len(items) < res["total"]:
        more = responses(store, {"dataset_id": dataset_id, "variable": variable, "context_variables": context,
                                 "offset": len(items), "limit": MAX_PAGE})
        items += more["items"]
    return codebook(store, dataset_id), items
