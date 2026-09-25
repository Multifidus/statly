"""Variable Interview operations (SPEC §6): variable edits, scales, answer-key scoring,
computed variables.

Every operation is a pure function (df, meta, request) -> (df, meta, warnings) over the
current snapshot; `apply` wraps it with the stale-snapshot check and a labelled
`DatasetStore.commit`, which records the undo/redo history. After every edit all computed
variables are re-evaluated in dependency order, so e.g. toggling `reverse_coded` on an item
immediately updates its scale score.
"""

from __future__ import annotations

import copy
import json
import re
from typing import Callable

import pandas as pd
from pydantic import ValidationError

from statly_engine.contracts import VariableSchema
from statly_engine.data import scoring
from statly_engine.data.columns import frame_to_rows, slug
from statly_engine.data.readers import read_file
from statly_engine.data.store import ROW_ID, DatasetStore
from statly_engine.errors import InvalidParams, StaleOrUnknown

Result = tuple[pd.DataFrame, dict, list[dict], str]  # df, meta, warnings, history label
PATCH_FIELDS = ("role", "level", "label", "question_text", "value_labels", "reverse_coded", "response_range",
                "missing_codes", "display_order")
PREVIEW_ROWS = 10
_MATRIX_RE = re.compile(r"^(.+?)_\d+$")


# ---------------------------------------------------------------------------
# Plumbing
# ---------------------------------------------------------------------------
def apply(store: DatasetStore, params: dict, op: Callable[[pd.DataFrame, dict, dict], Result]) -> dict:
    state = store.get(params["dataset_id"])
    snap = params.get("snapshot_id")
    if snap is not None and snap != state.meta["snapshot_id"]:
        raise StaleOrUnknown("The data changed since this was opened; please try again.",
                             snapshot_id=state.meta["snapshot_id"])
    df, meta, warns, label = op(state.df, copy.deepcopy(state.meta), params)
    meta = store.commit(meta["dataset_id"], df, meta, state.originals, label=label)
    return {"dataset_meta": meta, "warnings": _dedupe(warns)}


def _dedupe(warns: list[dict]) -> list[dict]:
    seen, out = set(), []
    for w in warns:
        key = (w["code"], w["message"])
        if key not in seen:
            seen.add(key)
            out.append(w)
    return out


def _by_name(meta: dict) -> dict[str, dict]:
    return {v["name"]: v for v in meta["variables"]}


def _var(meta: dict, name: str) -> dict:
    v = _by_name(meta).get(name)
    if v is None:
        raise InvalidParams(f"There is no variable called '{name}'.", variable=name)
    return v


def _validate_var(v: dict) -> None:
    try:
        VariableSchema.model_validate(v)
    except ValidationError as exc:
        raise InvalidParams(f"The change to '{v.get('name')}' isn't valid.",
                            errors=json.loads(exc.json(include_url=False))) from exc


def _unique_name(meta: dict, base: str) -> str:
    taken = {v["name"] for v in meta["variables"]} | {ROW_ID}
    name, k = base, 1
    while name in taken:
        k += 1
        name = f"{base}_{k}"
    return name


def _check_new_name(meta: dict, name: str) -> None:
    if not name or not name.strip():
        raise InvalidParams("Give the new variable a name.")
    if name == ROW_ID or name.startswith("_statly"):
        raise InvalidParams(f"'{name}' is reserved; choose another name.")
    if name in _by_name(meta):
        raise InvalidParams(f"There is already a variable called '{name}'. Choose another name.", variable=name)


def _renumber(meta: dict, priority: set[str] = frozenset()) -> None:
    """Make display_order 0..n-1; on ties, variables just moved (priority) come first."""
    ordered = sorted(enumerate(meta["variables"]),
                     key=lambda iv: (iv[1]["display_order"], 0 if iv[1]["name"] in priority else 1, iv[0]))
    for k, (_, v) in enumerate(ordered):
        v["display_order"] = k


def _insert_after(meta: dict, new_var: dict, after: str | None) -> None:
    """Place new_var right after `after` (or at the end) in display order."""
    if after is not None and after in _by_name(meta):
        pos = _by_name(meta)[after]["display_order"] + 1
        for v in meta["variables"]:
            if v["display_order"] >= pos:
                v["display_order"] += 1
        new_var["display_order"] = pos
    else:
        new_var["display_order"] = 1 + max((v["display_order"] for v in meta["variables"]), default=-1)
    meta["variables"].append(new_var)
    _renumber(meta)


def new_variable(name: str, **o) -> dict:
    v = {
        "schema_version": 1, "name": name, "label": None, "question_text": None, "role": "unassigned",
        "level": "continuous", "dtype": "float", "value_labels": [], "reverse_coded": False,
        "response_range": None, "scale_id": None, "missing_codes": [], "sources": [], "is_metadata": False,
        "is_pii": False, "pii_reason": None, "computed": None, "display_order": 0,
    }
    v.update(o)
    return v


# ---------------------------------------------------------------------------
# Computed variables: evaluation + dependency-ordered recompute
# ---------------------------------------------------------------------------
def dependencies(defn: dict) -> list[str]:
    op = defn["op"]
    if op == "difference":
        return [defn["minuend"]["variable"], defn["subtrahend"]["variable"]]
    if op == "normalized_gain":
        return [defn["pre"]["variable"], defn["post"]["variable"]]
    if op in ("scale_mean", "scale_sum"):
        return list(defn["items"])
    if op == "recode":
        return [defn["source"]]
    raise InvalidParams(f"Unknown computed operation '{op}'.")


def evaluate(df: pd.DataFrame, meta: dict, defn: dict) -> tuple[str, object, list[dict]]:
    """(dtype, column values, warnings) for one computed definition over the current data."""
    by_name = _by_name(meta)
    for dep in dependencies(defn):
        if dep not in by_name:
            raise InvalidParams(f"The calculation uses '{dep}', which is not in the dataset.", variable=dep)
    op = defn["op"]
    if op == "difference":
        x, w = scoring.difference(df, meta, by_name, defn)
        return "float", x, w
    if op == "normalized_gain":
        x, w = scoring.normalized_gain(df, meta, by_name, defn)
        return "float", x, w
    if op in ("scale_mean", "scale_sum"):
        x, w = scoring.scale_score(df, by_name, defn["items"], op, defn.get("min_items"))
        return "float", x, w
    src = by_name[defn["source"]]
    values = scoring.recode_values(df, src, defn["rules"], defn["unmatched"])
    dtype, col = scoring.recode_output(values, src, defn["rules"], defn["unmatched"])
    return dtype, col, []


def dependents(meta: dict, name: str) -> list[str]:
    return [v["name"] for v in meta["variables"] if v.get("computed") and name in dependencies(v["computed"])]


def recompute(df: pd.DataFrame, meta: dict) -> tuple[pd.DataFrame, list[dict]]:
    """Re-evaluate every computed variable (dependencies first). Returns a new frame."""
    computed = {v["name"]: v for v in meta["variables"] if v.get("computed")}
    if not computed:
        return df, []
    cols = {c: df[c] for c in df.columns}
    order, warns = [], []
    pending = dict(computed)
    while pending:
        ready = [n for n, v in pending.items()
                 if all(d not in pending for d in dependencies(v["computed"]))]
        if not ready:
            raise InvalidParams("These calculated variables depend on each other in a loop: "
                                + ", ".join(sorted(pending)) + ".")
        for n in ready:
            order.append(pending.pop(n))
    for v in order:
        cur = pd.DataFrame(cols, copy=False)
        dtype, values, w = evaluate(cur, meta, v["computed"])
        v["dtype"] = dtype
        cols[v["name"]] = pd.Series(values, index=df.index)
        warns += w
    names = [ROW_ID] + [v["name"] for v in meta["variables"]]
    out = pd.DataFrame({n: cols[n] for n in names}, index=df.index)
    return out, warns


def _drop_columns(df: pd.DataFrame, names: list[str]) -> pd.DataFrame:
    return df.drop(columns=[n for n in names if n in df.columns])


# ---------------------------------------------------------------------------
# variables.update
# ---------------------------------------------------------------------------
def update_variables(df: pd.DataFrame, meta: dict, params: dict) -> Result:
    updates = params["updates"]
    if not updates:
        raise InvalidParams("There are no changes to apply.")
    by_name = _by_name(meta)
    moved: set[str] = set()
    changed: list[str] = []
    for patch in updates:
        name = patch["name"]
        v = by_name.get(name)
        if v is None:
            raise InvalidParams(f"There is no variable called '{name}'.", variable=name)
        for k, val in patch.items():
            if k == "name":
                continue
            if k not in PATCH_FIELDS:
                raise InvalidParams(f"'{k}' can't be changed here.", variable=name)
            v[k] = copy.deepcopy(val)
            if k == "display_order":
                moved.add(name)
        _validate_var(v)
        values = [str(x["value"]) for x in v["value_labels"]]
        if len(values) != len(set(values)):
            raise InvalidParams(f"'{name}' has the same answer code listed twice in its value labels.",
                                variable=name)
        if v["reverse_coded"] and v["dtype"] not in scoring.NUMERIC_DTYPES:
            raise InvalidParams(f"'{name}' holds text, so it can't be reverse-scored. Confirm its answer codes "
                                "first.", variable=name)
        rr = v["response_range"]
        if rr is not None and rr["min"] >= rr["max"]:
            raise InvalidParams(f"The answer range for '{name}' must go from a lower to a higher number.",
                                variable=name)
        if name not in changed:
            changed.append(name)
    if moved:
        _renumber(meta, moved)
    df, warns = recompute(df, meta)
    label = params.get("label") or _update_label(updates, changed)
    return df, meta, warns, label


def _update_label(updates: list[dict], changed: list[str]) -> str:
    if len(changed) == 1:
        fields = [k for k in updates[0] if k != "name"]
        pretty = {"role": "role", "level": "measurement level", "label": "label", "question_text": "question text",
                  "value_labels": "value labels", "reverse_coded": "reverse-scoring",
                  "response_range": "answer range", "missing_codes": "missing-value codes",
                  "display_order": "position"}
        if len(fields) == 1:
            return f"Changed {pretty.get(fields[0], fields[0])} of {changed[0]}"
        return f"Edited {changed[0]}"
    return f"Edited {len(changed)} variables"


# ---------------------------------------------------------------------------
# Scales
# ---------------------------------------------------------------------------
def _scale(meta: dict, scale_id: str) -> dict | None:
    return next((s for s in meta["scales"] if s["id"] == scale_id), None)


def _remove_scale(df: pd.DataFrame, meta: dict, scale: dict) -> pd.DataFrame:
    """Delete a scale: clear items' scale_id and drop its score variable (if nothing else uses it)."""
    by_name = _by_name(meta)
    for item in scale["items"]:
        if item in by_name and by_name[item].get("scale_id") == scale["id"]:
            by_name[item]["scale_id"] = None
    score = scale.get("score_variable")
    if score and score in by_name:
        users = dependents(meta, score)
        if users:
            raise InvalidParams(
                f"The score '{score}' is used by {', '.join(users)}. Remove those calculations first.",
                variable=score)
        meta["variables"] = [v for v in meta["variables"] if v["name"] != score]
        df = _drop_columns(df, [score])
    meta["scales"] = [s for s in meta["scales"] if s["id"] != scale["id"]]
    _renumber(meta)
    return df


def upsert_scale(df: pd.DataFrame, meta: dict, params: dict) -> Result:
    spec = params["scale"]
    name = spec["name"].strip()
    if not name:
        raise InvalidParams("Give the scale a name.")
    items = list(dict.fromkeys(spec["items"]))
    if len(items) < 2:
        raise InvalidParams("A scale needs at least two items. Add more questions that measure the same idea.")
    by_name = _by_name(meta)
    for it in items:
        v = by_name.get(it)
        if v is None:
            raise InvalidParams(f"There is no variable called '{it}'.", variable=it)
        if v["dtype"] not in scoring.NUMERIC_DTYPES:
            raise InvalidParams(f"'{it}' holds text, so it can't be part of a scale score. Confirm its answer "
                                "codes first.", variable=it)
        if v.get("computed") and v["computed"]["op"] in ("scale_mean", "scale_sum"):
            raise InvalidParams(f"'{it}' is itself a scale score, so it can't be an item.", variable=it)
    method = spec["scoring_method"]
    min_items = spec["min_items"] if "min_items" in spec else scoring.default_min_items(len(items), method)
    if min_items is not None and min_items > len(items):
        raise InvalidParams(f"The minimum number of answered items ({min_items}) is more than the "
                            f"{len(items)} items in the scale.")

    warns: list[dict] = []
    scale = _scale(meta, spec["id"]) if spec.get("id") else None
    if scale is None:
        sid = spec.get("id") or f"scale_{slug(name)}"
        base, k = sid, 1
        while _scale(meta, sid) is not None:
            k += 1
            sid = f"{base}_{k}"
        scale = {"id": sid, "name": name, "items": [], "scoring_method": method, "min_items": min_items,
                 "score_variable": None, "origin": "user"}
        meta["scales"].append(scale)

    # Items taken from other scales move here; a scale left with < 2 items is removed.
    for other in list(meta["scales"]):
        if other["id"] == scale["id"]:
            continue
        taken = [i for i in other["items"] if i in items]
        if not taken:
            continue
        other["items"] = [i for i in other["items"] if i not in items]
        if len(other["items"]) < 2:
            df = _remove_scale(df, meta, other)
            warns.append(scoring.warning(
                "scale_removed", f"The scale '{other['name']}' had fewer than two items left, so it was removed.",
                None))
        elif other.get("score_variable"):
            sv = _by_name(meta).get(other["score_variable"])
            if sv and sv.get("computed"):
                sv["computed"]["items"] = list(other["items"])
                if sv["computed"].get("min_items") and sv["computed"]["min_items"] > len(other["items"]):
                    sv["computed"]["min_items"] = other["min_items"] = len(other["items"])
    by_name = _by_name(meta)
    for old in scale["items"]:
        if old not in items and old in by_name and by_name[old].get("scale_id") == scale["id"]:
            by_name[old]["scale_id"] = None
    for it in items:
        v = by_name[it]
        v["scale_id"] = scale["id"]
        if v["role"] == "unassigned":
            v["role"] = "likert_item"
    scale.update(name=name, items=items, scoring_method=method, min_items=min_items)

    op = "scale_mean" if method == "mean" else "scale_sum"
    defn = {"op": op, "items": items, "min_items": min_items, "scale_id": scale["id"]}
    kind = "average" if method == "mean" else "total"
    score = by_name.get(scale.get("score_variable") or "")
    if score is None:
        requested = (spec.get("score_variable") or "").strip()
        if requested:
            _check_new_name(meta, requested)
            score_name = requested
        else:
            score_name = _unique_name(meta, f"{slug(name)}_score")
        score = new_variable(score_name, role="scale_score", level="continuous", dtype="float")
        last_item = max(items, key=lambda i: by_name[i]["display_order"])
        _insert_after(meta, score, last_item)
        scale["score_variable"] = score_name
    score["computed"] = defn
    score["label"] = f"{name} ({kind} score)"
    score["question_text"] = f"{'Average' if method == 'mean' else 'Sum'} of {', '.join(items)}"
    _validate_var(score)
    df, w = recompute(df, meta)
    return df, meta, warns + w, f"Scored scale {name}"


def delete_scale(df: pd.DataFrame, meta: dict, params: dict) -> Result:
    scale = _scale(meta, params["scale_id"])
    if scale is None:
        raise InvalidParams(f"There is no scale with id '{params['scale_id']}'.")
    df = _remove_scale(df, meta, scale)
    df, w = recompute(df, meta)
    return df, meta, w, f"Removed scale {scale['name']}"


# ---------------------------------------------------------------------------
# Answer-key scoring
# ---------------------------------------------------------------------------
def _common_prefix(items: list[str]) -> str | None:
    prefixes = {m.group(1) for m in (_MATRIX_RE.match(i) for i in items) if m}
    if len(prefixes) == 1 and all(_MATRIX_RE.match(i) for i in items):
        return prefixes.pop()
    return None


def score_items(df: pd.DataFrame, meta: dict, params: dict) -> Result:
    key = params["key"]
    if not key:
        raise InvalidParams("Enter the correct answer for at least one question.")
    items = [k["item"] for k in key]
    if len(set(items)) != len(items):
        raise InvalidParams("A question appears twice in the answer key.")
    warns: list[dict] = []
    scored_names: list[str] = []
    by_name = _by_name(meta)
    for entry in key:
        item = _var(meta, entry["item"])
        if item["role"] in ("unassigned", "ignore"):
            item["role"] = "test_item"
        correct = entry.get("correct")
        if correct is None:  # already scored 0/1: use as is
            if item["dtype"] not in scoring.NUMERIC_DTYPES:
                raise InvalidParams(f"'{item['name']}' holds answer text, so it needs a correct answer in the key.",
                                    variable=item["name"])
            scored_names.append(item["name"])
            continue
        if not isinstance(correct, list):
            correct = [correct]
        if not correct:
            raise InvalidParams(f"Choose the correct answer for {item['name']}.", variable=item["name"])
        rules, w = scoring.answer_key_rules(df, item, correct)
        warns += w
        defn = {"op": "recode", "source": item["name"], "rules": rules, "unmatched": "missing"}
        target = f"{item['name']}_correct"
        existing = by_name.get(target)
        if existing is not None and not (existing.get("computed") or {}).get("source") == item["name"]:
            target = _unique_name(meta, target)
            existing = None
        if existing is None:
            existing = new_variable(target, dtype="integer")
            _insert_after(meta, existing, item["name"])
            by_name = _by_name(meta)
        existing.update(
            label=f"{item['name']} correct", question_text=item.get("question_text"), role="test_item",
            level="nominal", value_labels=[{"value": 0, "label": "Incorrect"}, {"value": 1, "label": "Correct"}],
            computed=defn)
        _validate_var(existing)
        scored_names.append(target)

    # Total = number correct among answered questions (a blank answer earns no point).
    total_name = (params.get("total_name") or "").strip()
    prefix = _common_prefix(items)
    default_total = f"{prefix}_total" if prefix else "test_total"
    total = by_name.get(total_name or default_total)
    if total is not None and not ((total.get("computed") or {}).get("op") == "scale_sum"):
        if total_name:
            raise InvalidParams(f"There is already a variable called '{total_name}'. Choose another name.",
                                variable=total_name)
        total = None
    if total is None:
        name = total_name or _unique_name(meta, default_total)
        total = new_variable(name, role="test_total", level="continuous", dtype="float")
        last = max(scored_names, key=lambda n: _by_name(meta)[n]["display_order"])
        _insert_after(meta, total, last)
    total.update(
        role="test_total", level="continuous",
        label=params.get("total_label") or f"{prefix or 'Test'} total (number correct)",
        question_text=f"Number of correct answers across {len(scored_names)} questions",
        computed={"op": "scale_sum", "items": scored_names, "min_items": 1, "scale_id": None})
    _validate_var(total)
    df, w = recompute(df, meta)
    return df, meta, warns + w, f"Scored {len(scored_names)} test questions with the answer key"


def parse_answer_key(path: str) -> dict:
    """Read an answer-key file: one row per question with its name and correct answer.

    Columns are found by header name (item/question/variable + correct/answer/key); a file
    with no recognisable header is read as (question, answer) in the first two columns.
    Several correct answers can be separated with '|' or ';'.
    """
    grid = read_file(path).grid
    header = [str(x).strip().lower() for x in grid.iloc[0].tolist()]

    def find(words, exclude=()):
        for j, h in enumerate(header):
            if any(w in h for w in words) and not any(x in h for x in exclude):
                return j
        return None

    item_col = find(("item", "variable", "name", "question id", "qid"), exclude=("text",))
    if item_col is None:
        item_col = find(("question",), exclude=("text",))
    ans_col = find(("correct", "answer", "key"), exclude=("text",))
    body = grid.iloc[1:]
    warns = []
    if item_col is None or ans_col is None or item_col == ans_col:
        item_col, ans_col, body = 0, 1, grid
        warns.append(scoring.warning(
            "answer_key_no_header", "Statly read the first column as the question and the second as the "
                                    "correct answer. Check the key below.", None))
    if grid.shape[1] < 2:
        raise InvalidParams("An answer key needs two columns: the question and its correct answer.")
    entries = []
    for _, row in body.iterrows():
        item = str(row.iloc[item_col]).strip()
        ans = str(row.iloc[ans_col]).strip()
        if not item or not ans:
            continue
        parts = [p.strip() for p in re.split(r"[|;]", ans) if p.strip()]
        entries.append({"item": item, "correct": parts})
    if not entries:
        raise InvalidParams("We didn't find any answers in that file.")
    return {"entries": entries, "warnings": warns}


# ---------------------------------------------------------------------------
# Computed variables (guided builder)
# ---------------------------------------------------------------------------
_DEFAULT_ROLE = {"difference": "unassigned", "normalized_gain": "unassigned", "scale_mean": "scale_score",
                 "scale_sum": "scale_score", "recode": None}


def _computed_variable(meta: dict, params: dict) -> dict:
    defn = params["definition"]
    op = defn["op"]
    role = params.get("role")
    if role is None:
        role = _DEFAULT_ROLE[op]
        if op in ("difference", "normalized_gain"):
            ops = [defn.get("minuend") or defn.get("post"), defn.get("subtrahend") or defn.get("pre")]
            roles = {_var(meta, o["variable"])["role"] for o in ops}
            if roles <= {"test_total", "scale_score"} and len(roles) == 1:
                role = roles.pop()
        if op == "recode":
            role = _var(meta, defn["source"])["role"]
    level = params.get("level") or ("continuous" if op != "recode" else _var(meta, defn["source"])["level"])
    return new_variable(params["name"].strip(), label=params.get("label"), role=role, level=level,
                        computed=copy.deepcopy(defn), question_text=_describe(defn))


def _describe(defn: dict) -> str:
    def opnd(o):
        return o["variable"] + (f" at {o['time_level']}" if o.get("time_level") else "")
    op = defn["op"]
    if op == "difference":
        return f"Gain score: {opnd(defn['minuend'])} minus {opnd(defn['subtrahend'])}"
    if op == "normalized_gain":
        return (f"Normalized gain: ({opnd(defn['post'])} - {opnd(defn['pre'])}) / "
                f"({scoring._fmt(defn['max_score'])} - {opnd(defn['pre'])})")
    if op in ("scale_mean", "scale_sum"):
        return f"{'Average' if op == 'scale_mean' else 'Sum'} of {', '.join(defn['items'])}"
    return f"Recode of {defn['source']}"


def _check_definition(meta: dict, defn: dict) -> None:
    if defn["op"] in ("scale_mean", "scale_sum"):
        mi = defn.get("min_items")
        if mi is not None and mi > len(defn["items"]):
            raise InvalidParams(f"The minimum number of answered items ({mi}) is more than the "
                                f"{len(defn['items'])} items chosen.")
    for dep in dependencies(defn):
        _var(meta, dep)


def preview_computed(store: DatasetStore, params: dict) -> dict:
    state = store.get(params["dataset_id"])
    meta = copy.deepcopy(state.meta)
    defn = params["definition"]
    _check_definition(meta, defn)
    dtype, values, warns = evaluate(state.df, meta, defn)
    series = pd.Series(values)
    n_valid = int(series.notna().sum())
    head = pd.DataFrame({"v": series.iloc[:PREVIEW_ROWS]})
    return {
        "snapshot_id": state.meta["snapshot_id"], "dtype": dtype,
        "row_ids": [int(x) for x in state.df[ROW_ID].iloc[:PREVIEW_ROWS]],
        "values": [r[0] for r in frame_to_rows(head)],
        "n_valid": n_valid, "n_missing": int(len(series) - n_valid), "warnings": _dedupe(warns),
    }


def add_computed(df: pd.DataFrame, meta: dict, params: dict) -> Result:
    _check_new_name(meta, params["name"].strip())
    defn = params["definition"]
    _check_definition(meta, defn)
    v = _computed_variable(meta, params)
    anchor = max(dependencies(defn), key=lambda n: _var(meta, n)["display_order"])
    _insert_after(meta, v, anchor)
    _validate_var(v)
    df, warns = recompute(df, meta)
    return df, meta, warns, f"Added {v['name']}"


def remove_computed(df: pd.DataFrame, meta: dict, params: dict) -> Result:
    v = _var(meta, params["name"])
    if not v.get("computed"):
        raise InvalidParams(f"'{v['name']}' came from your file, so it can't be removed here.", variable=v["name"])
    users = dependents(meta, v["name"])
    if users:
        raise InvalidParams(f"'{v['name']}' is used by {', '.join(users)}. Remove those first.", variable=v["name"])
    for s in meta["scales"]:
        if s.get("score_variable") == v["name"]:
            s["score_variable"] = None
    meta["variables"] = [x for x in meta["variables"] if x["name"] != v["name"]]
    _renumber(meta)
    df = _drop_columns(df, [v["name"]])
    df, warns = recompute(df, meta)
    return df, meta, warns, f"Removed {v['name']}"


def history(store: DatasetStore, dataset_id: str) -> dict:
    state = store.get(dataset_id)
    state.ensure_history()
    return {"dataset_id": dataset_id, "current_snapshot_id": state.meta["snapshot_id"], "cursor": state.cursor,
            "entries": [e.describe() for e in state.history]}


__all__ = ["apply", "update_variables", "upsert_scale", "delete_scale", "score_items", "parse_answer_key",
           "preview_computed", "add_computed", "remove_computed", "history", "recompute"]
