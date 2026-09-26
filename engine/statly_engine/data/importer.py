"""Import orchestration: stage previews, then commit them as datasets.

`preview` parses files and proposes everything the UI must confirm (variables,
row filters, PII, scales, multi-select splits, stack matching). `commit_import`
and `commit_stack` apply the user's confirmed decisions. Both are pure functions
of (store contents, params) except for the final `store.commit`.

Conventions where the contracts are silent (see module docstrings / report):
- `variables` overrides match proposals by name, else by (file_id, original column).
- A multi-select split is requested by adding indicator variables whose
  sources[0].original_column_name is the multi-select column and whose `label`
  is one of the options (see `multiselect_indicator_variables`).
- Choice-text recoding is driven by value_labels on a numeric-dtype variable.
- Suggested scales are kept when >= 2 final variables still carry their scale_id.
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import os
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from statly_engine.data import qualtrics as qx
from statly_engine.data.columns import (
    STRING_DTYPE, CoercionError, coerce, frame_to_rows, infer_dtype, multiselect_indicator,
    nonempty_values, parse_numbers, sentinel_codes, slug, to_cell,
)
from statly_engine.data.linking import link_report
from statly_engine.data.readers import ReadResult, read_file
from statly_engine.data.stacking import propose_matches
from statly_engine.data.store import ROW_ID, DatasetStore
from statly_engine.errors import InvalidParams, StaleOrUnknown

SAMPLE_ROWS = 50
ORDINAL_MAX_DISTINCT = 11
SCHEMA_FIELDS_FROM_USER = (
    "name", "label", "question_text", "role", "level", "dtype", "value_labels", "reverse_coded",
    "response_range", "scale_id", "missing_codes", "is_metadata", "is_pii", "pii_reason", "display_order",
)


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


# ---------------------------------------------------------------------------
# Staging
# ---------------------------------------------------------------------------
@dataclass
class StagedFile:
    file_id: str
    path: str
    name: str
    read: ReadResult
    qualtrics: dict
    header: qx.HeaderInfo
    data: pd.DataFrame  # raw strings, columns = variable names
    proposed: list[dict]
    row_filters: list[dict]
    scales: list[dict]
    multiselect: dict[str, list[str]]
    issues: list[dict]

    @property
    def proposed_by_name(self) -> dict[str, dict]:
        return {v["name"]: v for v in self.proposed}


@dataclass
class Preview:
    preview_id: str
    qualtrics_mode: str
    files: list[StagedFile]
    stack_onto_dataset_id: str | None
    stack_proposal: list[dict] | None
    extra_issues: list[dict] = field(default_factory=list)

    def file(self, file_id: str) -> StagedFile:
        for f in self.files:
            if f.file_id == file_id:
                return f
        raise InvalidParams(f"Unknown file_id '{file_id}' for this preview.")


def _issue(code, severity, message, file_id, column=None) -> dict:
    return {"code": code, "severity": severity, "message": message, "file_id": file_id, "column": column}


def _base_variable(name: str, file_id: str, header: qx.HeaderInfo, j: int, order: int) -> dict:
    return {
        "schema_version": 1, "name": name, "label": None, "question_text": header.question_texts[j],
        "role": "unassigned", "level": "nominal", "dtype": "string", "value_labels": [],
        "reverse_coded": False, "response_range": None, "scale_id": None, "missing_codes": [],
        "sources": [{"file_id": file_id, "original_column_name": header.original_names[j],
                     "qualtrics_import_id": header.import_ids[j], "header_texts": header.header_texts[j]}],
        "is_metadata": False, "is_pii": False, "pii_reason": None, "computed": None, "display_order": order,
    }


def propose_variables(file_id: str, header: qx.HeaderInfo, data: pd.DataFrame, is_qualtrics: bool):
    """Returns (variables, suggested_scales, multiselect {column: options}, issues)."""
    variables, issues, multiselect = [], [], {}
    for j, name in enumerate(header.names):
        raw = data[name]
        v = _base_variable(name, file_id, header, j, j)
        is_meta = is_qualtrics and (qx.is_metadata_name(name) or qx.is_timing_name(name))
        is_score = is_qualtrics and qx.is_score_name(name)
        v["is_metadata"] = is_meta
        pii = qx.detect_pii(name, raw, is_qualtrics)
        if pii:
            v["is_pii"], v["pii_reason"] = True, pii
        dtype = infer_dtype(raw)
        v["dtype"] = dtype
        if dtype == "string":
            rs = None if is_meta else qx.detect_response_set(raw)
            if rs:
                set_id, labels, sentinels = rs
                v.update(dtype="integer", level="ordinal", value_labels=labels,
                         missing_codes=[int(s) for s in sentinels],
                         response_range={"min": 1, "max": len(labels)})
                issues.append(_issue(
                    "choice_text_detected", "info",
                    f"'{name}' contains answer text ({', '.join(l['label'] for l in labels)}). We will store it "
                    f"as numbers 1-{len(labels)} in that order. Check the order and the numbers match your "
                    "survey's coding before importing.", file_id, name))
            else:
                options = None if is_meta else qx.detect_multiselect(raw, header.question_texts[j])
                if options:
                    multiselect[name] = options
                    v["value_labels"] = [{"value": o, "label": o} for o in options]
                    issues.append(_issue(
                        "multiselect_detected", "info",
                        f"'{name}' looks like a 'select all that apply' question with {len(options)} options. "
                        "You can split it into one yes/no variable per option.", file_id, name))
                elif (is_qualtrics and qx.is_text_entry_name(name)) or (not is_meta and qx.looks_open_text(raw)):
                    v["role"] = "open_text"
            if not pii and qx.has_embedded_email(raw):
                issues.append(_issue(
                    "embedded_email", "caution",
                    f"Some answers in '{name}' contain email addresses written into the text. The column is "
                    "kept, but consider removing contact details before sharing the data.", file_id, name))
        elif dtype in ("integer", "float"):
            num = parse_numbers(nonempty_values(raw))
            sentinels = sentinel_codes(num)
            v["missing_codes"] = [int(s) for s in sentinels]
            valid = num[~num.isin(sentinels)]
            if (dtype == "integer" and not is_meta and not is_score and len(valid)
                    and valid.nunique() <= ORDINAL_MAX_DISTINCT and valid.min() >= 0
                    and valid.max() <= ORDINAL_MAX_DISTINCT):
                v["level"] = "ordinal"
                v["response_range"] = {"min": int(valid.min()), "max": int(valid.max())}
            else:
                v["level"] = "continuous"
            if sentinels:
                issues.append(_issue(
                    "missing_code_suggested", "info",
                    f"'{name}' contains {', '.join(str(int(s)) for s in sentinels)}, which usually means "
                    "'no answer'. We marked it as a missing-value code.", file_id, name))
        elif dtype == "datetime":
            v["level"] = "continuous"
        if is_qualtrics and name == "ResponseId":
            v["role"] = "identifier"
        if is_score:
            v["role"], v["level"] = "test_total", "continuous"
        variables.append(v)

    scales = []
    if is_qualtrics:
        by_name = {v["name"]: v for v in variables}
        excluded = {n for n in header.names if qx.is_metadata_name(n) or qx.is_timing_name(n)
                    or qx.is_text_entry_name(n) or qx.is_score_name(n)}
        grouped: set[str] = set()
        for prefix, items in qx.matrix_groups(header.names, excluded).items():
            if not all(by_name[i]["level"] == "ordinal" and by_name[i]["dtype"] == "integer" for i in items):
                continue
            scale_id = f"scale_{slug(prefix)}"
            for i in items:
                by_name[i]["role"] = "likert_item"
                by_name[i]["scale_id"] = scale_id
            scales.append({"id": scale_id, "name": prefix, "items": list(items), "scoring_method": "mean",
                           "min_items": None, "score_variable": None, "origin": "matrix_suggestion"})
            grouped.update(items)
            issues.append(_issue(
                "matrix_scale_suggested", "info",
                f"{', '.join(items)} look like one matrix question. We suggest treating them as a scale "
                "named " + prefix + ".", file_id, items[0]))
        # Numeric-export code checks (SPEC §5.2): Qualtrics recode values may not be 1..k.
        seen_groups = set()
        for v in variables:
            if v["level"] != "ordinal" or v["value_labels"] or v["is_metadata"]:
                continue
            num = parse_numbers(nonempty_values(data[v["name"]]))
            vals = sorted({int(x) for x in num if x not in v["missing_codes"]})
            if not vals:
                continue
            contiguous = vals == list(range(vals[0], vals[-1] + 1))
            shown = ", ".join(str(x) for x in vals)
            if not contiguous:
                # Expose the observed codes so the UI can show them (labels unknown: the number itself).
                v["value_labels"] = [{"value": x, "label": str(x)} for x in vals]
                issues.append(_issue(
                    "noncontiguous_codes", "caution",
                    f"'{v['name']}' uses the numbers {shown}, which skip values. Qualtrics recode values are "
                    "not always 1-5; check these match your answer choices.", file_id, v["name"]))
            elif v["scale_id"] not in seen_groups:
                target = v["scale_id"] or v["name"]
                seen_groups.add(v["scale_id"])
                issues.append(_issue(
                    "confirm_numeric_codes", "info",
                    f"'{target}' answers are stored as numbers ({shown}). Confirm these match your answer "
                    "choices (Qualtrics recode values are not always 1-5).", file_id, v["name"]))
    return variables, scales, multiselect, issues


def stage_file(path: str, *, sheet_name=None, encoding=None, delimiter=None, qualtrics_mode="auto",
               header_rows: int | None = None, file_id: str | None = None) -> StagedFile:
    read = read_file(path, sheet_name=sheet_name, encoding=encoding, delimiter=delimiter)
    detected, rows = qx.detect_header_rows(read.grid, qualtrics_mode)
    if header_rows is not None:
        rows = header_rows
    if rows >= len(read.grid) + 1:
        raise InvalidParams("The file has fewer rows than the header rows requested.")
    is_qualtrics = rows > 1 and (detected or qualtrics_mode == "on" or header_rows is not None)
    header, data = qx.split_header(read.grid, rows)
    fid = file_id or _new_id("f")
    variables, scales, multiselect, issues = propose_variables(fid, header, data, is_qualtrics)
    for iss in read.issues:
        issues.insert(0, {**iss, "file_id": fid})
    if is_qualtrics:
        filters = qx.suggest_row_filters(data, fid)
    else:
        filters = []
    if detected and qualtrics_mode == "off":
        issues.insert(0, _issue("qualtrics_detected_but_off", "info",
                                "This looks like a Qualtrics export, but Qualtrics mode is off.", fid))
    return StagedFile(
        file_id=fid, path=path, name=Path(path).name, read=read,
        qualtrics={"detected": detected, "confirmed": qualtrics_mode == "on" or header_rows is not None and rows > 1,
                   "header_rows": rows},
        header=header, data=data, proposed=variables, row_filters=filters, scales=scales,
        multiselect=multiselect, issues=issues,
    )


def _sample_rows(f: StagedFile) -> list[list]:
    head = f.data.head(SAMPLE_ROWS)
    cols = []
    for v in f.proposed:
        try:
            cols.append(coerce(head[v["name"]], v["dtype"], v["value_labels"]))
        except CoercionError:
            cols.append(head[v["name"]])
    if not cols:
        return []
    return frame_to_rows(pd.concat(cols, axis=1))


def file_preview(f: StagedFile) -> dict:
    r = f.read
    return {
        "file_id": f.file_id, "path": f.path, "name": f.name, "sha256": r.sha256,
        "size_bytes": len(r.raw_bytes), "format": r.format, "sheets": r.sheets, "sheet_name": r.sheet_name,
        "encoding": r.encoding, "delimiter": r.delimiter, "qualtrics": f.qualtrics, "n_rows": int(len(f.data)),
        "proposed_variables": f.proposed, "sample_rows": _sample_rows(f),
        "suggested_row_filters": f.row_filters, "suggested_scales": f.scales,
        "multiselect_candidates": list(f.multiselect), "issues": f.issues,
    }


def _existing_source(state) -> tuple[str, list[tuple[str, str | None]]]:
    time_var = (state.meta.get("stacking") or {}).get("time_variable")
    return state.meta["dataset_id"], [(v["name"], v["question_text"]) for v in state.meta["variables"]
                                      if v["name"] != time_var]


def stable_file_id(path: str, taken: set[str]) -> str:
    """Deterministic file id from the file's absolute path, so re-running a preview (e.g. after
    choosing another xlsx sheet) keeps the ids the UI keyed its decisions on. `taken` holds ids
    already in use (same path listed twice, or files already in the dataset being stacked onto)."""
    norm = os.path.normcase(os.path.abspath(path))
    base = "f_" + hashlib.sha256(norm.encode("utf-8")).hexdigest()[:12]
    fid, k = base, 2
    while fid in taken:
        fid, k = f"{base}_{k}", k + 1
    taken.add(fid)
    return fid


def preview(store: DatasetStore, params: dict) -> dict:
    onto = params.get("stack_onto_dataset_id")
    existing = store.get(onto) if onto else None
    mode = params["qualtrics_mode"]
    taken = ({onto} | {f["file_id"] for f in existing.meta["import_log"]["files"]}) if existing is not None else set()
    files = [stage_file(f["path"], sheet_name=f.get("sheet_name"), qualtrics_mode=mode,
                        file_id=stable_file_id(f["path"], taken)) for f in params["files"]]
    proposal, extra = None, []
    if len(files) >= 2 or existing is not None:
        sources = ([_existing_source(existing)] if existing is not None else []) + [
            (f.file_id, [(n, f.header.question_texts[j]) for j, n in enumerate(f.header.names)]) for f in files]
        proposal, extra = propose_matches(sources)
        files[0].issues.extend(extra)
    pv = Preview(preview_id=_new_id("pv"), qualtrics_mode=mode, files=files, stack_onto_dataset_id=onto,
                 stack_proposal=proposal, extra_issues=extra)
    store.preview = pv
    return {"preview_id": pv.preview_id, "files": [file_preview(f) for f in files], "stack_proposal": proposal}


def multiselect_indicator_variables(variable: dict, start_order: int | None = None) -> list[dict]:
    """Indicator VariableSchemas that request a multi-select split at import.

    Pass a proposed multi-select variable (its value_labels hold the options)."""
    order = variable["display_order"] + 1 if start_order is None else start_order
    out = []
    for k, vl in enumerate(variable["value_labels"]):
        option = str(vl["label"])
        v = {**variable, "name": f"{variable['name']}_{slug(option)}", "label": option,
             "question_text": f"{variable['question_text'] or variable['name']} - {option}",
             "dtype": "integer", "level": "nominal", "role": "unassigned",
             "value_labels": [{"value": 0, "label": "Not selected"}, {"value": 1, "label": "Selected"}],
             "response_range": None, "missing_codes": [], "is_pii": False, "pii_reason": None,
             "scale_id": None, "display_order": order + k}
        out.append(v)
    return out


# ---------------------------------------------------------------------------
# Commit
# ---------------------------------------------------------------------------
@dataclass
class Part:
    """One block of rows contributing to the assembled dataset."""
    ref_id: str                       # id used in ColumnMatch.columns[].file_id
    n_rows: int
    raw: pd.DataFrame | None = None   # new file: raw strings
    typed: pd.DataFrame | None = None  # existing dataset: typed frame
    proposals: dict[str, dict] = field(default_factory=dict)
    multiselect: dict[str, list[str]] = field(default_factory=dict)
    time_label: str | None = None
    staged: StagedFile | None = None


def _restage_if_needed(pv: Preview, decision: dict) -> StagedFile:
    f = pv.file(decision["file_id"])
    r = f.read
    changed = (
        (decision.get("sheet_name") is not None and decision["sheet_name"] != r.sheet_name)
        or (decision.get("encoding") is not None and decision["encoding"] != r.encoding)
        or (decision.get("delimiter") is not None and decision["delimiter"] != r.delimiter)
        or decision["qualtrics_header_rows"] != f.qualtrics["header_rows"]
    )
    if not changed:
        return f
    return stage_file(f.path, sheet_name=decision.get("sheet_name") or r.sheet_name,
                      encoding=decision.get("encoding") or r.encoding,
                      delimiter=decision.get("delimiter") or r.delimiter, qualtrics_mode=pv.qualtrics_mode,
                      header_rows=decision["qualtrics_header_rows"], file_id=f.file_id)


def _apply_filters(f: StagedFile, filters: list[dict], tally: dict[str, int]) -> pd.DataFrame:
    data = f.data
    keep = pd.Series(True, index=data.index)
    for flt in filters:
        if flt.get("file_id") not in (None, f.file_id):
            continue
        removed = qx.row_filter_mask(data, flt) & keep
        tally[flt["id"]] = tally.get(flt["id"], 0) + int(removed.sum())
        keep &= ~removed
    return data[keep].reset_index(drop=True)


def _prepare_parts(pv: Preview, decisions: list[dict], filters: list[dict]):
    parts, imported, dropped, tally = [], [], [], {}
    for d in decisions:
        f = _restage_if_needed(pv, d)
        data = _apply_filters(f, filters, tally)
        props = f.proposed_by_name
        for col in d.get("drop_columns") or []:
            if col not in data.columns:
                raise InvalidParams(f"Cannot drop '{col}': no such column in {f.name}.")
            dropped.append({"file_id": f.file_id, "column": col,
                            "reason": "pii" if props[col]["is_pii"] else "user"})
        data = data.drop(columns=list(d.get("drop_columns") or []))
        parts.append(Part(ref_id=f.file_id, n_rows=len(data), raw=data,
                          proposals={k: v for k, v in props.items() if k in data.columns},
                          multiselect={k: v for k, v in f.multiselect.items() if k in data.columns},
                          time_label=d.get("time_label"), staged=f))
        r = f.read
        imported.append({
            "file_id": f.file_id, "name": f.name, "sha256": r.sha256, "size_bytes": len(r.raw_bytes),
            "format": r.format, "encoding": r.encoding, "delimiter": r.delimiter, "sheet_name": r.sheet_name,
            "qualtrics": {**f.qualtrics, "confirmed": d["qualtrics_header_rows"] > 1},
            "time_label": d.get("time_label"), "n_rows_read": int(len(f.data)), "n_rows_kept": int(len(data)),
            "stored_path": f"originals/{f.file_id}/{f.name}", "imported_at": _now(),
        })
    applied = [{**flt, "rows_removed": tally.get(flt["id"], 0)} for flt in filters]
    return parts, imported, dropped, applied


def _unify(schemas: list[dict]) -> dict:
    base = dict(schemas[0])
    dtypes = {s["dtype"] for s in schemas}
    if len(dtypes) > 1:
        if dtypes <= {"integer", "float"}:
            base["dtype"], base["level"] = "float", "continuous"
        else:
            base.update(dtype="string", level="nominal", value_labels=[], response_range=None)
    codes = []
    for s in schemas:
        for c in s["missing_codes"]:
            if c not in codes:
                codes.append(c)
    base["missing_codes"] = codes
    base["is_metadata"] = any(s["is_metadata"] for s in schemas)
    pii = next((s for s in schemas if s["is_pii"]), None)
    base["is_pii"], base["pii_reason"] = (True, pii["pii_reason"]) if pii else (False, None)
    return base


def _na_series(dtype: str, n: int) -> pd.Series:
    if dtype == "integer":
        return pd.Series(pd.array([None] * n, dtype="Int64"))
    if dtype == "float":
        return pd.Series(np.full(n, np.nan))
    if dtype == "boolean":
        return pd.Series(pd.array([None] * n, dtype="boolean"))
    if dtype == "datetime":
        return pd.Series(np.full(n, np.datetime64("NaT"), dtype="datetime64[us]"))
    return pd.Series(pd.array([None] * n, dtype=STRING_DTYPE))


def _as_string(series: pd.Series) -> pd.Series:
    vals = [to_cell(v) for v in series.astype(object).tolist()]
    return pd.Series(pd.array([None if v is None else str(v) for v in vals], dtype=STRING_DTYPE))


def _resolve_overrides(specs: list[dict], parts: list[Part], user_vars: list[dict]):
    """Apply user-confirmed VariableSchemas; returns (specs, indicator requests)."""
    by_name = {s["schema"]["name"]: s for s in specs}
    by_source = {}
    for s in specs:
        for ref in s["refs"]:
            by_source[(ref["file_id"], ref["column"])] = s
    ms_by_source = {}
    for p in parts:
        for col, opts in p.multiselect.items():
            ms_by_source[(p.ref_id, col)] = opts
    indicators = []
    for uv in user_vars:
        if uv.get("computed") is not None:
            raise InvalidParams(f"'{uv['name']}': computed variables are created after import, not during it.")
        src = (uv.get("sources") or [None])[0]
        key = (src["file_id"], src["original_column_name"]) if src else None
        if key is not None and key not in by_source and len(parts) == 1:
            key = (parts[0].ref_id, key[1])  # single file: tolerate a stale file_id
        target = by_name.get(uv["name"])
        ms_spec = None
        if key is not None and key in by_source:
            cand = by_source[key]
            if key in ms_by_source and uv["name"] != cand["schema"]["name"]:
                opts = {o.casefold() for o in ms_by_source[key]}
                if (uv.get("label") or "").strip().casefold() in opts:
                    ms_spec = cand
        if ms_spec is not None and (target is None or target is ms_spec):
            indicators.append((ms_spec, uv))
            continue
        if target is None and key is not None:
            target = by_source.get(key)
        if target is None:
            raise InvalidParams(f"Variable '{uv['name']}' does not correspond to any imported column.")
        sch = target["schema"]
        for k in SCHEMA_FIELDS_FROM_USER:
            if k in uv:
                sch[k] = uv[k]
    return specs, indicators


def _assemble(parts: list[Part], matches: list[dict], user_vars: list[dict], time_variable: str | None):
    """Build (typed DataFrame without row ids, variables) from parts + matches."""
    part_by_ref = {p.ref_id: p for p in parts}
    specs = []
    for m in matches:
        refs = [r for r in m["columns"] if r["file_id"] in part_by_ref
                and r["column"] in (part_by_ref[r["file_id"]].raw.columns if part_by_ref[r["file_id"]].raw is not None
                                    else part_by_ref[r["file_id"]].typed.columns)]
        for r in m["columns"]:
            if r["file_id"] not in part_by_ref:
                raise InvalidParams(f"Column match '{m['variable']}' refers to unknown file '{r['file_id']}'.")
        if not refs:
            continue
        schemas = [part_by_ref[r["file_id"]].proposals[r["column"]] for r in refs]
        existing_ref = next((r for r in refs if part_by_ref[r["file_id"]].typed is not None), None)
        if existing_ref is not None:
            sch = dict(part_by_ref[existing_ref["file_id"]].proposals[existing_ref["column"]])
            sch["sources"] = list(sch["sources"])
            for s in schemas:
                if s is not part_by_ref[existing_ref["file_id"]].proposals[existing_ref["column"]]:
                    sch["sources"].extend(s["sources"])
        else:
            sch = _unify(schemas)
            sch["sources"] = [src for s in schemas for src in s["sources"]]
        sch["name"] = m["variable"]
        specs.append({"schema": sch, "refs": refs})

    specs, indicators = _resolve_overrides(specs, parts, user_vars)

    columns: dict[str, pd.Series] = {}
    variables = []
    for spec in specs:
        sch = spec["schema"]
        pieces = []
        for p in parts:
            ref = next((r for r in spec["refs"] if r["file_id"] == p.ref_id), None)
            if ref is None:
                pieces.append(None)
            elif p.typed is not None:
                pieces.append(p.typed[ref["column"]].reset_index(drop=True))
            else:
                try:
                    pieces.append(coerce(p.raw[ref["column"]], sch["dtype"], sch["value_labels"]))
                except CoercionError as exc:
                    if any(part_by_ref[r["file_id"]].typed is not None for r in spec["refs"]):
                        sch.update(dtype="string", level="nominal", value_labels=[], response_range=None)
                        pieces = None
                        break
                    dtype_word = {"integer": "whole numbers", "float": "numbers", "boolean": "true/false values",
                                  "datetime": "dates", "string": "text"}.get(sch["dtype"], sch["dtype"])
                    raise InvalidParams(f"Variable '{sch['name']}' is set to hold {dtype_word}, but some of its "
                                        f"values don't fit: {exc}.", variable=sch["name"]) from exc
        if pieces is None:  # widen an existing column to text
            pieces = []
            for p in parts:
                ref = next((r for r in spec["refs"] if r["file_id"] == p.ref_id), None)
                if ref is None:
                    pieces.append(None)
                elif p.typed is not None:
                    pieces.append(_as_string(p.typed[ref["column"]]))
                else:
                    pieces.append(coerce(p.raw[ref["column"]], "string"))
        full = [pc if pc is not None else _na_series(sch["dtype"], p.n_rows) for pc, p in zip(pieces, parts)]
        columns[sch["name"]] = pd.concat([s.reset_index(drop=True) for s in full], ignore_index=True)
        variables.append(sch)

    requested: dict[int, list[str]] = {}
    for spec, uv in indicators:
        requested.setdefault(id(spec), []).append(uv["label"].strip())
    for spec, uv in indicators:
        option = uv["label"].strip()
        sch = dict(uv)
        sch.update(dtype="integer", computed=None, sources=spec["schema"]["sources"])
        pieces = []
        for p in parts:
            ref = next((r for r in spec["refs"] if r["file_id"] == p.ref_id), None)
            if ref is None or p.raw is None:
                pieces.append(_na_series("integer", p.n_rows))
            else:
                # Greedy matching needs every known option, so "Other, please specify" is one choice.
                options = p.multiselect.get(ref["column"], []) + requested[id(spec)]
                pieces.append(multiselect_indicator(p.raw[ref["column"]], option, options).reset_index(drop=True))
        columns[sch["name"]] = pd.concat(pieces, ignore_index=True)
        variables.append(sch)

    if time_variable is not None:
        labels = []
        for p in parts:
            labels.extend([p.time_label] * p.n_rows)
        if time_variable in columns:
            raise InvalidParams(f"The time variable name '{time_variable}' is already used by a column.")
        order = []
        for p in parts:
            if p.time_label not in order:
                order.append(p.time_label)
        columns[time_variable] = pd.Series(pd.array(labels, dtype=STRING_DTYPE))
        variables.insert(0, {
            "schema_version": 1, "name": time_variable, "label": "Time point", "question_text": None,
            "role": "time", "level": "ordinal", "dtype": "string",
            "value_labels": [{"value": l, "label": l} for l in order], "reverse_coded": False,
            "response_range": None, "scale_id": None, "missing_codes": [], "sources": [],
            "is_metadata": False, "is_pii": False, "pii_reason": None, "computed": None, "display_order": -1,
        })

    names = [v["name"] for v in variables]
    dupes = sorted({n for n in names if names.count(n) > 1})
    if dupes:
        raise InvalidParams(f"Variable names must be unique; repeated: {', '.join(dupes)}.")
    if ROW_ID in names:
        raise InvalidParams(f"'{ROW_ID}' is reserved and can't be used as a variable name.")
    variables.sort(key=lambda v: v["display_order"])
    for i, v in enumerate(variables):
        v["display_order"] = i
    df = pd.DataFrame({v["name"]: columns[v["name"]] for v in variables})
    return df, variables


def _scales_for(variables: list[dict], suggestions: list[dict]) -> list[dict]:
    scales, seen = [], set()
    for s in suggestions:
        if s["id"] in seen:
            continue
        items = [v["name"] for v in variables if v.get("scale_id") == s["id"]]
        if len(items) >= 2:
            scales.append({**s, "items": items})
            seen.add(s["id"])
    for v in variables:
        if v.get("scale_id") and v["scale_id"] not in seen:
            v["scale_id"] = None
    return scales


def _validate_levels(levels: list[dict], valid_refs: set[str]) -> dict[str, str]:
    labels = {}
    for lvl in levels:
        if not str(lvl["label"]).strip():
            raise InvalidParams("Every time level needs a non-empty label.")
        labels[lvl["file_id"]] = lvl["label"]
    if len(set(labels.values())) != len(labels):
        raise InvalidParams("Time level labels must be different from each other.")
    unknown = set(labels) - valid_refs
    if unknown:
        raise InvalidParams(f"Time levels refer to unknown files: {', '.join(sorted(unknown))}.")
    return labels


def commit_import(store: DatasetStore, params: dict) -> dict:
    pv = store.get_preview(params["preview_id"])
    if pv.stack_onto_dataset_id is not None:
        raise InvalidParams("This preview was made for adding files to an existing dataset; use dataset.stack.")
    decisions = params["files"]
    stack = params.get("stack")
    if len(decisions) >= 2 and stack is None:
        raise InvalidParams("Importing several files at once requires stack settings (time labels and matching).")
    parts, imported, dropped, applied = _prepare_parts(pv, decisions, params["row_filters"])
    if stack is not None:
        labels = _validate_levels(stack["levels"], {p.ref_id for p in parts})
        missing = [p.ref_id for p in parts if p.ref_id not in labels]
        if missing:
            raise InvalidParams(f"Every stacked file needs a time label; missing for {', '.join(missing)}.")
        for p in parts:
            p.time_label = labels[p.ref_id]
        order = [lvl["file_id"] for lvl in stack["levels"]]
        parts.sort(key=lambda p: order.index(p.ref_id))
        for imp in imported:
            imp["time_label"] = labels[imp["file_id"]]
        matches = stack["column_matches"]
        referenced = {(r["file_id"], r["column"]) for m in matches for r in m["columns"]}
        for p in parts:
            for col in p.raw.columns:
                if (p.ref_id, col) not in referenced:
                    dropped.append({"file_id": p.ref_id, "column": col, "reason": "user"})
        time_variable = stack["time_variable"]
    else:
        p = parts[0]
        matches = [{"variable": c, "columns": [{"file_id": p.ref_id, "column": c}]} for c in p.raw.columns]
        time_variable = None
    df, variables = _assemble(parts, matches, params["variables"], time_variable)
    df.insert(0, ROW_ID, np.arange(len(df), dtype="int64"))
    suggestions = [s for p in parts for s in p.staged.scales]
    meta = {
        "schema_version": 1, "dataset_id": "", "snapshot_id": "", "n_rows": 0, "row_id_column": ROW_ID,
        "variables": variables, "scales": _scales_for(variables, suggestions),
        "import_log": {"files": imported, "row_filters": applied, "dropped_columns": dropped},
        "stacking": ({"time_variable": time_variable, "levels": stack["levels"]} if stack is not None else None),
        "link": {"mode": "aggregate", "id_variable": None, "normalization": None, "counts": None},
        "missing_summary": [],
    }
    originals = {p.ref_id: (p.staged.name, p.staged.read.raw_bytes) for p in parts}
    return store.commit(_new_id("ds"), df, meta, originals)


def commit_stack(store: DatasetStore, params: dict) -> dict:
    pv = store.get_preview(params["preview_id"])
    dataset_id = params["dataset_id"]
    state = store.get(dataset_id)
    if pv.stack_onto_dataset_id != dataset_id:
        raise StaleOrUnknown("This preview was not made for adding to that dataset. Preview the files again "
                             "with stack_onto_dataset_id set.", preview_id=params["preview_id"])
    meta = state.meta
    stack = params["stack"]
    old_stacking = meta.get("stacking")
    old_time = old_stacking["time_variable"] if old_stacking else None
    parts, imported, dropped, applied = _prepare_parts(pv, params["files"], params["row_filters"])

    existing_refs = {dataset_id} | {f["file_id"] for f in meta["import_log"]["files"]}
    labels = _validate_levels(stack["levels"], existing_refs | {p.ref_id for p in parts})
    for p in parts:
        if p.ref_id not in labels:
            raise InvalidParams(f"Every added file needs a time label; missing for {p.ref_id}.")
        p.time_label = labels[p.ref_id]
    for imp in imported:
        imp["time_label"] = labels[imp["file_id"]]

    df_old = state.df.reset_index(drop=True)
    variables_old = [v for v in meta["variables"] if v["name"] != old_time]
    if old_stacking:
        time_variable = old_time
        old_levels = list(old_stacking["levels"])
        time_col = df_old[old_time].astype(object)
        existing_parts = []
        for lvl in old_levels:
            mask = (time_col == lvl["label"]).to_numpy()
            existing_parts.append((lvl["label"], df_old[mask]))
        extra_mask = ~time_col.isin([lvl["label"] for lvl in old_levels]).to_numpy()
        if extra_mask.any():
            existing_parts.append((None, df_old[extra_mask]))
        new_levels = old_levels + [lvl for lvl in stack["levels"] if lvl["file_id"] in {p.ref_id for p in parts}]
    else:
        time_variable = stack["time_variable"]
        label = next((labels[r] for r in labels if r in existing_refs), None)
        if label is None:
            raise InvalidParams("Give the existing data a time label (a level whose file_id is the dataset id "
                                "or its imported file id).")
        existing_parts = [(label, df_old)]
        first_file = meta["import_log"]["files"][0]["file_id"] if meta["import_log"]["files"] else dataset_id
        new_levels = [{"file_id": first_file, "label": label}] + [
            lvl for lvl in stack["levels"] if lvl["file_id"] in {p.ref_id for p in parts}]
    if len({lvl["label"] for lvl in new_levels}) != len(new_levels):
        raise InvalidParams("Time level labels must be different from each other.")

    proposals_old = {v["name"]: v for v in variables_old}
    old_blocks = [Part(ref_id=dataset_id, n_rows=len(block), typed=block.reset_index(drop=True),
                       proposals=proposals_old, time_label=lbl) for lbl, block in existing_parts]
    matches = [dict(m) for m in stack["column_matches"]]
    referenced_old = {r["column"] for m in matches for r in m["columns"] if r["file_id"] == dataset_id}
    for v in variables_old:
        if v["name"] not in referenced_old:
            matches.append({"variable": v["name"], "columns": [{"file_id": dataset_id, "column": v["name"]}]})
    referenced_new = {(r["file_id"], r["column"]) for m in matches for r in m["columns"]}
    for p in parts:
        for col in p.raw.columns:
            if (p.ref_id, col) not in referenced_new:
                dropped.append({"file_id": p.ref_id, "column": col, "reason": "user"})

    # Existing rows come as one Part per old level (same ref id), so expand matches per block.
    all_parts = old_blocks + parts
    user_vars = list(params["variables"])
    old_order = {v["name"]: v["display_order"] for v in meta["variables"]}
    # Keep existing variables' metadata/order unless the user overrides them.
    df_new, variables = _assemble_blocks(all_parts, matches, user_vars, time_variable, old_order)
    old_ids = np.concatenate([b.typed[ROW_ID].to_numpy() for b in old_blocks]) if old_blocks else np.array([])
    start = int(df_old[ROW_ID].max()) + 1 if len(df_old) else 0
    n_new = sum(p.n_rows for p in parts)
    row_ids = np.concatenate([old_ids.astype("int64"), np.arange(start, start + n_new, dtype="int64")])
    df_new.insert(0, ROW_ID, row_ids)
    df_new = df_new.sort_values(ROW_ID, kind="stable").reset_index(drop=True)
    suggestions = list(meta["scales"]) + [s for p in parts for s in p.staged.scales]
    link = meta["link"]
    new_meta = {
        **meta,
        "variables": variables,
        "scales": _scales_for(variables, suggestions),
        "import_log": {
            "files": meta["import_log"]["files"] + imported,
            "row_filters": meta["import_log"]["row_filters"] + applied,
            "dropped_columns": meta["import_log"]["dropped_columns"] + dropped,
        },
        "stacking": {"time_variable": time_variable, "levels": new_levels},
    }
    if link["mode"] == "linked":
        counts, _ = link_report(df_new, link["id_variable"], time_variable,
                                [lvl["label"] for lvl in new_levels], link["normalization"])
        new_meta["link"] = {**link, "counts": counts}
    originals = dict(state.originals)
    originals.update({p.ref_id: (p.staged.name, p.staged.read.raw_bytes) for p in parts})
    return store.commit(dataset_id, df_new, new_meta, originals)


def _assemble_blocks(parts, matches, user_vars, time_variable, old_order):
    """_assemble for dataset.stack: several Parts may share the existing dataset ref id."""
    # Give each existing block a unique ref and duplicate match refs accordingly.
    blocks = [p for p in parts if p.typed is not None]
    ds_ref = blocks[0].ref_id if blocks else None
    for i, b in enumerate(blocks):
        b.ref_id = f"{ds_ref}#{i}"
    expanded = []
    for m in matches:
        cols = []
        for r in m["columns"]:
            if r["file_id"] == ds_ref:
                cols.extend({"file_id": b.ref_id, "column": r["column"]} for b in blocks)
            else:
                cols.append(r)
        expanded.append({**m, "columns": cols})
    uvars = []
    for uv in user_vars:
        uv = dict(uv)
        srcs = uv.get("sources") or []
        if srcs and srcs[0].get("file_id") == ds_ref and blocks:
            uv["sources"] = [{**srcs[0], "file_id": blocks[0].ref_id}] + list(srcs[1:])
        uvars.append(uv)
    df, variables = _assemble(parts, expanded, uvars, time_variable)
    # Existing variables keep their display order; new ones follow.
    base = max(old_order.values(), default=-1) + 1
    for v in variables:
        v["display_order"] = old_order.get(v["name"], base + v["display_order"])
    variables.sort(key=lambda v: v["display_order"])
    for i, v in enumerate(variables):
        v["display_order"] = i
    df = df[[v["name"] for v in variables]]
    return df, variables
