"""SPEC §12: 5,000 rows x 300 columns imports in under 5 seconds."""

from __future__ import annotations

import time

import numpy as np
import pytest

from statly_engine.data import importer
from statly_engine.data.store import DatasetStore

from ._helpers import decision


@pytest.mark.slow
def test_import_5000_by_300_under_5s(tmp_path, capsys):
    rng = np.random.default_rng(12)
    n, n_int, n_float, n_text = 5000, 250, 40, 10
    cols = ([f"item_{i}" for i in range(n_int)] + [f"meas_{i}" for i in range(n_float)]
            + [f"text_{i}" for i in range(n_text)])
    ints = rng.integers(1, 6, size=(n, n_int)).astype(str)
    floats = np.round(rng.normal(50, 10, size=(n, n_float)), 3).astype(str)
    words = np.array(["alpha", "beta", "gamma", "delta", "epsilon"])
    texts = np.char.add(np.char.add(words[rng.integers(0, 5, size=(n, n_text))], " "),
                        rng.integers(0, 1000, size=(n, n_text)).astype(str))
    body = np.concatenate([ints, floats, texts], axis=1)
    path = tmp_path / "big.csv"
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(",".join(cols) + "\n")
        fh.write("\n".join(",".join(row) for row in body.tolist()) + "\n")

    store = DatasetStore()
    t0 = time.perf_counter()
    pv = importer.preview(store, {"files": [{"path": str(path), "sheet_name": None}], "qualtrics_mode": "auto",
                                  "stack_onto_dataset_id": None})
    meta = importer.commit_import(store, {"preview_id": pv["preview_id"], "files": [decision(pv["files"][0])],
                                          "row_filters": [], "variables": [], "stack": None})
    elapsed = time.perf_counter() - t0
    with capsys.disabled():
        print(f"\n[perf] 5000x300 CSV preview+import: {elapsed:.2f}s")
    assert meta["n_rows"] == n and len(meta["variables"]) == 300
    assert elapsed < 5.0
