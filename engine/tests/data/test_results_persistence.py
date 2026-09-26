"""Phase 6 (SPEC §9): full Test Log results live in the .statly zip as results/<id>.json, reopen
without re-running (`results.get`), and family/correction fields survive save/load and autosave."""

from __future__ import annotations

import json
import zipfile

import pytest

from statly_engine.contracts import ProjectFile
from statly_engine.data import project as proj
from statly_engine.data.store import DatasetStore
from statly_engine.errors import InvalidParams, StaleOrUnknown
from statly_engine.rpc_methods import session_handlers

from ._helpers import MESSY, PRACTICE, import_single
from .test_project import frontend_project

EXAMPLES = PRACTICE.parents[1] / "contracts" / "examples"
RESULT = json.loads((EXAMPLES / "AnalysisResult.json").read_text())
ENTRY = json.loads((EXAMPLES / "TestLogEntry.json").read_text())
RESULT.pop("$schema", None)
ENTRY.pop("$schema", None)


def _entry(eid: str, meta: dict | None, *, family=None, method="none", adjusted=None) -> dict:
    e = json.loads(json.dumps(ENTRY))
    e["id"] = eid
    e["request"]["request_id"] = eid
    if meta is not None:
        e["request"]["dataset_id"], e["request"]["snapshot_id"] = meta["dataset_id"], meta["snapshot_id"]
    e.update(result_path=None, family_id=family, correction_method=method, adjusted_p=adjusted)
    return e


def _result(eid: str) -> dict:
    r = json.loads(json.dumps(RESULT))
    r["plain_language_summary"] = f"Result {eid}"
    return r


@pytest.fixture
def logged(store):
    meta = import_single(store, MESSY / "messy_3header.csv")
    h = session_handlers()
    for eid in ("r1", "r2", "r3"):
        assert h["results.put"](store, {"request_id": eid, "result": _result(eid)})["result_path"] == f"results/{eid}.json"
    project = frontend_project(meta)
    project["test_log"] = [_entry("r1", meta, family="fam1", method="holm", adjusted=0.06),
                           _entry("r2", meta, family="fam1", method="holm", adjusted=0.06),
                           _entry("r3", meta)]
    project["test_families"] = [{"id": "fam1", "name": "Attitude items"}]
    return meta, project


def test_save_load_roundtrip_with_results(store, logged, tmp_path):
    _, project = logged
    path = tmp_path / "log.statly"
    saved = session_handlers()["project.save"](store, {"path": str(path), "project": project})["project"]
    assert [e["result_path"] for e in saved["test_log"]] == ["results/r1.json", "results/r2.json", "results/r3.json"]
    with zipfile.ZipFile(path) as zf:
        assert {"results/r1.json", "results/r2.json", "results/r3.json"} <= set(zf.namelist())
        assert json.loads(zf.read("results/r2.json")) == _result("r2")

    fresh = DatasetStore()
    loaded = session_handlers()["project.load"](fresh, {"path": str(path)})["project"]
    ProjectFile.model_validate(loaded)
    assert loaded["test_families"] == [{"id": "fam1", "name": "Attitude items"}]
    by_id = {e["id"]: e for e in loaded["test_log"]}
    assert by_id["r1"]["family_id"] == "fam1" and by_id["r1"]["correction_method"] == "holm"
    assert by_id["r1"]["adjusted_p"] == 0.06 and by_id["r3"]["family_id"] is None
    assert all(e["result_path"] == f"results/{e['id']}.json" for e in loaded["test_log"])
    # Reopening a past run returns the stored result; nothing is re-run.
    assert session_handlers()["results.get"](fresh, {"request_id": "r1"})["result"] == _result("r1")


def test_results_get_unknown_and_unsafe_ids(store):
    h = session_handlers()
    with pytest.raises(StaleOrUnknown):
        h["results.get"](store, {"request_id": "nope"})
    with pytest.raises(InvalidParams):
        h["results.put"](store, {"request_id": "../x", "result": _result("x")})
    with pytest.raises(InvalidParams):  # result must match the AnalysisResult contract
        h["results.put"](store, {"request_id": "x", "result": {"bogus": 1}})


def test_only_logged_results_are_written(store, logged, tmp_path):
    _, project = logged
    session_handlers()["results.put"](store, {"request_id": "unlogged", "result": _result("unlogged")})
    project["test_log"] = project["test_log"][:1] + [_entry("missing", None)]
    path = tmp_path / "subset.statly"
    saved = proj.save(store, str(path), project, "0.1.0")["project"]
    assert [e["result_path"] for e in saved["test_log"]] == ["results/r1.json", None]
    with zipfile.ZipFile(path) as zf:
        assert sorted(n for n in zf.namelist() if n.startswith("results/")) == ["results/r1.json"]


def test_autosave_includes_results_and_planner_only(store, tmp_path):
    # Dataset-free (planner-only) project: results are still written.
    session_handlers()["results.put"](store, {"request_id": "pw", "result": _result("pw")})
    project = frontend_project(None)
    project["test_log"] = [_entry("pw", None)]
    a = proj.autosave(store, str(tmp_path / "auto"), None, project, "0.1.0")
    with zipfile.ZipFile(a["autosave_path"]) as zf:
        assert "results/pw.json" in zf.namelist()
    fresh = DatasetStore()
    loaded = proj.load(fresh, a["autosave_path"])
    assert loaded["is_autosave"] and loaded["project"]["test_log"][0]["result_path"] == "results/pw.json"
    assert proj.get_result(fresh, "pw")["result"] == _result("pw")
