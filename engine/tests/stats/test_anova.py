"""ANOVA family vs R (fixtures/r/anova.R -> fixtures/expected/anova/*.json), within 1e-6.

Post hoc fixtures carry one effect size per (key, term); conftest matches effects by key only, so
termed effects are matched here and everything else goes through `assert_matches_fixture`.
"""

from __future__ import annotations

import copy

import numpy as np
import pandas as pd
import pytest

from statly_engine.errors import InvalidParams
from statly_engine.stats import registry, sphericity
from statly_engine.stats.posthoc_param import p_adjust

from .conftest import TOL, assert_matches_fixture, close, fixture_paths, load_data, load_fixture, request_for, run_fixture

CASES = fixture_paths("anova")
IDS = {"anova.one_way", "anova.welch", "anova.repeated_measures", "posthoc.tukey", "posthoc.games_howell",
       "posthoc.pairwise"}


def test_inventory_and_registry():
    assert len(CASES) >= 35
    assert {load_fixture(p)["analysis_id"] for p in CASES} == IDS
    assert IDS <= set(registry.load_all())


@pytest.mark.parametrize("path", CASES, ids=lambda p: p.stem)
def test_anova_matches_r(path):
    fx = load_fixture(path)
    if fx["expected"] is None:
        with pytest.raises(InvalidParams):
            run_fixture(fx)
        return
    res = run_fixture(fx)
    termed = [e for e in fx["expected"].get("effect_sizes", []) if e.get("term")]
    base = copy.deepcopy(fx)
    if termed:
        base["expected"]["effect_sizes"] = []
    assert_matches_fixture(res, base)
    where = f"{fx['analysis_id']}/{fx['case']}"
    for e in termed:
        hits = [r for r in res["effect_sizes"] if r["key"] == e["key"] and r["term"] == e["term"]]
        assert len(hits) == 1, f"{where}: effect {e['key']} [{e['term']}] missing"
        got, w = hits[0], f"{where}/effect {e['key']}[{e['term']}]"
        close(got["value"], e["value"], TOL, w + ".value")
        ci = got["ci"] or {"lower": None, "upper": None}
        close(ci["lower"], e["ci_lower"], TOL, w + ".ci_lower")
        close(ci["upper"], e["ci_upper"], TOL, w + ".ci_upper")
        # R's own qtukey-based bounds (TukeyHSD / rstatix) stop at qtukey's eps = 1e-4.
        for k in ("tukeyhsd_ci_lower", "rstatix_ci_lower", "tukeyhsd_ci_upper", "rstatix_ci_upper"):
            if e.get(k) is not None:
                assert abs(ci["lower" if k.endswith("lower") else "upper"] - e[k]) < 1e-3
    if "epsilon_hf_uncapped" in fx["expected"]:
        y = _rm_matrix(fx)
        _, hf, hf_raw = sphericity.epsilons(y)
        close(hf_raw, fx["expected"]["epsilon_hf_uncapped"], TOL, where + ".hf_raw")
        assert hf == min(1.0, hf_raw)
    # every result renders an APA sentence, summary and table
    assert res["plain_language_summary"] and res["apa_sentence"] and res["apa_table"]["rows"]


def _rm_matrix(fx) -> np.ndarray:
    df = load_data(fx["dataset"])
    v = fx["request"]["variables"]
    if "measures" in v:
        return df[v["measures"]].dropna().to_numpy(float)
    wide = df.dropna(subset=["id"]).pivot_table(index="id", columns=v["time"][0], values="score")
    return wide.dropna().to_numpy(float)


def _run(dataset: str, analysis_id: str, variables: dict, **kw) -> dict:
    fx = {"analysis_id": analysis_id, "case": "adhoc", "dataset": dataset,
          "request": {"variables": variables, **kw}}
    return registry.run(load_data(dataset), request_for(fx))


def test_wide_and_long_layouts_agree():
    wide = _run("anova_rm5_wide.csv", "anova.repeated_measures", {"measures": [f"w{j}" for j in range(1, 6)]})
    long = _run("anova_rm5_long.csv", "anova.repeated_measures",
                {"outcome": ["score"], "time": ["week"], "subject_id": ["id"]})
    assert wide["inputs"]["n_used"] == 30 and long["inputs"]["n_used"] == 29
    assert wide["statistics"][0]["key"] == long["statistics"][0]["key"] == "F_gg"   # Mauchly p < .05


def test_correction_option_and_tails_are_validated():
    v = {"measures": ["pre", "mid", "post"]}
    with pytest.raises(InvalidParams):
        _run("anova_rm3_wide.csv", "anova.repeated_measures", v, options={"correction": "sphericity"})
    with pytest.raises(InvalidParams):
        _run("anova_three.csv", "anova.one_way", {"outcome": ["y"], "group": ["group"]}, tails="greater")
    with pytest.raises(InvalidParams):
        _run("anova_three.csv", "posthoc.pairwise", {"outcome": ["y"], "group": ["group"]},
             options={"adjust": "fdr"})
    gg = _run("anova_rm3_wide.csv", "anova.repeated_measures", v, options={"correction": "gg"})
    assert gg["statistics"][0]["key"] == "F_gg"


def test_two_time_points_sphericity_trivial():
    res = _run("anova_rm3_wide.csv", "anova.repeated_measures", {"measures": ["pre", "post"]})
    m = next(a for a in res["assumptions"] if a["test_used"]["key"] == "mauchly")
    assert m["statistic"] is None and m["verdict"] == "passed"
    eps = {s["key"]: s["value"] for s in res["statistics"] if s["key"].startswith("epsilon")}
    assert eps == {"epsilon_gg": 1.0, "epsilon_hf": 1.0}
    # F with 1 df equals the paired t squared
    paired = _run("anova_rm3_wide.csv", "t_test.paired", {"measures": ["pre", "post"]})
    assert np.isclose(res["statistics"][0]["value"], paired["statistics"][0]["value"] ** 2, rtol=1e-10)


def test_one_way_two_groups_equals_student_t_squared():
    a = _run("anova_two.csv", "anova.one_way", {"outcome": ["y"], "group": ["group"]})
    t = _run("anova_two.csv", "t_test.independent", {"outcome": ["y"], "group": ["group"]}, options={"variant": "student"})
    assert np.isclose(a["statistics"][0]["value"], t["statistics"][0]["value"] ** 2, rtol=1e-10)
    assert np.isclose(a["statistics"][0]["p"], t["statistics"][0]["p"], rtol=1e-10)


def test_sphericity_invariant_to_contrasts():
    rng = np.random.default_rng(1)
    y = rng.normal(size=(15, 4)) + rng.normal(size=(15, 1))
    c = sphericity.orthonormal_contrasts(4)
    assert np.allclose(c.T @ c, np.eye(3)) and np.allclose(c.sum(axis=0), 0)
    q, _ = np.linalg.qr(rng.normal(size=(3, 3)))
    s1 = c.T @ np.cov(y, rowvar=False) @ c
    s2 = q.T @ s1 @ q
    gg = lambda s: np.trace(s) ** 2 / (3 * np.trace(s @ s))  # noqa: E731
    assert np.isclose(gg(s1), gg(s2)) and np.isclose(np.linalg.det(s1), np.linalg.det(s2))


def test_p_adjust_matches_r():
    p = [0.01, 0.04, 0.03, None, 0.2]
    # p.adjust(c(.01, .04, .03, .2), "holm") = 0.04 0.09 0.09 0.20 ; bonferroni = 0.04 0.16 0.12 0.80
    assert np.allclose([x for x in p_adjust(p, "holm") if x is not None], [0.04, 0.09, 0.09, 0.2])
    assert np.allclose([x for x in p_adjust(p, "bonferroni") if x is not None], [0.04, 0.16, 0.12, 0.8])
    assert p_adjust(p, "holm")[3] is None


def test_constant_group_welch_is_null_with_warning():
    res = _run("anova_constant_group.csv", "anova.welch", {"outcome": ["y"], "group": ["group"]})
    assert res["statistics"][0]["key"] == "welch_F" and res["statistics"][0]["value"] is None
    assert res["statistics"][1]["value"] is not None
    assert any(w["code"] == "constant_variable" for w in res["warnings"])


def test_rm_all_constant_changes():
    df = pd.DataFrame({"a": [1.0, 2, 3, 4], "b": [2.0, 3, 4, 5], "c": [3.0, 4, 5, 6]})
    fx = {"analysis_id": "anova.repeated_measures", "case": "x", "request": {"variables": {"measures": ["a", "b", "c"]}}}
    res = registry.run(df, request_for(fx))
    assert res["statistics"][0]["value"] is None
    assert any(w["code"] == "constant_variable" for w in res["warnings"])
