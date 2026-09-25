"""reliability.icc / cohen_kappa / fleiss_kappa / kendall_w and education.gain_score / normalized_gain
reproduce the R reference fixtures (fixtures/r/agreement_education.R) within 1e-6, bootstrap CIs included
(R's RNG is reproduced draw for draw)."""

from __future__ import annotations

import numpy as np
import pytest

from statly_engine.errors import InvalidParams
from statly_engine.stats import registry
from statly_engine.stats import agreement as agr

from .conftest import TOL, assert_matches_fixture, close, fixture_paths, load_data, load_fixture, request_for

CASES = fixture_paths("agreement_education")
_id = lambda p: p.stem  # noqa: E731


def _run(fx: dict) -> dict:
    return registry.run(load_data(fx["dataset"]), request_for(fx), fx.get("meta"))


def test_inventory():
    ids = {load_fixture(p)["analysis_id"] for p in CASES}
    assert ids == {"reliability.icc", "reliability.cohen_kappa", "reliability.fleiss_kappa", "reliability.kendall_w",
                   "education.gain_score", "education.normalized_gain"}
    assert len(CASES) >= 25


@pytest.mark.parametrize("path", CASES, ids=_id)
def test_matches_r(path):
    fx = load_fixture(path)
    if fx["expected"] is None:
        with pytest.raises(InvalidParams):
            _run(fx)
        return
    res = _run(fx)
    exp = fx["expected"]
    # Effects are matched by (key, term) here: grouped results repeat a key per group (term = group).
    assert_matches_fixture(res, {**fx, "expected": {**exp, "effect_sizes": []}})
    if exp.get("effect_sizes"):
        assert res["effect_sizes"][0]["key"] == exp["effect_sizes"][0]["key"], "headline effect"
    effects = [{**e, "term": e.get("term")} for e in exp.get("effect_sizes", [])]
    for e in effects + exp.get("category_effects", []) + exp.get("group_effects", []):
        hits = [r for r in res["effect_sizes"] if r["key"] == e["key"] and r["term"] == e["term"]]
        assert len(hits) == 1, f"{fx['case']}: {e['key']}[{e['term']}] missing"
        w = f"{fx['analysis_id']}/{fx['case']}/{e['key']}[{e['term']}]"
        close(hits[0]["value"], e["value"], TOL, w)
        close(hits[0]["ci"]["lower"], e["ci_lower"], TOL, w + ".lower")
        close(hits[0]["ci"]["upper"], e["ci_upper"], TOL, w + ".upper")
    if "n_g_excluded" in exp:
        counts = res["chart_data"]["normalized_gain_counts"][0]
        assert counts["n_pre_at_max"] == exp["n_g_excluded"]
        if "n_c_excluded" in exp:
            assert counts["n_change_excluded"] == exp["n_c_excluded"]
    assert res["apa_table"] and res["apa_sentence"] and res["plain_language_summary"]


def test_benchmarks():
    assert [agr.landis_koch(v) for v in (-0.1, 0.0, 0.2, 0.21, 0.5, 0.7, 0.81)] == \
        ["poor", "slight", "slight", "fair", "moderate", "substantial", "almost perfect"]
    assert [agr.koo_li(v) for v in (0.4, 0.5, 0.8, 0.95)] == ["poor", "moderate", "good", "excellent"]


def test_icc_shrout_fleiss_published_values():
    """Shrout & Fleiss (1979) Table 2: .17, .29, .71, .44, .62, .91."""
    x = load_data("agr_shrout_fleiss.csv").to_numpy(float)
    icc = agr.icc_all(x)["icc"]
    got = [icc[f] for f in ("ICC1", "ICC2", "ICC3", "ICC1k", "ICC2k", "ICC3k")]
    assert np.allclose(got, [0.17, 0.29, 0.71, 0.44, 0.62, 0.91], atol=0.006)


def _req(aid, variables, options=None, tails="two_sided"):
    return {"schema_version": 1, "request_id": "t", "analysis_id": aid, "dataset_id": "d", "snapshot_id": "s",
            "variables": variables, "subset": [], "options": options or {}, "corrections": [], "alpha": 0.05,
            "tails": tails, "ci_level": 0.95}


def test_invalid_requests():
    two = load_data("agr_two3.csv")
    with pytest.raises(InvalidParams):
        registry.run(two, _req("reliability.cohen_kappa", {"raters": ["rater1", "rater2"]}, {"weights": "cubic"}))
    with pytest.raises(InvalidParams):
        registry.run(two, _req("reliability.icc", {"raters": ["rater1", "rater2"]}, {"form": "ICC4"}))
    with pytest.raises(InvalidParams):
        registry.run(two, _req("reliability.fleiss_kappa", {"raters": ["rater1", "rater2"]}, tails="greater"))
    hand = load_data("agr_gain_hand.csv")
    with pytest.raises(InvalidParams):          # max_score is required
        registry.run(hand, _req("education.normalized_gain", {"measures": ["pre", "post"]}))
    with pytest.raises(InvalidParams):          # scores above the stated maximum
        registry.run(hand, _req("education.normalized_gain", {"measures": ["pre", "post"]}, {"max_score": 8}))


def test_icc_form_option_is_case_insensitive():
    df = load_data("agr_shrout_fleiss.csv")
    res = registry.run(df, _req("reliability.icc", {"raters": [f"judge{i}" for i in range(1, 5)]}, {"form": "icc3k"}))
    assert res["effect_sizes"][0]["key"] == "icc3k"


def test_one_tailed_gain_score():
    df = load_data("agr_gain_hand.csv")
    two = registry.run(df, _req("education.gain_score", {"measures": ["pre", "post"]}))
    one = registry.run(df, _req("education.gain_score", {"measures": ["pre", "post"]}, tails="greater"))
    close(one["statistics"][0]["p"], two["statistics"][0]["p"] / 2, 1e-12, "one-tailed p")
    assert one["effect_sizes"][0]["ci"]["upper"] is None


def test_normalized_gain_hand_values():
    """Hand check: class g, individual g (pre = max excluded) and Marx-Cummings c on agr_gain_hand.csv."""
    df = load_data("agr_gain_hand.csv").dropna()
    pre, post = df["pre"].to_numpy(), df["post"].to_numpy()
    res = registry.run(load_data("agr_gain_hand.csv"),
                       _req("education.normalized_gain", {"measures": ["pre", "post"]}, {"max_score": 10}))
    eff = {e["key"]: e["value"] for e in res["effect_sizes"]}
    close(eff["g_class"], (post.mean() - pre.mean()) / (10 - pre.mean()), 1e-12, "g_class")
    ok = pre < 10
    close(eff["g_individual"], np.mean((post[ok] - pre[ok]) / (10 - pre[ok])), 1e-12, "g_individual")
    c = [(b - a) / (10 - a) if b > a else (b - a) / a if b < a else 0.0
         for a, b in zip(pre, post) if not (a == b and a in (0, 10))]
    close(eff["normalized_change"], np.mean(c), 1e-12, "c")
    codes = {w["code"] for w in res["warnings"]}
    assert {"pre_at_maximum", "negative_gains"} <= codes
