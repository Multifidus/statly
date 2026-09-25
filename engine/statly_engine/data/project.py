"""`.statly` project files: zip save/load, autosave, crash recovery (contracts/README.md).

Layout: project.json, data/dataset.parquet, originals/<file_id>/<name>,
results/<entry_id>.json, autosave.json (autosave copies only).
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import re
import zipfile
from pathlib import Path, PurePosixPath

from statly_engine.contracts import ProjectFile
from statly_engine.contracts._gen.ProjectFile import AutosaveMarker
from statly_engine.data.store import DatasetState, DatasetStore, from_parquet_bytes, to_parquet_bytes
from statly_engine.errors import FileUnreadable, IncompatibleProject, InvalidParams

SUPPORTED_SCHEMA_VERSION = 1
DATA_PATH = "data/dataset.parquet"
PROJECT_JSON = "project.json"
AUTOSAVE_JSON = "autosave.json"
_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")


def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat()


def _safe_name(name: str) -> str:
    base = PurePosixPath(name.replace("\\", "/")).name
    return base or "file"


def build_project(project: dict, state: DatasetState | None, engine_version: str) -> dict:
    """Frontend project with the engine's authoritative dataset_meta substituted."""
    out = dict(project)
    out["engine_version"] = engine_version
    out["modified_at"] = now_iso()
    if state is None:
        out["dataset_meta"], out["data_path"] = None, None
    else:
        out["dataset_meta"], out["data_path"] = state.meta, DATA_PATH
    return out


def write_statly(path: str, project: dict, state: DatasetState | None, marker: dict | None = None) -> int:
    """Atomic write: <path>.tmp, fsync, rename. Returns the final size in bytes."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(target.name + ".tmp")
    try:
        with open(tmp, "wb") as fh:
            with zipfile.ZipFile(fh, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                zf.writestr(PROJECT_JSON, json.dumps(project, indent=2, ensure_ascii=False))
                if state is not None:
                    zf.writestr(DATA_PATH, to_parquet_bytes(state.df, state.meta["variables"]))
                    for f in state.meta["import_log"]["files"]:
                        orig = state.originals.get(f["file_id"])
                        if orig is not None:
                            zf.writestr(f["stored_path"], orig[1])
                    for rpath, data in state.results.items():
                        zf.writestr(rpath, data)
                if marker is not None:
                    zf.writestr(AUTOSAVE_JSON, json.dumps(marker, indent=2))
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, target)
    except OSError as exc:
        tmp.unlink(missing_ok=True)
        raise FileUnreadable(f"Could not write the project to {path}: {exc.strerror}.", path=path) from exc
    return target.stat().st_size


def read_statly(path: str) -> tuple[dict, DatasetState | None, dict | None]:
    """Returns (project dict, dataset state or None, autosave marker or None)."""
    try:
        zf = zipfile.ZipFile(path)
    except FileNotFoundError as exc:
        raise FileUnreadable(f"We couldn't find the project file {path}.", path=path) from exc
    except (zipfile.BadZipFile, OSError) as exc:
        raise FileUnreadable("This is not a Statly project file, or it is damaged.", path=path) from exc
    with zf:
        names = set(zf.namelist())
        if PROJECT_JSON not in names:
            raise FileUnreadable("This is not a Statly project file (project.json is missing).", path=path)
        try:
            raw = json.loads(zf.read(PROJECT_JSON))
        except ValueError as exc:
            raise FileUnreadable("The project file is damaged (project.json is not valid JSON).", path=path) from exc
        check_versions(raw)
        from pydantic import ValidationError

        try:
            ProjectFile.model_validate(raw)
        except ValidationError as exc:
            raise FileUnreadable("The project file is damaged or incomplete.", path=path,
                                 errors=json.loads(exc.json(include_url=False))) from exc
        marker = json.loads(zf.read(AUTOSAVE_JSON)) if AUTOSAVE_JSON in names else None
        state = None
        meta = raw.get("dataset_meta")
        if meta is not None:
            data_path = raw.get("data_path") or DATA_PATH
            if data_path not in names:
                raise FileUnreadable("The project file is missing its data.", path=path)
            df = from_parquet_bytes(zf.read(data_path), meta["variables"])
            originals = {}
            for f in meta["import_log"]["files"]:
                if f["stored_path"] in names:
                    originals[f["file_id"]] = (f["name"], zf.read(f["stored_path"]))
            results = {n: zf.read(n) for n in names if n.startswith("results/")}
            state = DatasetState(meta=meta, df=df, originals=originals, results=results)
    return raw, state, marker


def check_versions(raw: dict) -> None:
    versions = [raw.get("schema_version")]
    meta = raw.get("dataset_meta")
    if isinstance(meta, dict):
        versions.append(meta.get("schema_version"))
    for v in versions:
        if isinstance(v, int) and v > SUPPORTED_SCHEMA_VERSION:
            raise IncompatibleProject(
                "This project was saved by a newer version of Statly. Please update Statly to open it.",
                schema_version=v, supported=SUPPORTED_SCHEMA_VERSION)


def _state_for(store: DatasetStore, project: dict) -> DatasetState | None:
    meta = project.get("dataset_meta")
    return store.get(meta["dataset_id"]) if meta is not None else None


def save(store: DatasetStore, path: str, project: dict, engine_version: str) -> dict:
    state = _state_for(store, project)
    out = build_project(project, state, engine_version)
    size = write_statly(path, out, state)
    autosave = store.autosave_paths.pop(project["project_id"], None)
    if autosave and Path(autosave).resolve() != Path(path).resolve():
        Path(autosave).unlink(missing_ok=True)
    return {"path": str(path), "saved_at": out["modified_at"], "size_bytes": size, "project": out}


def autosave_path(autosave_dir: str, project_id: str) -> Path:
    if not _SAFE_ID_RE.match(project_id):
        raise InvalidParams("project_id may only contain letters, digits, '.', '_' and '-'.")
    return Path(autosave_dir) / f"{project_id}.statly"


def autosave(store: DatasetStore, autosave_dir: str, original_path: str | None, project: dict,
             engine_version: str) -> dict:
    state = _state_for(store, project)
    out = build_project(project, state, engine_version)
    target = autosave_path(autosave_dir, project["project_id"])
    marker = {"schema_version": 1, "project_id": project["project_id"], "original_path": original_path,
              "saved_at": out["modified_at"]}
    write_statly(str(target), out, state, marker)
    store.autosave_paths[project["project_id"]] = str(target)
    return {"autosave_path": str(target), "saved_at": marker["saved_at"]}


def load(store: DatasetStore, path: str) -> dict:
    project, state, marker = read_statly(path)
    if state is not None:
        store.datasets[state.meta["dataset_id"]] = state
    if marker is not None:
        store.autosave_paths[project["project_id"]] = str(path)
    return {"project": project, "is_autosave": marker is not None, "autosave_marker": marker}


def read_marker(path: Path) -> dict | None:
    try:
        with zipfile.ZipFile(path) as zf:
            if AUTOSAVE_JSON not in zf.namelist():
                return None
            marker = json.loads(zf.read(AUTOSAVE_JSON))
        AutosaveMarker.model_validate(marker)
        return marker
    except (OSError, zipfile.BadZipFile, ValueError):
        return None


def recoverable(autosave_dir: str) -> dict:
    """Autosaves newer than their original file (or with no original on disk)."""
    d = Path(autosave_dir)
    found = []
    if d.is_dir():
        for p in sorted(d.glob("*.statly")):
            marker = read_marker(p)
            if marker is None:
                continue
            orig = marker.get("original_path")
            saved = _dt.datetime.fromisoformat(marker["saved_at"])
            if orig and Path(orig).exists():
                orig_mtime = _dt.datetime.fromtimestamp(Path(orig).stat().st_mtime, _dt.timezone.utc)
                if saved <= orig_mtime:
                    continue
            found.append({"autosave_path": str(p), "marker": marker})
    found.sort(key=lambda a: a["marker"]["saved_at"], reverse=True)
    return {"autosaves": found}


def discard_autosave(store: DatasetStore, autosave_path_: str) -> dict:
    p = Path(autosave_path_)
    if not p.exists():
        return {"ok": True}
    marker = read_marker(p)
    if marker is None:
        # Safety: never delete a real project file through this method.
        raise InvalidParams("That file is not a Statly autosave, so it was not deleted.")
    p.unlink()
    for pid, ap in list(store.autosave_paths.items()):
        if Path(ap) == p:
            del store.autosave_paths[pid]
    return {"ok": True}
