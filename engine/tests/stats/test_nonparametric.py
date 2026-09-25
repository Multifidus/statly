"""Nonparametric family vs R (fixtures/r/nonparametric.R -> fixtures/expected/nonparametric/), tolerance 1e-6.

Covers mann_whitney, wilcoxon_signed_rank, wilcoxon_one_sample, sign_test, kruskal_wallis, friedman and
posthoc.dunn / posthoc.conover / posthoc.nemenyi. The bootstrap CIs (epsilon², Kendall's W) are compared
at 1e-6 too: effect_sizes_rank.RRandom reproduces R's RNG draw for draw.
"""

from __future__ import annotations

import numpy as np
import pytest

from statly_engine.errors import InvalidParams
from statly_engine.stats import effect_sizes_rank as esr
from statly_engine.stats import registry
from statly_engine.stats.posthoc_rank import p_adjust

from .conftest import TOL, assert_matches_fixture, close, fixture_paths, load_data, load_fixture, request_for, run_fixture

CASES = fixture_paths("nonparametric")
IDS = ["mann_whitney", "wilcoxon_signed_rank", "wilcoxon_one_sample", "sign_test", "kruskal_wallis", "friedman",
       "posthoc.dunn", "posthoc.conover", "posthoc.nemenyi"]


def test_inventory():
    assert len(CASES) >= 30
    ids = {load_fixture(p)["analysis_id"] for p in CASES}
    assert ids == set(IDS)
    assert set(IDS) <= set(registry.load_all())


@pytest.mark.parametrize("path", CASES, ids=lambda p: p.stem)
def test_matches_r(path):
    fx = load_fixture(path)
    res = run_fixture(fx)
    assert_matches_fixture(res, fx)
    where = f"{fx['analysis_id']}/{fx['case']}"
    exp = fx["expected"]
    if "p_method" in exp:     # exact vs normal approximation chosen as R did
        exact = "exact" in exp["p_method"]
        assert ("exact p" in res["statistics"][0]["label"]) == exact, where
    for pr in exp.get("pairs", []):
        stat = [s for s in res["statistics"] if s["term"] == pr["term"]]
        rb = [e for e in res["effect_sizes"] if e["key"] == "rank_biserial" and e["term"] == pr["term"]]
        assert len(stat) == 1 and len(rb) == 1, f"{where}: pair {pr['term']}"
        close(stat[0]["value"], pr["statistic"], TOL, f"{where}/{pr['term']}.statistic")
        close(stat[0]["p"], pr["p_adjusted"], TOL, f"{where}/{pr['term']}.p_adj")
        cells = {r["cells"][0]["text"][0]["text"]: r["cells"] for r in res["apa_table"]["rows"]}
        row = cells[pr["term"].replace(" - ", " vs ")]
        p_col = 3 if fx["analysis_id"] == "posthoc.conover" and fx["request"]["options"]["adjust"] != "single-step" else 2
        close(row[p_col]["value"], pr["p_unadjusted"], TOL, f"{where}/{pr['term']}.p_unadjusted")
        close(rb[0]["value"], pr["rank_biserial"], TOL, f"{where}/{pr['term']}.rb")
        close(rb[0]["ci"]["lower"], pr["ci_lower"], TOL, f"{where}/{pr['term']}.rb_lower")
        close(rb[0]["ci"]["upper"], pr["ci_upper"], TOL, f"{where}/{pr['term']}.rb_upper")
    assert res["plain_language_summary"] and res["apa_sentence"] and res["apa_table"]


def _req(analysis_id, variables, **options):
    return {"schema_version": 1, "request_id": "t", "analysis_id": analysis_id, "dataset_id": "d",
            "snapshot_id": "s", "variables": variables, "subset": [], "options": options, "corrections": [],
            "alpha": 0.05, "tails": "two_sided", "ci_level": 0.95}


def test_structural_errors():
    four = load_data("np_four.csv")
    with pytest.raises(InvalidParams):
        registry.run(four, _req("mann_whitney", {"outcome": ["y"], "group": ["group"]}))
    with pytest.raises(InvalidParams):
        registry.run(four, _req("posthoc.dunn", {"outcome": ["y"], "group": ["group"]}, adjust="tukey"))
    rm = load_data("np_rm3_wide.csv")
    with pytest.raises(InvalidParams):
        registry.run(rm, _req("wilcoxon_signed_rank", {"measures": ["t1", "t2", "t3"]}))


def test_all_zero_differences_explained():
    import pandas as pd
    df = pd.DataFrame({"pre": [1, 2, 3, 4], "post": [1, 2, 3, 4]})
    for aid in ("wilcoxon_signed_rank", "sign_test"):
        res = registry.run(df, _req(aid, {"measures": ["pre", "post"]}))
        assert res["statistics"][0]["value"] is None
        assert any(w["code"] == "constant_variable" for w in res["warnings"])


def test_apa_sentence_format():
    fx = load_fixture(next(p for p in CASES if p.stem == "mann_whitney__ties"))
    text = "".join(r["text"] for r in run_fixture(fx)["apa_sentence"])
    assert "U = " in text and ", z = " in text and "p = ." in text and ", r = " in text


def test_bootstrap_seed_option_changes_ci():
    fx = load_fixture(next(p for p in CASES if p.stem == "kruskal_wallis__four_groups"))
    req = request_for(fx)
    base = registry.run(load_data(fx["dataset"]), req)
    req["options"] = {"bootstrap_seed": 7}
    other = registry.run(load_data(fx["dataset"]), req)
    assert base["effect_sizes"][0]["value"] == other["effect_sizes"][0]["value"]
    assert base["effect_sizes"][0]["ci"]["lower"] != other["effect_sizes"][0]["ci"]["lower"]


def test_r_rng_emulation():
    # set.seed(20260925); runif(3); sample.int(7, 20, TRUE)  (R 4.6.1)
    rng = esr.RRandom(20260925)
    assert np.allclose(rng.unif(3), [0.34611300355754793, 0.304786735214293, 0.73225544136948884], atol=1e-16)
    assert (rng.index(7, 20) + 1).tolist() == [1, 6, 5, 3, 6, 4, 4, 7, 7, 3, 5, 7, 5, 2, 4, 4, 1, 6, 6, 5]
    assert (rng.index(70000, 5) + 1).tolist() == [56162, 610, 37103, 39768, 60904]


def test_p_adjust_matches_r():
    p = [0.01, 0.04, 0.03, 0.2]
    # p.adjust(c(.01,.04,.03,.2), "holm") / "BH"
    assert np.allclose(p_adjust(p, "holm"), [0.04, 0.09, 0.09, 0.2])
    assert np.allclose(p_adjust(p, "bh"), [0.04, 0.05333333333333334, 0.05333333333333334, 0.2])
    assert np.allclose(p_adjust(p, "bonferroni"), [0.04, 0.16, 0.12, 0.8])
