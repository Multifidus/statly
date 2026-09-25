"""DatasetStore: the RPC session's only stateful object.

Holds committed datasets (typed DataFrame + DatasetMeta dict + original file
bytes), the latest staged import preview, and the session's autosave paths.
All transformations elsewhere are pure; `commit` stamps a new snapshot_id.
Parquet encoding is deterministic (fixed Arrow types, no pandas metadata) so a
save -> load -> save cycle yields byte-identical data.
"""

from __future__ import annotations

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


@dataclass
class DatasetState:
    meta: dict
    df: pd.DataFrame  # variables + ROW_ID
    originals: dict[str, tuple[str, bytes]] = field(default_factory=dict)  # file_id -> (name, bytes)
    results: dict[str, bytes] = field(default_factory=dict)  # zip path -> bytes, carried through save/load


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
               originals: dict[str, tuple[str, bytes]], results: dict[str, bytes] | None = None) -> dict:
        """Recompute derived meta (n_rows, missing summary, snapshot id) and store."""
        meta = dict(meta)
        meta["dataset_id"] = dataset_id
        meta["n_rows"] = int(len(df))
        meta["row_id_column"] = ROW_ID
        meta["missing_summary"] = missing_summary(df, meta["variables"])
        meta["snapshot_id"] = compute_snapshot_id(df, meta)
        prev = self.datasets.get(dataset_id)
        self.datasets[dataset_id] = DatasetState(
            meta=meta, df=df, originals=originals,
            results=results if results is not None else (prev.results if prev else {}))
        return meta


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
