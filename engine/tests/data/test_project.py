"""`.statly` save/load round-trip, autosave + crash recovery (SPEC §13 Phase 1 acceptance)."""

from __future__ import annotations

import json
import os
import time
import zipfile

import pandas as pd
import pytest

from statly_engine.contracts import ProjectFile
from statly_engine.data import project as proj
from statly_engine.data.store import DatasetStore
from statly_engine.errors import IncompatibleProject, InvalidParams, StaleOrUnknown

from ._helpers import MESSY, PRACTICE, import_single

EXAMPLE = PRACTICE.parents[1] / "contracts" / "examples" / "ProjectFile.json"


def frontend_project(meta: dict | None, project_id: str = "8f0c2a4e-1b7d-4c1e-9a55-2f6f3c1d9e01") -> dict:
    p = json.loads(EXAMPLE.read_text())
    p.pop("$schema", None)
    p.update(project_id=project_id, name="Messy survey", dataset_meta=meta,
             data_path="data/dataset.parquet" if meta else None,
             test_log=[], test_families=[], chart_specs=[], tag_codebook=None, study_plan=None)
    return p


def _zip_bytes(path, member) -> bytes:
    with zipfile.ZipFile(path) as zf:
        return zf.read(member)


def test_messy_roundtrip_unchanged(store, tmp_path):
    meta = import_single(store, MESSY / "messy_3header.csv")
    df0 = store.get(meta["dataset_id"]).df
    path = tmp_path / "study.statly"
    res = proj.save(store, str(path), frontend_project(meta), "0.1.0")
    ProjectFile.model_validate(res["project"])
    assert res["size_bytes"] == path.stat().st_size and not (tmp_path / "study.statly.tmp").exists()

    with zipfile.ZipFile(path) as zf:
        names = set(zf.namelist())
        assert all(i.compress_type == zipfile.ZIP_DEFLATED for i in zf.infolist())
    stored = meta["import_log"]["files"][0]["stored_path"]
    assert {"project.json", "data/dataset.parquet", stored} <= names and "autosave.json" not in names
    assert _zip_bytes(path, stored) == (MESSY / "messy_3header.csv").read_bytes()  # byte-identical original

    fresh = DatasetStore()
    loaded = proj.load(fresh, str(path))
    assert loaded["is_autosave"] is False and loaded["autosave_marker"] is None
    assert loaded["project"]["dataset_meta"] == meta  # identical DatasetMeta (incl. snapshot_id)
    df1 = fresh.get(meta["dataset_id"]).df
    pd.testing.assert_frame_equal(df1, df0, check_exact=True)

    path2 = tmp_path / "again.statly"
    proj.save(fresh, str(path2), loaded["project"], "0.1.0")
    assert _zip_bytes(path2, "data/dataset.parquet") == _zip_bytes(path, "data/dataset.parquet")
    assert json.loads(_zip_bytes(path2, "project.json"))["dataset_meta"] == meta


def test_save_unknown_dataset_and_planner_only(store, tmp_path):
    fake = {"dataset_id": "ds_missing"}
    with pytest.raises(StaleOrUnknown):
        proj.save(store, str(tmp_path / "x.statly"), frontend_project(fake), "0.1.0")
    res = proj.save(store, str(tmp_path / "plan.statly"), frontend_project(None), "0.1.0")
    assert res["project"]["dataset_meta"] is None
    loaded = proj.load(DatasetStore(), str(tmp_path / "plan.statly"))
    assert loaded["project"]["data_path"] is None


def test_newer_schema_version_is_incompatible(store, tmp_path):
    path = tmp_path / "future.statly"
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("project.json", json.dumps({**frontend_project(None), "schema_version": 2}))
    with pytest.raises(IncompatibleProject):
        proj.load(store, str(path))


def test_autosave_recover_and_discard(store, tmp_path):
    meta = import_single(store, MESSY / "messy_2header.csv")
    auto_dir = tmp_path / "autosave"
    saved_path = tmp_path / "study.statly"
    project = frontend_project(meta)

    # Never-saved project: autosave is recoverable.
    a = proj.autosave(store, str(auto_dir), None, project, "0.1.0")
    assert a["autosave_path"].endswith(f"{project['project_id']}.statly")
    rec = proj.recoverable(str(auto_dir))["autosaves"]
    assert len(rec) == 1 and rec[0]["marker"]["original_path"] is None

    loaded = proj.load(DatasetStore(), a["autosave_path"])
    assert loaded["is_autosave"] and loaded["autosave_marker"]["project_id"] == project["project_id"]
    assert loaded["project"]["dataset_meta"] == meta

    # A real save deletes this project's autosave.
    proj.save(store, str(saved_path), project, "0.1.0")
    assert not os.path.exists(a["autosave_path"])
    assert proj.recoverable(str(auto_dir))["autosaves"] == []

    # Autosave newer than the saved original -> offered; older -> not offered.
    time.sleep(0.01)
    a = proj.autosave(store, str(auto_dir), str(saved_path), project, "0.1.0")
    assert len(proj.recoverable(str(auto_dir))["autosaves"]) == 1
    future = time.time() + 60
    os.utime(saved_path, (future, future))
    assert proj.recoverable(str(auto_dir))["autosaves"] == []

    # Discard deletes the autosave; refuses to delete a real project file.
    assert proj.discard_autosave(store, a["autosave_path"]) == {"ok": True}
    assert not os.path.exists(a["autosave_path"])
    with pytest.raises(InvalidParams):
        proj.discard_autosave(store, str(saved_path))
    assert saved_path.exists()
    with pytest.raises(InvalidParams):
        proj.autosave(store, str(auto_dir), None, {**project, "project_id": "../escape"}, "0.1.0")
