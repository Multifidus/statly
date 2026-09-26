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
from statly_engine.errors import FileUnreadable, IncompatibleProject, InvalidParams, StaleOrUnknown

SUPPORTED_SCHEMA_VERSION = 1
DATA_PATH = "data/dataset.parquet"
PROJECT_JSON = "project.json"
AUTOSAVE_JSON = "autosave.json"
HISTORY_JSON = "history.json"  # edit-history labels (undo/redo); data is kept for the current snapshot only
RESULTS_DIR = "results/"  # results/<entry_id>.json: full AnalysisResult per Test Log entry (Phase 6)
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


def result_path(entry_id: str) -> str:
    return f"{RESULTS_DIR}{entry_id}.json"


def attach_results(store: DatasetStore, project: dict) -> tuple[dict, dict[str, bytes]]:
    """Point every Test Log entry whose full result the engine holds at results/<id>.json.

    Returns (project with result_path set, {zip path: result JSON bytes}). Entries whose result
    the engine does not hold (never pushed via `results.put`) keep result_path null."""
    files: dict[str, bytes] = {}
    log = []
    for entry in project.get("test_log") or []:
        entry = dict(entry)
        eid = entry.get("id")
        data = store.results.get(eid) if isinstance(eid, str) and _SAFE_ID_RE.match(eid) else None
        if data is not None:
            entry["result_path"] = result_path(eid)
            files[entry["result_path"]] = data
        else:
            entry["result_path"] = None
        log.append(entry)
    return {**project, "test_log": log}, files


def write_statly(path: str, project: dict, state: DatasetState | None, marker: dict | None = None,
                 results: dict[str, bytes] | None = None) -> int:
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
                    zf.writestr(HISTORY_JSON, json.dumps(state.history_labels(), indent=2, ensure_ascii=False))
                for rpath, data in sorted((results or {}).items()):
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


def read_statly(path: str) -> tuple[dict, DatasetState | None, dict | None, dict[str, bytes]]:
    """Returns (project dict, dataset state or None, autosave marker or None,
    {request_id: full AnalysisResult JSON bytes} for results/<id>.json members)."""
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
        results = {n[len(RESULTS_DIR):-len(".json")]: zf.read(n) for n in names
                   if n.startswith(RESULTS_DIR) and n.endswith(".json")}
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
            state = DatasetState(meta=meta, df=df, originals=originals)
            labels = None
            if HISTORY_JSON in names:
                try:
                    labels = json.loads(zf.read(HISTORY_JSON))
                except ValueError:
                    labels = None  # labels are non-essential; a damaged list is dropped
            state.load_history_labels(labels if isinstance(labels, list) else None)
    return raw, state, marker, results


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
    from statly_engine.data.tags import attach_codebook  # Phase 9: engine-held tag codebook

    state = _state_for(store, project)
    out, results = attach_results(store, attach_codebook(store, build_project(project, state, engine_version)))
    size = write_statly(path, out, state, results=results)
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
    from statly_engine.data.tags import attach_codebook  # Phase 9: engine-held tag codebook

    state = _state_for(store, project)
    out, results = attach_results(store, attach_codebook(store, build_project(project, state, engine_version)))
    target = autosave_path(autosave_dir, project["project_id"])
    marker = {"schema_version": 1, "project_id": project["project_id"], "original_path": original_path,
              "saved_at": out["modified_at"]}
    write_statly(str(target), out, state, marker, results=results)
    store.autosave_paths[project["project_id"]] = str(target)
    return {"autosave_path": str(target), "saved_at": marker["saved_at"]}


def put_result(store: DatasetStore, request_id: str, result: dict) -> dict:
    """Hold a logged run's full AnalysisResult so save/autosave can write it into the zip."""
    if not _SAFE_ID_RE.match(request_id):
        raise InvalidParams("request_id may only contain letters, digits, '.', '_' and '-'.")
    store.results[request_id] = json.dumps(result, ensure_ascii=False).encode("utf-8")
    return {"ok": True, "result_path": result_path(request_id)}


def get_result(store: DatasetStore, request_id: str) -> dict:
    """A stored result (from `results.put` or a loaded project); reopening never re-runs."""
    data = store.results.get(request_id)
    if data is None:
        raise StaleOrUnknown("That result isn't stored in this project.", request_id=request_id)
    return {"result": json.loads(data)}


def load(store: DatasetStore, path: str) -> dict:
    project, state, marker, results = read_statly(path)
    store.results.update(results)
    project = {**project, "test_log": [
        {**e, "result_path": result_path(e["id"]) if e.get("id") in results else None}
        for e in project.get("test_log") or []]}
    if state is not None:
        from statly_engine.data.tags import restore_codebook  # Phase 9: tag codebook becomes live

        store.datasets[state.meta["dataset_id"]] = state
        restore_codebook(store, project)
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
