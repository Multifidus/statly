"""correlation.* reproduces the R reference fixtures (fixtures/r/correlation.R) within 1e-6."""

from __future__ import annotations

import pytest

from statly_engine.errors import InvalidParams
from statly_engine.stats import correlation as corr
from statly_engine.stats import registry

from .conftest import TOL, assert_matches_fixture, close, fixture_paths, load_data, load_fixture, request_for, run_fixture

DIRS = ["correlation.pearson", "correlation.spearman", "correlation.kendall_tau_b", "correlation.point_biserial",
        "correlation.partial"]
CASES = [p for d in DIRS for p in fixture_paths(d)]
MATRIX = fixture_paths("correlation.matrix")


def test_inventory():
    assert len(CASES) >= 35 and len(MATRIX) >= 5


@pytest.mark.parametrize("path", CASES, ids=lambda p: f"{p.parent.name}/{p.stem}")
def test_bivariate_matches_r(path):
    fx = load_fixture(path)
    res = run_fixture(fx)
    if fx["expected"] is None:
        assert "constant" in fx["error"]
        assert res["statistics"][0]["value"] is None
        assert any(w["code"] == "constant_variable" for w in res["warnings"])
        return
    assert_matches_fixture(res, fx)
    assert res["apa_table"] and res["apa_sentence"] and res["plain_language_summary"]


@pytest.mark.parametrize("path", MATRIX, ids=lambda p: p.stem)
def test_matrix_matches_r(path):
    fx = load_fixture(path)
    res = run_fixture(fx)
    exp = fx["expected"]
    assert res["inputs"]["n_used"] == exp["n_used"] and res["inputs"]["n_excluded"] == exp["n_excluded"]
    got = {(r["x"], r["y"]): r for r in res["chart_data"]["correlation_pairs"]}
    assert len(got) == len(exp["pairs"])
    for e in exp["pairs"]:
        g, w = got[(e["x"], e["y"])], f"{fx['case']}/{e['x']}-{e['y']}"
        assert g["n"] == e["n"], w
        for k in ("r", "p", "p_adjusted", "ci_lower", "ci_upper"):
            close(g[k], e[k], TOL, f"{w}.{k}")
    k = len(fx["request"]["variables"]["variables"])
    assert len(res["chart_data"]["correlation_heatmap"]) == k * k
    assert len(res["apa_table"]["rows"]) == k


def test_matrix_request_correction_takes_precedence():
    fx = load_fixture(fixture_paths("correlation.matrix")[0])
    req = request_for(fx)
    req["options"] = {"method": "pearson", "adjust": "none"}
    req["corrections"] = [{"scope": "matrix", "method": "bonferroni"}]
    res = registry.run(load_data(fx["dataset"]), req)
    pairs = res["chart_data"]["correlation_pairs"]
    for p in pairs:
        assert p["p_adjusted"] == pytest.approx(min(1.0, p["p"] * len(pairs)))


def test_p_adjust_matches_r_examples():
    # stats::p.adjust(c(.01, .02, .03, .04, .05), "holm") / "BH"
    p = [0.01, 0.02, 0.03, 0.04, 0.05]
    assert corr.p_adjust(p, "holm") == pytest.approx([0.05, 0.08, 0.09, 0.09, 0.09])
    assert corr.p_adjust(p, "fdr_bh") == pytest.approx([0.05] * 5)
    assert corr.p_adjust([0.2, None, 0.01], "bonferroni") == [0.4, None, 0.02]


def test_point_biserial_needs_two_groups():
    df = load_data("correlation_basic.csv").assign(g3=lambda d: (d.index % 3).astype(str))
    fx = load_fixture(fixture_paths("correlation.point_biserial")[0])
    req = request_for(fx)
    req["variables"] = {"binary": ["g3"], "outcome": ["y"]}
    with pytest.raises(InvalidParams):
        registry.run(df, req)


def test_partial_requires_enough_rows():
    fx = load_fixture(fixture_paths("correlation.partial")[0])
    req = request_for(fx)
    df = load_data(fx["dataset"]).head(4)
    with pytest.raises(InvalidParams):
        registry.run(df, req)
