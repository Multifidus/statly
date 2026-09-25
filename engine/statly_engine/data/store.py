"""DatasetStore: the RPC session's only stateful object.

Holds committed datasets (typed DataFrame + DatasetMeta dict + original file
bytes), the latest staged import preview, and the session's autosave paths.
All transformations elsewhere are pure; `commit` stamps a new snapshot_id.
Parquet encoding is deterministic (fixed Arrow types, no pandas metadata) so a
save -> load -> save cycle yields byte-identical data.
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import io
import json
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from statly_engine.data.columns import STRING_DTYPE
from statly_engine.data.missing import missing_summary
from statly_engine.errors import StaleOrUnknown

ROW_ID = "_statly_row_id"
ARROW_TYPES = {
    "integer": pa.int64(),
    "float": pa.float64(),
    "string": pa.string(),
    "boolean": pa.bool_(),
    "datetime": pa.timestamp("us"),
}


# Snapshots kept with their data for undo/redo; older entries keep only their label.
MAX_RESTORABLE = 50


@dataclass
class HistoryEntry:
    """One snapshot in a dataset's edit history (undo/redo is a pointer into this list)."""
    snapshot_id: str
    label: str
    timestamp: str
    meta: dict | None = None        # None = label only (older than MAX_RESTORABLE, or loaded from a file)
    df: pd.DataFrame | None = None

    @property
    def restorable(self) -> bool:
        return self.meta is not None

    def describe(self) -> dict:
        return {"snapshot_id": self.snapshot_id, "label": self.label, "timestamp": self.timestamp,
                "restorable": self.restorable}


@dataclass
class DatasetState:
    meta: dict
    df: pd.DataFrame  # variables + ROW_ID
    originals: dict[str, tuple[str, bytes]] = field(default_factory=dict)  # file_id -> (name, bytes)
    results: dict[str, bytes] = field(default_factory=dict)  # zip path -> bytes, carried through save/load
    history: list[HistoryEntry] = field(default_factory=list)
    cursor: int = -1  # index of the current snapshot in history

    def ensure_history(self, label: str = "Opened data") -> None:
        if not self.history:
            self.history = [HistoryEntry(self.meta["snapshot_id"], label, _now(), self.meta, self.df)]
            self.cursor = 0

    def history_labels(self) -> list[dict]:
        """What a saved project keeps: labels up to the current entry (the redo tail is dropped);
        only the current snapshot's data is saved."""
        self.ensure_history()
        return [{"snapshot_id": e.snapshot_id, "label": e.label, "timestamp": e.timestamp,
                 "current": i == self.cursor} for i, e in enumerate(self.history[:self.cursor + 1])]

    def load_history_labels(self, labels: list[dict] | None) -> None:
        """Rebuild history after project load: the current snapshot is restorable, the rest are labels."""
        self.history, self.cursor = [], -1
        if labels:
            cur = self.meta["snapshot_id"]
            for i, e in enumerate(labels):
                is_cur = e.get("snapshot_id") == cur and (e.get("current") or self.cursor < 0)
                entry = HistoryEntry(str(e.get("snapshot_id")), str(e.get("label", "")),
                                     str(e.get("timestamp", "")))
                if is_cur:
                    entry.meta, entry.df, self.cursor = self.meta, self.df, i
                self.history.append(entry)
            if self.cursor < 0:  # current snapshot not listed: append it
                self.history.append(HistoryEntry(cur, "Opened project", _now(), self.meta, self.df))
                self.cursor = len(self.history) - 1
            else:
                del self.history[self.cursor + 1:]
        self.ensure_history("Opened project")


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat()


@dataclass
class DatasetStore:
    datasets: dict[str, DatasetState] = field(default_factory=dict)
    preview: object | None = None  # importer.Preview (latest only)
    autosave_paths: dict[str, str] = field(default_factory=dict)  # project_id -> autosave path

    def get(self, dataset_id: str) -> DatasetState:
        state = self.datasets.get(dataset_id)
        if state is None:
            raise StaleOrUnknown(f"No dataset with id '{dataset_id}' is loaded.", dataset_id=dataset_id)
        return state

    def get_preview(self, preview_id: str):
        if self.preview is None or self.preview.preview_id != preview_id:
            raise StaleOrUnknown(
                "That import preview is no longer available (a newer preview replaced it or the engine "
                "restarted). Please preview the file again.", preview_id=preview_id)
        return self.preview

    def commit(self, dataset_id: str, df: pd.DataFrame, meta: dict,
               originals: dict[str, tuple[str, bytes]], results: dict[str, bytes] | None = None,
               label: str | None = None) -> dict:
        """Recompute derived meta (n_rows, missing summary, snapshot id), store, and record history.

        A commit whose content equals the current snapshot is a no-op (no new history entry).
        Committing after an undo drops the redo tail. Snapshot ids stay unique within a
        dataset's history (a repeat of earlier content gets a `_2`, `_3`, ... suffix) so the
        app can address every undo/redo position by id.
        """
        meta = dict(meta)
        meta["dataset_id"] = dataset_id
        meta["n_rows"] = int(len(df))
        meta["row_id_column"] = ROW_ID
        meta["missing_summary"] = missing_summary(df, meta["variables"])
        snap = compute_snapshot_id(df, meta)
        prev = self.datasets.get(dataset_id)
        history: list[HistoryEntry] = []
        if prev is not None:
            prev.ensure_history()
            if prev.meta["snapshot_id"].split("__")[0] == snap and prev.df.columns.equals(df.columns):
                return prev.meta
            history = prev.history[:prev.cursor + 1]
        taken = {e.snapshot_id for e in history}
        unique, k = snap, 1
        while unique in taken:
            k += 1
            unique = f"{snap}__{k}"
        meta["snapshot_id"] = unique
        default = "Updated the dataset" if prev is not None else "Imported data"
        history.append(HistoryEntry(unique, label or default, _now(), meta, df))
        for old in history[:-MAX_RESTORABLE]:
            old.meta, old.df = None, None
        self.datasets[dataset_id] = DatasetState(
            meta=meta, df=df, originals=originals,
            results=results if results is not None else (prev.results if prev else {}),
            history=history, cursor=len(history) - 1)
        return meta

    def restore(self, dataset_id: str, snapshot_id: str) -> dict:
        """Move the undo/redo pointer to `snapshot_id` and make it current."""
        state = self.get(dataset_id)
        state.ensure_history()
        for i, e in enumerate(state.history):
            if e.snapshot_id == snapshot_id:
                if not e.restorable:
                    raise StaleOrUnknown(
                        "That earlier version is no longer available to go back to (only the most recent "
                        "changes of this session can be undone).", snapshot_id=snapshot_id)
                state.meta, state.df, state.cursor = e.meta, e.df, i
                return state.meta
        raise StaleOrUnknown("That version isn't in this dataset's history.", snapshot_id=snapshot_id)


def compute_snapshot_id(df: pd.DataFrame, meta: dict) -> str:
    """Content id of data + variable metadata (stable across save/load)."""
    h = hashlib.sha256()
    h.update(json.dumps(list(df.columns)).encode())
    h.update(json.dumps([str(t) for t in df.dtypes]).encode())
    if len(df):
        h.update(pd.util.hash_pandas_object(df, index=False).to_numpy().tobytes())
    body = {k: v for k, v in meta.items() if k not in ("snapshot_id",)}
    h.update(json.dumps(body, sort_keys=True, default=str).encode())
    return "snap_" + h.hexdigest()[:24]


def empty_frame(n: int) -> pd.DataFrame:
    return pd.DataFrame({ROW_ID: np.arange(n, dtype="int64")})


# ---------------------------------------------------------------------------
# Parquet
# ---------------------------------------------------------------------------
def to_parquet_bytes(df: pd.DataFrame, variables: list[dict]) -> bytes:
    arrays, names = [pa.array(df[ROW_ID].to_numpy(dtype="int64"), type=pa.int64())], [ROW_ID]
    for v in variables:
        col = df[v["name"]]
        typ = ARROW_TYPES[v["dtype"]]
        arrays.append(pa.array(col, type=typ, from_pandas=True))
        names.append(v["name"])
    table = pa.Table.from_arrays(arrays, names=names).replace_schema_metadata(None)
    buf = io.BytesIO()
    pq.write_table(table, buf, compression="zstd", store_schema=False)
    return buf.getvalue()


def from_parquet_bytes(data: bytes, variables: list[dict]) -> pd.DataFrame:
    table = pq.read_table(io.BytesIO(data))
    cols = {ROW_ID: table.column(ROW_ID).to_numpy().astype("int64")}
    for v in variables:
        arr = table.column(v["name"])
        dtype = v["dtype"]
        if dtype == "integer":
            cols[v["name"]] = pd.array(arr.to_pylist(), dtype="Int64")
        elif dtype == "float":
            cols[v["name"]] = arr.to_numpy(zero_copy_only=False).astype("float64")
        elif dtype == "boolean":
            cols[v["name"]] = pd.array(arr.to_pylist(), dtype="boolean")
        elif dtype == "datetime":
            cols[v["name"]] = arr.to_pandas().astype("datetime64[us]").to_numpy()
        else:
            cols[v["name"]] = pd.array(arr.to_pylist(), dtype=STRING_DTYPE)
    return pd.DataFrame(cols)
