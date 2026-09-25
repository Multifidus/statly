"""export.* RPC handlers (Phase 8, SPEC §10.3). See docs/PROTOCOL.md "Exports".

- export.table_html {apa_table, number?}                               -> {html, plain_text}
- export.report     {title, author?, results, include?, charts?, format: docx|pdf, path, overwrite?}
- export.data       {dataset_id, format: xlsx|csv, path, include_metadata_columns?, options?, overwrite?}
- export.codebook   {dataset_id, format: xlsx|docx, path, overwrite?}
- export.test_log   {entries, format: xlsx|csv|docx, path, overwrite?}
File-writing methods return {path, bytes} (export.data adds n_rows, n_columns, pii_columns).

Params are validated here (there is no Rpc.json entry yet); AnalysisResult / TestLogEntry / ApaTable
payloads are validated with the generated contract models. Stored project results are not read from
the store yet: the app passes the AnalysisResult objects it wants in the report.
"""

from __future__ import annotations

import base64
import binascii
import json

from pydantic import ValidationError

from statly_engine.contracts import AnalysisResult, TestLogEntry
from statly_engine.contracts._gen.AnalysisResult import ApaTable
from statly_engine.data.store import DatasetStore
from statly_engine.errors import InvalidParams
from statly_engine.export import atomic_write, check_target
from statly_engine.export import codebook as codebook_mod
from statly_engine.export import data as data_mod
from statly_engine.export import html as html_mod
from statly_engine.export import report as report_mod
from statly_engine.export import testlog as testlog_mod

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
INCLUDE_KEYS = ("tables", "sentences", "assumptions", "charts")


def _validate(model, value, what: str) -> None:
    try:
        model.model_validate(value)
    except ValidationError as exc:
        raise InvalidParams(f"{what} doesn't match the contract.",
                            errors=json.loads(exc.json(include_url=False))) from exc


def _format(params: dict, allowed: tuple[str, ...]) -> str:
    fmt = params.get("format")
    if fmt not in allowed:
        raise InvalidParams(f"format must be one of: {', '.join(allowed)} (got {fmt!r}).")
    return fmt


def _overwrite(params: dict) -> bool:
    ow = params.get("overwrite", False)
    if not isinstance(ow, bool):
        raise InvalidParams("overwrite must be true or false.")
    return ow


def _written(target, size: int) -> dict:
    return {"path": str(target), "bytes": size}


def table_html(store: DatasetStore, params: dict) -> dict:
    table = params.get("apa_table")
    _validate(ApaTable, table, "apa_table")
    number = params.get("number")
    if number is not None and (not isinstance(number, int) or isinstance(number, bool) or number < 1):
        raise InvalidParams("number must be a positive integer or null.")
    return {"html": html_mod.table_html(table, number), "plain_text": html_mod.table_plain_text(table, number)}


def _charts(raw) -> dict[str, dict]:
    if raw is None:
        return {}
    if not isinstance(raw, list):
        raise InvalidParams("charts must be a list of {request_id, png_base64, title?, note?}.")
    out = {}
    for i, c in enumerate(raw):
        if not isinstance(c, dict) or not isinstance(c.get("request_id"), str) \
                or not isinstance(c.get("png_base64"), str):
            raise InvalidParams(f"charts[{i}] needs a request_id and a png_base64 string.")
        b64 = c["png_base64"]
        if b64.startswith("data:"):
            b64 = b64.split(",", 1)[-1]
        try:
            png = base64.b64decode(b64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise InvalidParams(f"charts[{i}].png_base64 is not valid base64.") from exc
        if not png.startswith(PNG_SIGNATURE):
            raise InvalidParams(f"charts[{i}] is not a PNG image.")
        for k in ("title", "note"):
            if c.get(k) is not None and not isinstance(c[k], str):
                raise InvalidParams(f"charts[{i}].{k} must be text.")
        out[c["request_id"]] = {"png": png, "title": c.get("title"), "note": c.get("note")}
    return out


def report(store: DatasetStore, params: dict) -> dict:
    fmt = _format(params, ("docx", "pdf"))
    title = params.get("title")
    if not isinstance(title, str) or not title.strip():
        raise InvalidParams("The report needs a title.")
    author = params.get("author")
    if author is not None and not isinstance(author, str):
        raise InvalidParams("author must be text or null.")
    results = params.get("results")
    if not isinstance(results, list) or not results:
        raise InvalidParams("Choose at least one analysis to include in the report.")
    for i, r in enumerate(results):
        _validate(AnalysisResult, r, f"results[{i}]")
    include = params.get("include") or {}
    if not isinstance(include, dict) or any(k not in INCLUDE_KEYS or not isinstance(v, bool)
                                            for k, v in include.items()):
        raise InvalidParams(f"include takes true/false for: {', '.join(INCLUDE_KEYS)}.")
    charts = _charts(params.get("charts"))
    target = check_target(params.get("path"), fmt, _overwrite(params))
    secs = report_mod.sections(results, include, charts)
    writer = report_mod.write_docx if fmt == "docx" else report_mod.write_pdf
    size = atomic_write(target, lambda p: writer(p, title.strip(), author, secs))
    return _written(target, size)


def data(store: DatasetStore, params: dict) -> dict:
    fmt = _format(params, ("xlsx", "csv"))
    state = store.get(params.get("dataset_id"))
    options = params.get("options") or {}
    if not isinstance(options, dict):
        raise InvalidParams("options must be an object.")
    flags = {"label_row": False, "blank_missing_codes": True, "exclude_pii": False}
    for k, v in options.items():
        if k not in flags or not isinstance(v, bool):
            raise InvalidParams(f"options takes true/false for: {', '.join(flags)}.")
        flags[k] = v
    include_meta = params.get("include_metadata_columns", False)
    if not isinstance(include_meta, bool):
        raise InvalidParams("include_metadata_columns must be true or false.")
    target = check_target(params.get("path"), fmt, _overwrite(params))
    variables = data_mod.select_variables(state.meta, include_meta, flags["exclude_pii"])
    if not variables:
        raise InvalidParams("There are no columns to export with these settings.")
    df = state.df
    size = atomic_write(target, lambda p: data_mod.write(p, fmt, df, variables, flags["label_row"],
                                                         flags["blank_missing_codes"]))
    return {**_written(target, size), "snapshot_id": state.meta["snapshot_id"], "n_rows": int(len(df)),
            "n_columns": len(variables), "pii_columns": [v["name"] for v in variables if v.get("is_pii")]}


def codebook(store: DatasetStore, params: dict) -> dict:
    fmt = _format(params, ("xlsx", "docx"))
    meta = store.get(params.get("dataset_id")).meta
    target = check_target(params.get("path"), fmt, _overwrite(params))
    writer = codebook_mod.write_xlsx if fmt == "xlsx" else codebook_mod.write_docx
    size = atomic_write(target, lambda p: writer(p, meta))
    return _written(target, size)


def test_log(store: DatasetStore, params: dict) -> dict:
    fmt = _format(params, ("xlsx", "csv", "docx"))
    entries = params.get("entries")
    if not isinstance(entries, list):
        raise InvalidParams("entries must be a list of Test Log entries.")
    for i, e in enumerate(entries):
        _validate(TestLogEntry, e, f"entries[{i}]")
    target = check_target(params.get("path"), fmt, _overwrite(params))
    size = atomic_write(target, lambda p: testlog_mod.write(p, fmt, entries))
    return _written(target, size)


METHODS = {
    "export.table_html": table_html,
    "export.report": report,
    "export.data": data,
    "export.codebook": codebook,
    "export.test_log": test_log,
}
