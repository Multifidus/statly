"""dataset.* RPC handlers."""

from __future__ import annotations

from statly_engine.contracts import Rpc
from statly_engine.data import importer
from statly_engine.data.columns import frame_to_rows
from statly_engine.data.linking import link_report
from statly_engine.data.store import DatasetStore
from statly_engine.errors import InvalidParams, StaleOrUnknown
from statly_engine.rpc_methods import rpc_method

DEFAULT_NORMALIZATION = {"trim_whitespace": True, "case_insensitive": True}


@rpc_method(Rpc.DatasetImportPreviewParams, Rpc.DatasetImportPreviewResult)
def import_preview(store: DatasetStore, params: dict) -> dict:
    return importer.preview(store, params)


@rpc_method(Rpc.DatasetImportParams, Rpc.DatasetResult)
def import_(store: DatasetStore, params: dict) -> dict:
    return {"dataset_meta": importer.commit_import(store, params)}


@rpc_method(Rpc.DatasetStackParams, Rpc.DatasetResult)
def stack(store: DatasetStore, params: dict) -> dict:
    return {"dataset_meta": importer.commit_stack(store, params)}


@rpc_method(Rpc.DatasetLinkParams, Rpc.DatasetLinkResult)
def link(store: DatasetStore, params: dict) -> dict:
    state = store.get(params["dataset_id"])
    meta = state.meta
    if params["mode"] == "aggregate":
        new_link = {"mode": "aggregate", "id_variable": None, "normalization": None, "counts": None}
        report = None
    else:
        stacking = meta.get("stacking")
        if not stacking:
            raise InvalidParams("Linking needs a dataset with several time points (stack files first).")
        id_var = params.get("id_variable")
        if not id_var or id_var not in state.df.columns or id_var == stacking["time_variable"]:
            raise InvalidParams(f"Choose an ID variable that exists in the dataset (got {id_var!r}).")
        norm = params.get("normalization") or DEFAULT_NORMALIZATION
        levels = [lvl["label"] for lvl in stacking["levels"]]
        counts, report = link_report(state.df, id_var, stacking["time_variable"], levels, norm)
        new_link = {"mode": "linked", "id_variable": id_var, "normalization": norm, "counts": counts}
    new_meta = store.commit(meta["dataset_id"], state.df, {**meta, "link": new_link}, state.originals)
    return {"dataset_meta": new_meta, "report": report}


@rpc_method(Rpc.DatasetRowsParams, Rpc.DatasetRowsResult)
def rows(store: DatasetStore, params: dict) -> dict:
    state = store.get(params["dataset_id"])
    meta = state.meta
    snap = params.get("snapshot_id")
    if snap is not None and snap != meta["snapshot_id"]:
        raise StaleOrUnknown("The data changed since this view was loaded; refresh to see the current rows.",
                             snapshot_id=meta["snapshot_id"])
    names = [v["name"] for v in sorted(meta["variables"], key=lambda v: v["display_order"])]
    cols = params.get("columns") or names
    unknown = [c for c in cols if c not in names]
    if unknown:
        raise InvalidParams(f"Unknown columns: {', '.join(unknown)}.")
    df = state.df
    sort = params.get("sort")
    if sort is not None:
        if sort["variable"] not in names:
            raise InvalidParams(f"Unknown sort variable '{sort['variable']}'.")
        order = df[sort["variable"]].sort_values(ascending=not sort["descending"], na_position="last",
                                                 kind="stable").index
        df = df.loc[order]
    off, lim = params["offset"], params["limit"]
    page = df.iloc[off:off + lim]
    return {
        "snapshot_id": meta["snapshot_id"], "offset": off, "total_rows": int(len(state.df)), "columns": cols,
        "row_ids": [int(x) for x in page["_statly_row_id"].tolist()], "rows": frame_to_rows(page[cols]),
    }


@rpc_method(Rpc.DatasetIdParams, Rpc.DatasetMissingSummaryResult)
def missing_summary(store: DatasetStore, params: dict) -> dict:
    meta = store.get(params["dataset_id"]).meta
    return {"snapshot_id": meta["snapshot_id"], "missing_summary": meta["missing_summary"]}


METHODS = {
    "dataset.import_preview": import_preview,
    "dataset.import": import_,
    "dataset.stack": stack,
    "dataset.link": link,
    "dataset.rows": rows,
    "dataset.missing_summary": missing_summary,
}
