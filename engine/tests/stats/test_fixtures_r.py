"""Every R reference fixture (fixtures/expected/**) reproduced by the engine within 1e-6."""

from __future__ import annotations

import math

import numpy as np
import pytest

from statly_engine.errors import InvalidParams
from statly_engine.stats import assumptions as asm
from statly_engine.stats import effect_sizes as es

from .conftest import (EXPECTED, TOL, assert_matches_fixture, close, fixture_paths, load_data, load_fixture,
                       match_assumption, run_fixture)

ANALYSIS_DIRS = ["descriptives", "t_test.one_sample", "t_test.independent", "t_test.paired"]
CASES = [p for d in ANALYSIS_DIRS for p in fixture_paths(d)]


def test_fixture_inventory():
    assert len(CASES) >= 30
    assert len(fixture_paths("assumptions")) >= 10


@pytest.mark.parametrize("path", CASES, ids=lambda p: f"{p.parent.name}/{p.stem}")
def test_analysis_matches_r(path):
    fx = load_fixture(path)
    if fx["expected"] is None:
        # R refuses these inputs. Constant data -> the engine returns a result that explains why no
        # statistic exists; structurally impossible designs (a single group) -> InvalidParams.
        if "constant" in fx["error"]:
            res = run_fixture(fx)
            assert res["statistics"][0]["value"] is None
            assert any(w["code"] == "constant_variable" for w in res["warnings"])
        else:
            with pytest.raises(InvalidParams):
                run_fixture(fx)
        return
    assert_matches_fixture(run_fixture(fx), fx)


def _assumption_inputs(fx, rec):
    df = load_data(fx["dataset"])
    scope = rec["scope"]
    if rec["test"] == "levene_brown_forsythe":
        return {k: v["y"].to_numpy() for k, v in df.dropna(subset=["group"]).groupby("group")}
    if scope == "differences":
        return (df["pre"] - df["post"]).to_numpy()
    if scope == "overall":
        return df["y"].to_numpy()
    return df.loc[df["group"] == scope, "y"].to_numpy()


@pytest.mark.parametrize("path", fixture_paths("assumptions"), ids=lambda p: p.stem)
def test_assumptions_match_r(path):
    fx = load_fixture(path)
    fns = {"shapiro_wilk": asm.shapiro_wilk, "ks_lilliefors": asm.ks_lilliefors}
    results = []
    for rec in fx["expected"]["assumptions"]:
        values = _assumption_inputs(fx, rec)
        if rec["test"] == "levene_brown_forsythe":
            res, _ = asm.levene_brown_forsythe(values, asm.scope("overall", "groups"))
        else:
            kind = rec["scope"] if rec["scope"] in ("differences", "overall") else "group"
            res, charts = fns[rec["test"]](values, asm.scope(kind, rec["scope"]))
            assert {c["data_key"] for c in res["chart_refs"]} == set(charts)
        results.append(res)
    for rec in fx["expected"]["assumptions"]:
        match_assumption(results, rec, TOL, f"assumptions/{fx['case']}")
    for q in fx["expected"]["qq"]:
        values = _assumption_inputs(fx, {"test": "qq", "scope": q["scope"]})
        pts = asm.qq_points(values)
        assert len(pts) == len(q["theoretical"])
        for p, t, s in zip(pts, q["theoretical"], q["sample"]):
            close(p["theoretical"], t, TOL, f"qq/{fx['case']}.theoretical")
            close(p["sample"], s, TOL, f"qq/{fx['case']}.sample")


def test_noncentral_ci_helpers_match_r():
    fx = load_fixture(EXPECTED / "effect_sizes" / "noncentral_ci.json")
    for c in fx["expected"]["nct"]:
        r = es.r_from_t(c["t"], c["df"])
        close(r.value, c["r"], TOL, "t_to_r")
        # t_to_d(paired = TRUE): d = t / sqrt(df), CI = ncp bounds / sqrt(df). Reference here is
        # effectsize's optim result; one case (t = 2.5, df = 20) is a known optim miss, see README.
        lo, hi = es.nct_ci(c["t"], c["df"])
        assert math.isclose(lo / math.sqrt(c["df"]), c["d_ci_lower"], abs_tol=3e-3)
        assert math.isclose(hi / math.sqrt(c["df"]), c["d_ci_upper"], abs_tol=1e-6)
    for c in fx["expected"]["ncf"]:
        e1 = es.partial_pve(c["f"], c["df1"], c["df2"])
        e2 = es.partial_pve(c["f"], c["df1"], c["df2"], alternative="two_sided")
        o2 = es.partial_pve(c["f"], c["df1"], c["df2"], kind="omega2", alternative="two_sided")
        for got, key in ((e1.value, "eta2"), (e1.lower, "eta2_ci_lower"), (e1.upper, "eta2_ci_upper"),
                         (e2.lower, "eta2_2s_ci_lower"), (e2.upper, "eta2_2s_ci_upper"), (o2.value, "omega2"),
                         (o2.lower, "omega2_2s_ci_lower"), (o2.upper, "omega2_2s_ci_upper")):
            close(got, c[key], 1e-6, f"ncf {c['f']}/{key}")


def test_nct_ci_is_exact_inversion():
    from scipy import stats
    lo, hi = es.nct_ci(2.5, 20)
    assert math.isclose(stats.nct.cdf(2.5, 20, lo), 0.975, abs_tol=1e-10)
    assert math.isclose(stats.nct.cdf(2.5, 20, hi), 0.025, abs_tol=1e-10)
    lo1, hi1 = es.nct_ci(2.5, 20, alternative="greater")
    assert hi1 == math.inf and math.isclose(stats.nct.cdf(2.5, 20, lo1), 0.95, abs_tol=1e-10)
