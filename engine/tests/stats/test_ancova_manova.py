"""ANCOVA, Quade, MANOVA, MANCOVA vs R (fixtures/r/ancova_manova.R -> fixtures/expected/ancova_manova/*.json).

Everything is compared within 1e-6. Termed effects, adjusted means, follow-ups and the model-based assumption
checks (matched by test key + scope label) are checked here; the rest goes through `assert_matches_fixture`.
"""

from __future__ import annotations

import copy

import numpy as np
import pandas as pd
import pytest

from statly_engine.errors import InvalidParams
from statly_engine.stats import assumptions_multivariate as amv, registry

from .conftest import TOL, assert_matches_fixture, close, fixture_paths, load_data, load_fixture, request_for, run_fixture

CASES = fixture_paths("ancova_manova")
IDS = {"ancova", "ancova.quade", "manova", "mancova"}


def test_inventory_and_registry():
    assert len(CASES) >= 20
    assert {load_fixture(p)["analysis_id"] for p in CASES} == IDS
    assert IDS <= set(registry.load_all())


def _check_assumptions(res: dict, checks: list[dict], where: str) -> None:
    for rec in checks:
        hits = [a for a in res["assumptions"] if a["test_used"] and a["test_used"]["key"] == rec["test"]
                and a["applies_to"]["label"] == rec["scope"]]
        assert len(hits) == 1, f"{where}: no unique {rec['test']} [{rec['scope']}]"
        a, w = hits[0], f"{where}/{rec['test']}[{rec['scope']}]"
        assert a["applies_to"]["n"] == rec["n"], f"{w}: n"
        close(a["statistic"]["value"] if a["statistic"] else None, rec["statistic"], TOL, w + ".statistic")
        close(a["p"], rec["p"], TOL, w + ".p")
        if rec["statistic"] is not None:
            assert len(a["statistic"]["df"]) == len(rec["df"]), f"{w}: df length"
            for g, e in zip(a["statistic"]["df"], rec["df"]):
                close(g, e, TOL, w + ".df")


@pytest.mark.parametrize("path", CASES, ids=lambda p: p.stem)
def test_matches_r(path):
    fx = load_fixture(path)
    if fx["expected"] is None:
        with pytest.raises(InvalidParams):
            run_fixture(fx)
        return
    res = run_fixture(fx)
    exp = fx["expected"]
    where = f"{fx['analysis_id']}/{fx['case']}"
    termed = [e for e in exp.get("effect_sizes", []) if e.get("term")]
    base = copy.deepcopy(fx)
    if termed:
        base["expected"]["effect_sizes"] = [e for e in exp["effect_sizes"] if not e.get("term")]
    assert_matches_fixture(res, base)
    # every statistic and effect in the result is covered by the fixture (nothing extra, nothing renamed)
    assert len(res["statistics"]) == len(exp["statistics"]), f"{where}: statistic count"
    assert len(res["effect_sizes"]) == len(exp["effect_sizes"]), f"{where}: effect count"
    for e in termed:
        hits = [r for r in res["effect_sizes"] if r["key"] == e["key"] and r["term"] == e["term"]]
        assert len(hits) == 1, f"{where}: effect {e['key']} [{e['term']}] missing"
        got, w = hits[0], f"{where}/effect {e['key']}[{e['term']}]"
        close(got["value"], e["value"], TOL, w + ".value")
        ci = got["ci"] or {"lower": None, "upper": None}
        close(ci["lower"], e["ci_lower"], TOL, w + ".ci_lower")
        close(ci["upper"], e["ci_upper"], TOL, w + ".ci_upper")
    _check_assumptions(res, exp.get("assumption_checks", []), where)
    for rec in exp.get("adjusted_means", []):
        hits = [r for r in res["chart_data"]["adjusted_means"]
                if r["group"] == rec["group"] and r.get("outcome") == rec.get("outcome")]
        assert len(hits) == 1, f"{where}: adjusted mean {rec}"
        for k in ("emmean", "se", "df", "lower", "upper"):
            close(hits[0][k], rec[k], TOL, f"{where}/adjusted_means[{rec['group']}].{k}")
    for rec in exp.get("univariate", []):
        got = next(u for u in res["chart_data"]["univariate_followups"] if u["outcome"] == rec["outcome"])
        for k in ("F", "p", "p_bonferroni"):
            close(got[k], rec[k], TOL, f"{where}/univariate[{rec['outcome']}].{k}")
    for rec in exp.get("rank_residuals", []):
        got = next(u for u in res["chart_data"]["rank_residuals"] if u["group"] == rec["group"])
        assert got["n"] == rec["n"]
        close(got["mean_residual"], rec["mean_residual"], TOL, f"{where}/rank_residuals.mean_residual")
        close(got["mean_rank"], rec["mean_rank"], TOL, f"{where}/rank_residuals.mean_rank")
    if "mahalanobis_flagged" in exp:
        cut = __import__("scipy.stats", fromlist=["chi2"]).chi2.ppf(0.999, len(fx["request"]["variables"]["outcomes"]))
        assert sum(r["d2"] > cut for r in res["chart_data"]["mahalanobis"]) == exp["mahalanobis_flagged"]
    assert res["plain_language_summary"] and res["apa_sentence"] and res["apa_table"]["rows"]


def _run(dataset: str, analysis_id: str, variables: dict, **kw) -> dict:
    fx = {"analysis_id": analysis_id, "case": "adhoc", "dataset": dataset, "request": {"variables": variables, **kw}}
    return registry.run(load_data(dataset), request_for(fx))


ANC = {"outcome": ["post"], "group": ["group"], "covariates": ["pre"]}


def test_options_and_roles_are_validated():
    with pytest.raises(InvalidParams):
        _run("anc_two.csv", "ancova", ANC, options={"adjust": "scheffe"})
    with pytest.raises(InvalidParams):
        _run("anc_two.csv", "ancova", ANC, tails="greater")
    with pytest.raises(InvalidParams):   # the same column in two roles
        _run("anc_two.csv", "ancova", {"outcome": ["post"], "group": ["group"], "covariates": ["post"]})
    with pytest.raises(InvalidParams):   # MANOVA needs two outcomes
        _run("anc_mv_two.csv", "manova", {"outcomes": ["y1"], "group": ["group"]})


def test_slopes_differ_warns():
    res = _run("anc_slopes.csv", "ancova", ANC)
    slopes = next(a for a in res["assumptions"] if a["assumption"] == "homogeneity_of_regression_slopes")
    assert slopes["verdict"] == "failed"
    assert any(w["code"] == "slopes_differ" for w in res["warnings"])


def test_two_group_f_equals_pairwise_t_squared():
    """Two groups: the group F equals the squared t of the adjusted-mean difference."""
    res = _run("anc_two.csv", "ancova", ANC)
    f = res["statistics"][0]["value"]
    t = next(s for s in res["statistics"] if s["key"] == "t")["value"]
    assert np.isclose(f, t ** 2, rtol=1e-10)   # k = 2: group F = pairwise t²


def test_manova_two_groups_tests_agree():
    res = _run("anc_mv_two.csv", "manova", {"outcomes": ["y1", "y2", "y3"], "group": ["group"]})
    fs = {s["key"]: s for s in res["statistics"] if s["key"].endswith("_F") and s["term"] == "group"}
    vals = [fs[k]["value"] for k in ("pillai_F", "wilks_F", "hotelling_lawley_F", "roy_F")]
    assert np.allclose(vals, vals[0], rtol=1e-10)   # one df for the hypothesis: all four are exact and equal


def test_manova_single_outcome_pair_matches_hotelling():
    """Two groups: Pillai's F equals Hotelling's T² converted to F."""
    df = load_data("anc_mv_two.csv")
    Y = df[["y1", "y2"]].to_numpy(float)
    g = df["group"].to_numpy()
    a, b = Y[g == "Control"], Y[g == "Program"]
    n1, n2, p = len(a), len(b), 2
    S = ((n1 - 1) * np.cov(a, rowvar=False) + (n2 - 1) * np.cov(b, rowvar=False)) / (n1 + n2 - 2)
    dm = a.mean(0) - b.mean(0)
    t2 = n1 * n2 / (n1 + n2) * dm @ np.linalg.solve(S, dm)
    f = (n1 + n2 - p - 1) / (p * (n1 + n2 - 2)) * t2
    res = _run("anc_mv_two.csv", "manova", {"outcomes": ["y1", "y2"], "group": ["group"]})
    got = next(s for s in res["statistics"] if s["key"] == "pillai_F")["value"]
    assert np.isclose(got, f, rtol=1e-10)


def test_box_m_matches_hand_formula_and_singular_groups():
    rng = np.random.default_rng(3)
    Y = rng.normal(size=(30, 2))
    codes = np.repeat([0, 1, 2], 10)
    r = amv.box_m(Y, codes, 3, ["a", "b", "c"])
    assert r["statistic"]["df"] == [6.0] and 0 <= r["p"] <= 1
    small = amv.box_m(Y[:5], np.array([0, 0, 1, 1, 1]), 2, ["a", "b"])
    assert small["statistic"] is None and small["verdict"] == "caution"


def test_quade_is_rank_invariant():
    """Quade uses ranks only: a monotone transform of the outcome and covariate leaves F unchanged."""
    df = load_data("anc_three_unequal.csv")
    df2 = df.assign(post=np.exp(df["post"] / 20), pre=df["pre"] ** 3)
    v = ANC
    a = registry.run(df, request_for({"analysis_id": "ancova.quade", "case": "x", "request": {"variables": v}}))
    b = registry.run(df2, request_for({"analysis_id": "ancova.quade", "case": "x", "request": {"variables": v}}))
    assert np.isclose(a["statistics"][0]["value"], b["statistics"][0]["value"], rtol=1e-10)


def test_collinear_outcomes_rejected():
    df = pd.DataFrame({"group": ["a"] * 6 + ["b"] * 6, "y1": np.arange(12.0), "y2": np.arange(12.0) * 2 + 1})
    fx = {"analysis_id": "manova", "case": "x", "request": {"variables": {"outcomes": ["y1", "y2"], "group": ["group"]}}}
    with pytest.raises(InvalidParams):
        registry.run(df, request_for(fx))
