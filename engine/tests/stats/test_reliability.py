"""reliability.* reproduces the R reference fixtures (fixtures/r/reliability.R): 1e-6, omega 1e-4."""

from __future__ import annotations

import numpy as np
import pytest

from statly_engine.errors import InvalidParams
from statly_engine.stats import registry
from statly_engine.stats import reliability as rel

from .conftest import TOL, assert_matches_fixture, close, fixture_paths, load_data, load_fixture, request_for, run_fixture

OMEGA_TOL = 1e-4
HEYWOOD_TOL = 5e-3   # psych's Heywood solutions stop on an L-BFGS-B line-search failure (fixtures/r/reliability.R)
ALPHA = fixture_paths("reliability.cronbach_alpha") + fixture_paths("reliability.kr20")
OMEGA = fixture_paths("reliability.mcdonald_omega")
SPLIT = fixture_paths("reliability.split_half")
ITEMS = fixture_paths("reliability.item_analysis")
_id = lambda p: f"{p.parent.name}/{p.stem}"  # noqa: E731


def test_inventory():
    assert len(ALPHA) >= 7 and len(OMEGA) >= 4 and len(SPLIT) >= 4 and len(ITEMS) >= 2


@pytest.mark.parametrize("path", ALPHA, ids=_id)
def test_alpha_matches_psych(path):
    fx = load_fixture(path)
    res = run_fixture(fx)
    exp = fx["expected"]
    assert_matches_fixture(res, fx)
    got = {r["item"]: r for r in res["chart_data"]["item_statistics"]}
    assert set(got) == {e["item"] for e in exp["items"]}
    for e in exp["items"]:
        g, w = got[e["item"]], f"{fx['case']}/{e['item']}"
        assert g["n"] == e["n"], w
        for k in ("mean", "sd", "r_drop", "alpha_if_deleted", "std_alpha_if_deleted"):
            if k in e:
                close(g[k], e[k], TOL, f"{w}.{k}")
    if exp["deleted_items"]:
        assert any(w["code"] == "zero_variance_items" for w in res["warnings"])
    assert res["apa_table"] and res["apa_sentence"] and res["plain_language_summary"]


@pytest.mark.parametrize("path", OMEGA, ids=_id)
def test_omega_matches_psych(path):
    fx = load_fixture(path)
    res = run_fixture(fx)
    tol = HEYWOOD_TOL if fx["expected"]["heywood"] else OMEGA_TOL
    assert_matches_fixture(res, fx, tol=tol)
    got = {r["item"]: r for r in res["chart_data"]["loadings"]}
    for e in fx["expected"]["loadings"]:
        close(got[e["item"]]["loading"], e["loading"], tol, f"{fx['case']}/{e['item']}.loading")
    if fx["expected"]["heywood"]:
        assert any(w["code"] == "heywood_case" for w in res["warnings"])
    assert sorted(r["item"] for r in got.values() if r["flipped"]) == sorted(fx["expected"]["flipped"])


@pytest.mark.parametrize("path", SPLIT, ids=_id)
def test_split_half_matches_r(path):
    fx = load_fixture(path)
    assert_matches_fixture(run_fixture(fx), fx)


@pytest.mark.parametrize("path", ITEMS, ids=_id)
def test_item_analysis_matches_r(path):
    fx = load_fixture(path)
    res = run_fixture(fx)
    assert_matches_fixture(res, fx)
    got = {r["item"]: r for r in res["chart_data"]["item_analysis"]}
    for e in fx["expected"]["items"]:
        for k in ("difficulty", "r_pb_corrected", "d_index"):
            close(got[e["item"]][k], e[k], TOL, f"{fx['case']}/{e['item']}.{k}")


def test_kr20_equals_alpha_on_binary_items():
    x = load_data("reliability_test20.csv").to_numpy(float)
    k = x.shape[1]
    p = x.mean(axis=0)
    kr20 = k / (k - 1) * (1 - np.sum(p * (1 - p)) / np.var(x.sum(axis=1)))
    assert rel.alpha_analysis(x)["alpha"] == pytest.approx(kr20, abs=1e-12)


def test_kr20_and_item_analysis_reject_non_binary_items():
    fx = load_fixture(fixture_paths("reliability.cronbach_alpha")[0])
    for aid in ("reliability.kr20", "reliability.item_analysis"):
        req = request_for(fx)
        req["analysis_id"] = aid
        with pytest.raises(InvalidParams):
            registry.run(load_data(fx["dataset"]), req)


def test_unreversed_items_warn():
    fx = load_fixture(next(p for p in fixture_paths("reliability.cronbach_alpha") if p.stem == "unreversed_items"))
    res = run_fixture(fx)
    assert any(w["code"] == "reverse_scoring" for w in res["warnings"])


def test_phase3_families_via_rpc(engine):
    """analysis.run through the real stdio server on the practice Likert scale (pre + post stacked)."""
    from .test_rpc_analysis import _import_stacked, _request
    meta = _import_stacked(engine, "one_group_prepost_likert")
    ids = {a["analysis_id"] for a in engine.call("analysis.list")["analyses"]}
    assert {"correlation.matrix", "chi_square.independence", "reliability.cronbach_alpha",
            "reliability.mcdonald_omega", "cochran_q"} <= ids
    items = [f"Q3_{i}" for i in (1, 2, 4, 5, 6, 7, 9, 10)]
    res = engine.call("analysis.run", _request(meta, "reliability.cronbach_alpha", {"items": items}))
    assert res["statistics"][0]["key"] == "cronbach_alpha" and 0 < res["statistics"][0]["value"] < 1
    res = engine.call("analysis.run", _request(meta, "correlation.matrix", {"variables": items[:4]},
                                               corrections=[{"scope": "matrix", "method": "holm"}]))
    assert len(res["chart_data"]["correlation_pairs"]) == 6
    res = engine.call("analysis.run", _request(meta, "chi_square.independence", {"row": ["Time"], "column": ["Q3_1"]}))
    assert res["statistics"][0]["key"] == "chi2"
