"""Shared helpers for the R reference-fixture tests (SPEC §12; fixtures/r/*.R -> fixtures/expected/).

`assert_matches_fixture(result, fixture, tol)` walks the fixture's `expected` block and compares
every named number with the engine's AnalysisResult: statistics by key (the first expected one
must also be the headline), effect sizes by key (value + CI bounds), descriptives by
(variable, group), frequency tables by (variable, group), assumptions by (test key, scope), and
n_used / n_excluded. Differences are |a - b| <= tol * max(1, |b|). The largest deviation seen is
reported in the pytest terminal summary.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import pandas as pd
import pytest

from statly_engine.stats import registry

REPO = Path(__file__).resolve().parents[3]
EXPECTED = REPO / "fixtures" / "expected"
DATA = EXPECTED / "data"
TOL = 1e-6

_MAX = {"abs": 0.0, "where": "", "checked": 0}
_EFFECTSIZE_OPTIM = {"abs": 0.0, "where": ""}


def fixture_paths(analysis_dir: str) -> list[Path]:
    return sorted((EXPECTED / analysis_dir).glob("*.json"))


def load_fixture(path: Path | str) -> dict:
    fx = json.loads(Path(path).read_text())
    fx["_path"] = str(path)
    return fx


def load_data(name: str) -> pd.DataFrame:
    return pd.read_csv(DATA / name)


def request_for(fx: dict) -> dict:
    r = fx["request"]
    return {"schema_version": 1, "request_id": f"fixture-{fx['case']}", "analysis_id": fx["analysis_id"],
            "dataset_id": "fixture", "snapshot_id": "snap_fixture", "variables": r["variables"],
            "subset": [], "options": r.get("options") or {}, "corrections": [], "alpha": r.get("alpha", 0.05),
            "tails": r.get("tails", "two_sided"), "ci_level": r.get("ci_level", 0.95)}


def run_fixture(fx: dict) -> dict:
    return registry.run(load_data(fx["dataset"]), request_for(fx))


def close(got, want, tol: float, where: str) -> None:
    if want is None:
        assert got is None, f"{where}: expected null, got {got}"
        return
    assert got is not None, f"{where}: expected {want}, got null"
    diff = abs(float(got) - float(want))
    _MAX["checked"] += 1
    if diff > _MAX["abs"]:
        _MAX["abs"], _MAX["where"] = diff, where
    assert diff <= tol * max(1.0, abs(float(want))), f"{where}: got {got!r}, R {want!r} (|diff| = {diff:.3g})"


def _same_group(a: dict, b: dict) -> bool:
    if set(a) != set(b):
        return False
    return all(str(a[k]) == str(b[k]) or (_num(a[k]) is not None and _num(a[k]) == _num(b[k])) for k in a)


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _scope_matches(applies_to: dict, scope: str) -> bool:
    if scope in ("differences", "overall"):
        return applies_to["kind"] == scope
    return applies_to["kind"] == "group" and applies_to["label"] == scope


def match_assumption(results: list[dict], rec: dict, tol: float, where: str) -> None:
    hits = [a for a in results if a["test_used"] and a["test_used"]["key"] == rec["test"]
            and _scope_matches(a["applies_to"], rec["scope"])]
    assert len(hits) == 1, f"{where}: no unique {rec['test']} result for scope {rec['scope']!r}"
    a = hits[0]
    w = f"{where}/{rec['test']}[{rec['scope']}]"
    assert a["applies_to"]["n"] == rec["n"], f"{w}: n {a['applies_to']['n']} != {rec['n']}"
    close(a["statistic"]["value"] if a["statistic"] else None, rec["statistic"], tol, w + ".statistic")
    close(a["p"], rec["p"], tol, w + ".p")
    if rec["statistic"] is not None:
        assert len(a["statistic"]["df"]) == len(rec["df"]), f"{w}: df length"
        for g, e in zip(a["statistic"]["df"], rec["df"]):
            close(g, e, tol, w + ".df")


def assert_matches_fixture(result: dict, fixture: "dict | Path | str", tol: float = TOL) -> None:
    fx = fixture if isinstance(fixture, dict) else load_fixture(fixture)
    exp = fx["expected"]
    where = f"{fx['analysis_id']}/{fx['case']}"

    for k in ("n_used", "n_excluded"):
        if k in exp:
            assert result["inputs"][k] == exp[k], f"{where}: {k} {result['inputs'][k]} != {exp[k]}"

    if exp.get("statistics"):
        assert result["statistics"][0]["key"] == exp["statistics"][0]["key"], f"{where}: headline statistic"
    for s in exp.get("statistics", []):
        hits = [r for r in result["statistics"] if r["key"] == s["key"] and r["term"] == s["term"]]
        assert len(hits) == 1, f"{where}: statistic {s['key']} missing"
        got, w = hits[0], f"{where}/statistic {s['key']}"
        close(got["value"], s["value"], tol, w + ".value")
        close(got["p"], s["p"], tol, w + ".p")
        assert len(got["df"]) == len(s["df"]), f"{w}: df length"
        for g, e in zip(got["df"], s["df"]):
            close(g, e, tol, w + ".df")

    for e in exp.get("effect_sizes", []):
        hits = [r for r in result["effect_sizes"] if r["key"] == e["key"]]
        assert len(hits) == 1, f"{where}: effect size {e['key']} missing"
        got, w = hits[0], f"{where}/effect {e['key']}"
        close(got["value"], e["value"], tol, w + ".value")
        ci = got["ci"] or {"lower": None, "upper": None}
        close(ci["lower"], e["ci_lower"], tol, w + ".ci_lower")
        close(ci["upper"], e["ci_upper"], tol, w + ".ci_upper")
        for side, key in (("lower", "effectsize_ci_lower"), ("upper", "effectsize_ci_upper")):
            if e.get(key) is not None and ci[side] is not None:
                d = abs(ci[side] - e[key])
                if d > _EFFECTSIZE_OPTIM["abs"]:
                    _EFFECTSIZE_OPTIM.update(abs=d, where=f"{w}.{side}")

    for d in exp.get("descriptives", []):
        hits = [r for r in result["descriptives"]["continuous"]
                if r["variable"] == d["variable"] and _same_group(r["group"], d["group"])]
        assert len(hits) == 1, f"{where}: descriptives for {d['variable']} {d['group']} missing"
        got, w = hits[0], f"{where}/descriptives {d['variable']} {d['group']}"
        assert got["n"] == d["n"] and got["n_missing"] == d["n_missing"], f"{w}: n/n_missing"
        for k in ("mean", "sd", "se", "median", "q1", "q3", "iqr", "min", "max", "skewness", "kurtosis"):
            close(got[k], d[k], tol, f"{w}.{k}")
        ci = got["ci"] or {"lower": None, "upper": None}
        close(ci["lower"], d["ci_lower"], tol, w + ".ci_lower")
        close(ci["upper"], d["ci_upper"], tol, w + ".ci_upper")

    for f in exp.get("frequencies", []):
        hits = [t for t in result["descriptives"]["frequencies"]
                if t["variable"] == f["variable"] and _same_group(t["group"], f["group"])]
        assert len(hits) == 1, f"{where}: frequency table {f['variable']} missing"
        got = hits[0]["levels"]
        assert [lv["value"] for lv in got] == [lv["value"] for lv in f["levels"]], f"{where}: frequency levels"
        for g, e in zip(got, f["levels"]):
            w = f"{where}/freq {f['variable']}={e['value']}"
            assert g["count"] == e["count"], w
            close(g["percent"], e["percent"], tol, w + ".percent")
            close(g["valid_percent"], e["valid_percent"], tol, w + ".valid_percent")

    for rec in exp.get("assumptions", []):
        match_assumption(result["assumptions"], rec, tol, where)


def pytest_terminal_summary(terminalreporter):
    if _MAX["checked"]:
        terminalreporter.write_line(
            f"R fixtures: {_MAX['checked']} numbers compared; max |diff| = {_MAX['abs']:.3g} ({_MAX['where']})")
    if _EFFECTSIZE_OPTIM["abs"]:
        terminalreporter.write_line(
            f"  (reference CIs are exact inversions; effectsize's optim-based bounds differ by up to "
            f"{_EFFECTSIZE_OPTIM['abs']:.3g} at {_EFFECTSIZE_OPTIM['where']})")
