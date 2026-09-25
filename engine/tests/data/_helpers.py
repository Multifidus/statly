"""Shared helpers for the data-layer tests (fixtures/practice is read-only)."""

from __future__ import annotations

import json
from pathlib import Path

from statly_engine.data import importer
from statly_engine.data.store import DatasetStore

REPO = Path(__file__).resolve().parents[3]
PRACTICE = REPO / "fixtures" / "practice"
MESSY = PRACTICE / "messy_qualtrics"
MESSY_FILES = ["messy_3header.csv", "messy_2header.csv", "messy_utf16.csv", "messy_text_choices.csv",
               "messy.xlsx"]


def ground_truth(dataset: str) -> dict:
    return json.loads((PRACTICE / dataset / "ground_truth.json").read_text())


def preview(store: DatasetStore, *paths, mode: str = "auto", onto: str | None = None, sheet=None) -> dict:
    return importer.preview(store, {
        "files": [{"path": str(p), "sheet_name": sheet} for p in paths],
        "qualtrics_mode": mode, "stack_onto_dataset_id": onto,
    })


def decision(fp: dict, *, drop=(), time_label=None, header_rows=None) -> dict:
    return {
        "file_id": fp["file_id"], "sheet_name": fp["sheet_name"], "encoding": fp["encoding"],
        "delimiter": fp["delimiter"],
        "qualtrics_header_rows": header_rows or fp["qualtrics"]["header_rows"],
        "time_label": time_label, "drop_columns": list(drop),
    }


def import_single(store: DatasetStore, path, *, filters=(), drop=(), variables=(), mode="auto") -> dict:
    pv = preview(store, path, mode=mode)
    fp = pv["files"][0]
    return importer.commit_import(store, {
        "preview_id": pv["preview_id"], "files": [decision(fp, drop=drop)],
        "row_filters": list(filters), "variables": list(variables), "stack": None,
    })


def stack_config(pv: dict, labels: list[str], time_variable: str = "Time") -> dict:
    return {
        "time_variable": time_variable,
        "levels": [{"file_id": f["file_id"], "label": lbl} for f, lbl in zip(pv["files"], labels)],
        "column_matches": pv["stack_proposal"],
    }

