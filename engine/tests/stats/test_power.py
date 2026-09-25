"""power.* (dataset-free): R pwr fixtures + hand-R G*Power formulas at 1e-6; G*Power's printed examples
(Faul et al., 2007) at max(1e-3, half a printed unit); behaviour of the dataset-free registry / RPC path."""

from __future__ import annotations

import pytest

from statly_engine.errors import InvalidParams
from statly_engine.stats import power, registry
from statly_engine.stats.core import FIELD_NORMS

from .conftest import TOL, assert_matches_fixture, close, fixture_paths, load_fixture

ALL = fixture_paths("power")
PWR_CASES = [p for p in ALL if not p.stem.startswith("gpower_")]
GPOWER_CASES = [p for p in ALL if p.stem.startswith("gpower_")]
IDS = ["power.t_test", "power.anova", "power.correlation", "power.chi_square", "power.regression"]


def _req(analysis_id: str, options: dict, tails: str = "two_sided", alpha: float = 0.05, **kw) -> dict:
    return {"schema_version": 1, "request_id": f"power-{analysis_id}", "analysis_id": analysis_id,
            "dataset_id": None, "snapshot_id": None, "variables": {}, "subset": [], "options": options,
            "corrections": [], "alpha": alpha, "tails": tails, "ci_level": 0.95, **kw}


def _fixture_request(fx: dict) -> dict:
    r = fx["request"]
    return _req(fx["analysis_id"], r.get("options") or {}, r.get("tails", "two_sided"), r.get("alpha", 0.05))


def test_fixture_inventory():
    assert len(PWR_CASES) >= 250
    assert len(GPOWER_CASES) >= 3
    assert {load_fixture(p)["analysis_id"] for p in PWR_CASES} == set(IDS)


@pytest.mark.parametrize("path", PWR_CASES, ids=lambda p: p.stem)
def test_power_matches_r(path):
    fx = load_fixture(path)
    res = registry.run(None, _fixture_request(fx))
    assert_matches_fixture(res, fx, TOL)


@pytest.mark.parametrize("path", GPOWER_CASES, ids=lambda p: p.stem)
def test_gpower_printed_examples(path):
    fx = load_fixture(path)
    got = power._power_at(_fixture_request(fx), fx["n"], fx["effect_size"])
    got["df1"], got["df2"] = got["crit_df"]
    got["critical_value"] = got["critical"]
    where = f"{fx['case']}"
    for k, v in fx["hand_r"].items():                      # same formulas in R: 1e-6
        close(got[k], v, TOL, f"{where}/hand_r.{k}")
    for k, v in fx["printed"].items():                     # G*Power's printed (rounded) output
        tol = max(1e-3, 0.5 * 10 ** -fx["printed_decimals"][k])
        assert abs(got[k] - v) <= tol, f"{where}: {k} = {got[k]:.5f}, G*Power printed {v}"


def test_result_shape_and_plain_language():
    res = registry.run(None, _req("power.t_test", {"effect_size": "medium"}))
    assert res["statistics"][0]["key"] == "n_required" and res["statistics"][0]["value"] == 64
    assert "80% chance of detecting a medium effect" in res["plain_language_summary"]
    assert "64 participants per group" in res["plain_language_summary"]
    assert res["inputs"]["dataset_id"] is None and res["inputs"]["request"]["options"]["effect_size"] == "medium"
    es = res["effect_sizes"][0]
    assert es["key"] == "cohens_d" and FIELD_NORMS in es["interpretation"]["text"]
    bench = next(t for t in res["additional_tables"] if t["title"] == "Conventional Effect-Size Benchmarks")
    assert len(bench["rows"]) == 3 and "Cohen (1988)" in "".join(r["text"] for r in bench["notes"]["general"])
    curve = res["chart_data"]["power_curve"]
    assert {r["series"] for r in curve} == {"planned", "small", "medium", "large"}
    planned = [r["power"] for r in curve if r["series"] == "planned"]
    assert planned == sorted(planned) and any(r["n"] == 64 for r in curve)


def test_sensitivity_summary():
    res = registry.run(None, _req("power.correlation", {"mode": "sensitivity", "n": 100}))
    assert res["statistics"][0]["key"] == "detectable_effect"
    assert "With 100 participants" in res["plain_language_summary"]


def test_post_hoc_power_refused():
    with pytest.raises(InvalidParams, match="post hoc"):
        registry.run(None, _req("power.t_test", {"mode": "post_hoc", "effect_size": 0.5, "n": 30}))


@pytest.mark.parametrize("aid,opts,tails,match", [
    ("power.anova", {"effect_size": 0.25}, "greater", "two-sided"),
    ("power.t_test", {}, "two_sided", "effect size"),
    ("power.t_test", {"mode": "sensitivity"}, "two_sided", "sample size"),
    ("power.t_test", {"effect_size": 0.5, "power": 0.04}, "two_sided", "larger than alpha"),
    ("power.t_test", {"effect_size": -0.5}, "greater", "direction"),
    ("power.chi_square", {"effect_size": 0.3}, "two_sided", "degrees of freedom"),
    ("power.anova", {"design": "mixed_interaction", "groups": 3, "mode": "sensitivity", "n": 31}, "two_sided",
     "equally"),
])
def test_invalid_inputs(aid, opts, tails, match):
    with pytest.raises(InvalidParams, match=match):
        registry.run(None, _req(aid, opts, tails))


def test_subset_refused_for_dataset_free():
    with pytest.raises(InvalidParams):
        registry.run(None, _req("power.t_test", {"effect_size": 0.5},
                                subset=[{"variable": "x", "op": "in", "values": [1]}]))


def test_registry_lists_power_as_dataset_free():
    listed = {a["analysis_id"]: a for a in registry.describe_all()}
    for aid in IDS:
        assert listed[aid]["needs_data"] is False and listed[aid]["layouts"][0]["roles"] == []
    assert listed["t_test.independent"]["needs_data"] is True


def test_rpc_runs_without_dataset(engine):
    res = engine.call("analysis.run", _req("power.regression", {"effect_size": "medium", "predictors": 3}))
    assert res["analysis_id"] == "power.regression" and res["inputs"]["snapshot_id"] is None
    ids = {a["analysis_id"]: a for a in engine.call("analysis.list")["analyses"]}
    assert all(ids[a]["needs_data"] is False for a in IDS)


def test_rpc_data_analysis_still_needs_dataset(engine):
    err = engine.error("analysis.run", _req("t_test.one_sample", {}, variables={"outcome": ["y"]}))
    assert err["code"] in (-32002, -32003)
