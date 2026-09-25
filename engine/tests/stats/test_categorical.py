"""Categorical tests reproduce the R reference fixtures (fixtures/r/categorical.R) within 1e-6."""

from __future__ import annotations

import numpy as np
import pytest

from statly_engine.errors import InvalidParams
from statly_engine.stats import categorical as cat
from statly_engine.stats import registry

from .conftest import TOL, assert_matches_fixture, close, fixture_paths, load_data, load_fixture, request_for, run_fixture

DIRS = ["chi_square.independence", "chi_square.goodness_of_fit", "fisher_exact", "mcnemar", "cochran_q"]
CASES = [p for d in DIRS for p in fixture_paths(d)]


def test_inventory():
    assert len(CASES) >= 20


@pytest.mark.parametrize("path", CASES, ids=lambda p: f"{p.parent.name}/{p.stem}")
def test_categorical_matches_r(path):
    fx = load_fixture(path)
    if fx["expected"] is None:
        with pytest.raises(InvalidParams):
            run_fixture(fx)
        return
    res = run_fixture(fx)
    assert_matches_fixture(res, fx)
    exp = fx["expected"]
    if "expected_counts" in exp:
        if fx["analysis_id"] == "chi_square.goodness_of_fit":
            got = [r["expected"] for r in res["chart_data"]["goodness_of_fit"]]
        else:
            got = [r["expected"] for r in res["chart_data"]["crosstab"]]
        assert len(got) == len(exp["expected_counts"])
        for g, e in zip(got, exp["expected_counts"]):
            close(g, e, TOL, f"{fx['case']}.expected_count")
    if exp.get("low_expected"):
        assert any(w["code"] == "low_expected_counts" for w in res["warnings"])
    assert res["apa_table"] and res["apa_sentence"] and res["plain_language_summary"]


def test_fisher_rxc_enumeration_matches_2x2_scipy():
    from scipy import stats
    for t in ([[3, 1], [1, 3]], [[10, 2], [3, 15]], [[0, 5], [6, 3]]):
        assert cat.fisher_rxc_p(t) == pytest.approx(stats.fisher_exact(t).pvalue, abs=1e-12)


def test_fisher_rxc_refuses_huge_tables():
    t = np.array([[40, 35, 30, 25], [30, 35, 40, 45], [20, 25, 30, 35]])
    with pytest.raises(InvalidParams):
        cat.fisher_rxc_p(t)


def test_mcnemar_needs_two_codes():
    df = load_data("categorical_3x4.csv")
    fx = load_fixture(fixture_paths("mcnemar")[0])
    req = request_for(fx)
    req["variables"] = {"measures": ["school", "band"]}
    with pytest.raises(InvalidParams):
        registry.run(df, req)


def test_goodness_of_fit_list_proportions_equal_dict():
    fx = load_fixture(next(p for p in fixture_paths("chi_square.goodness_of_fit") if p.stem == "specified"))
    req = request_for(fx)
    req["options"] = {"expected_proportions": [0.1, 0.4, 0.3, 0.2]}
    assert_matches_fixture(registry.run(load_data(fx["dataset"]), req), fx)


def test_infinite_odds_ratio_bounds_match_r():
    from statly_engine.stats import effect_sizes_cat as esc
    fx = load_fixture(next(p for p in fixture_paths("fisher_exact") if p.stem == "zero_cell_2x2"))
    rec = next(e for e in fx["expected"]["effect_sizes"] if e["key"] == "odds_ratio")
    res = run_fixture(fx)
    counts = {(r["row"], r["column"]): r["count"] for r in res["chart_data"]["crosstab"]}
    rows = sorted({k[0] for k in counts}); cols = sorted({k[1] for k in counts})
    tab = [[counts[(r, c)] for c in cols] for r in rows]
    est = esc.odds_ratio_conditional(tab)
    assert est.value is None
    close(est.lower, rec["bound_when_infinite"][0], TOL, "fisher zero-cell OR lower")
    assert est.upper is None and rec["bound_when_infinite"][1] is None
    fx = load_fixture(next(p for p in fixture_paths("mcnemar") if p.stem == "small"))
    rec = next(e for e in fx["expected"]["effect_sizes"] if e["key"] == "odds_ratio")
    b = fx["expected"]["statistics"][2]["value"]
    est = esc.paired_odds_ratio(int(b), 0)
    assert est.value is None
    close(est.lower, rec["bound_when_infinite"][0], TOL, "mcnemar OR lower")
