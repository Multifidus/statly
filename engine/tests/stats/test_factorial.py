"""Factorial family vs R (fixtures/r/factorial.R -> fixtures/expected/factorial/*.json), within 1e-6.

Covers anova.factorial, anova.mixed, anova.art and posthoc.simple_effects. Statistics, descriptives and
n go through `assert_matches_fixture`; effect sizes carry a term, so they are matched here by
(key, term), as are the assumption records (by test + scope kind + label), the Type III sums of squares
(APA table), and the emmeans marginal / cell means (chart_data).
"""

from __future__ import annotations

import copy

import numpy as np
import pandas as pd
import pytest

from statly_engine.errors import InvalidParams
from statly_engine.stats import anova_mixed, registry, sphericity

from .conftest import TOL, assert_matches_fixture, close, fixture_paths, load_data, load_fixture, request_for, run_fixture

CASES = fixture_paths("factorial")
IDS = {"anova.factorial", "anova.mixed", "anova.art", "posthoc.simple_effects"}


def test_inventory_and_registry():
    assert len(CASES) >= 25
    assert {load_fixture(p)["analysis_id"] for p in CASES} == IDS
    assert IDS <= set(registry.load_all())


@pytest.mark.parametrize("path", CASES, ids=lambda p: p.stem)
def test_factorial_matches_r(path):
    fx = load_fixture(path)
    if fx["expected"] is None:
        with pytest.raises(InvalidParams):
            run_fixture(fx)
        return
    res = run_fixture(fx)
    exp = fx["expected"]
    base = copy.deepcopy(fx)
    base["expected"]["effect_sizes"] = []
    assert_matches_fixture(res, base)
    where = f"{fx['analysis_id']}/{fx['case']}"
    for e in exp["effect_sizes"]:
        hits = [r for r in res["effect_sizes"] if r["key"] == e["key"] and r["term"] == e["term"]]
        assert len(hits) == 1, f"{where}: effect {e['key']} [{e['term']}] missing"
        got, w = hits[0], f"{where}/effect {e['key']}[{e['term']}]"
        close(got["value"], e["value"], TOL, w + ".value")
        ci = got["ci"] or {"lower": None, "upper": None}
        close(ci["lower"], e["ci_lower"], TOL, w + ".ci_lower")
        close(ci["upper"], e["ci_upper"], TOL, w + ".ci_upper")
    for a in exp.get("assumptions_ext", []):
        hits = [r for r in res["assumptions"] if r["test_used"] and r["test_used"]["key"] == a["test"]
                and r["applies_to"]["kind"] == a["kind"] and r["applies_to"]["label"] == a["label"]]
        assert len(hits) == 1, f"{where}: assumption {a['test']} [{a['kind']} {a['label']}] missing"
        got, w = hits[0], f"{where}/{a['test']}[{a['label']}]"
        assert got["applies_to"]["n"] == a["n"], f"{w}: n"
        close(got["statistic"]["value"] if got["statistic"] else None, a["statistic"], TOL, w + ".statistic")
        close(got["p"], a["p"], TOL, w + ".p")
        if a["statistic"] is not None:
            assert len(got["statistic"]["df"]) == len(a["df"])
            for g, e in zip(got["statistic"]["df"], a["df"]):
                close(g, e, TOL, w + ".df")
    for em in exp.get("emmeans", []):
        _match_emmean(res, em, fx, where)
    if "sums_of_squares" in exp:
        ss = {"".join(r["text"] for r in row["cells"][0]["text"]): row for row in res["apa_table"]["rows"]}
        assert set(exp["sums_of_squares"]) <= set(ss), f"{where}: table sources {set(ss)}"
        for src, want in exp["sums_of_squares"].items():
            close(ss[src]["cells"][1]["value"], want, TOL, f"{where}/SS[{src}]")
    if "epsilon_hf_uncapped" in exp:
        close(_hf_raw(fx), exp["epsilon_hf_uncapped"], TOL, where + ".hf_raw")
    assert res["plain_language_summary"] and res["apa_sentence"] and res["apa_table"]["rows"]


def _hf_raw(fx) -> float:
    from statly_engine.contracts import AnalysisRequest
    d = anova_mixed.mixed_data(load_data(fx["dataset"]), AnalysisRequest.model_validate(request_for(fx)), None)
    return anova_mixed.pooled_sphericity(d["y"], d["g"], len(d["gl"])).hf_raw


def _match_emmean(res, em, fx, where):
    lab = em["label"]
    if em["kind"] == "marginal":
        (factor, level), = lab.items()
        hits = [r for r in res["chart_data"]["marginal_means"] if r["factor"] == factor and r["level"] == str(level)]
    else:
        keys = list(lab)
        if fx["analysis_id"] == "anova.mixed":      # R label: {group, time}; chart: x = time, series = group
            x, s = str(lab[keys[1]]), str(lab[keys[0]])
        else:
            x, s = str(lab[keys[0]]), str(lab[keys[1]])
        hits = [r for r in res["chart_data"]["interaction_plot"] if r["x"] == x and r["series"] == s]
    assert len(hits) == 1, f"{where}: emmean {lab} missing"
    got, w = hits[0], f"{where}/emmean {lab}"
    for k, rk in (("emmean", "emmean"), ("se", "se"), ("df", "df"), ("ci_lower", "lower"), ("ci_upper", "upper")):
        close(got[k], em[rk], TOL, f"{w}.{k}")


# ---------------------------------------------------------------------------
# Targeted checks
# ---------------------------------------------------------------------------
def _run(dataset: str, analysis_id: str, variables: dict, **kw) -> dict:
    fx = {"analysis_id": analysis_id, "case": "adhoc", "dataset": dataset, "request": {"variables": variables, **kw}}
    return registry.run(load_data(dataset), request_for(fx))


FV = {"outcome": ["score"], "factors": ["method", "gender"]}
MW = {"measures": ["t1", "t2", "t3"], "between": ["group"]}


def test_factorial_balanced_type3_equals_type1_and_one_factor_reduces():
    res = _run("fact_2x2.csv", "anova.factorial", FV)
    df = load_data("fact_2x2.csv")
    import statsmodels.formula.api as smf
    from statsmodels.stats.anova import anova_lm
    t1 = anova_lm(smf.ols("score ~ C(method) * C(gender)", df).fit(), typ=1)
    fs = [s["value"] for s in res["statistics"] if s["key"] == "F"]
    assert np.allclose(fs, t1["F"].to_numpy()[:3], rtol=1e-10)


def test_empty_cell_and_single_level_are_refused():
    with pytest.raises(InvalidParams, match="G8"):
        _run("fact_empty_cell.csv", "anova.factorial", {"outcome": ["score"], "factors": ["method", "grade"]})
    df = load_data("fact_2x2.csv")
    df = df[df["gender"] == "Female"]
    fx = {"analysis_id": "anova.factorial", "case": "x", "request": {"variables": FV}}
    with pytest.raises(InvalidParams):
        registry.run(df, request_for(fx))
    with pytest.raises(InvalidParams):
        _run("fact_2x2.csv", "anova.factorial", FV, tails="greater")


def test_unbalanced_warning_and_levels():
    res = _run("fact_2x3.csv", "anova.factorial", {"outcome": ["score"], "factors": ["method", "grade"]})
    codes = {w["code"] for w in res["warnings"]}
    assert {"unbalanced_design", "missing_data", "small_sample"} <= codes
    bal = _run("fact_2x2.csv", "anova.factorial", FV)
    assert "unbalanced_design" not in {w["code"] for w in bal["warnings"]}


def test_mixed_pooled_sphericity_reduces_to_one_group():
    rng = np.random.default_rng(3)
    y = rng.normal(size=(14, 4)) + rng.normal(size=(14, 1)) + np.arange(4) * rng.normal(size=(14, 1))
    one = sphericity.sphericity(y)
    pooled = anova_mixed.pooled_sphericity(y, np.zeros(14, int), 1)
    for a, b in ((one.w, pooled.w), (one.p, pooled.p), (one.gg, pooled.gg), (one.hf_raw, pooled.hf_raw)):
        assert np.isclose(a, b, rtol=1e-12)


def test_mixed_one_group_structure_and_correction_option():
    res = _run("fact_mixed_3x3_wide.csv", "anova.mixed", MW)
    within = [s for s in res["statistics"] if s["term"] == "Time"]
    assert [s["key"] for s in within][:3] == ["F_gg", "F", "F_hf"]    # auto -> GG (Mauchly p < .05)
    res = _run("fact_mixed_3x3_wide.csv", "anova.mixed", MW, options={"correction": "none"})
    assert [s["key"] for s in res["statistics"] if s["term"] == "Time"][0] == "F"
    with pytest.raises(InvalidParams):
        _run("fact_mixed_3x3_wide.csv", "anova.mixed", MW, options={"correction": "bogus"})
    box = next(a for a in res["assumptions"] if a["test_used"]["key"] == "box_m")
    assert box["assumption"] == "equal_covariance_matrices"


def test_mixed_wide_and_long_agree():
    wide = load_data("fact_mixed_2x3_wide.csv")
    long = wide.melt(id_vars=["id", "group"], value_vars=["t1", "t2", "t3"], var_name="time", value_name="score")
    fx = {"analysis_id": "anova.mixed", "case": "x",
          "request": {"variables": {"outcome": ["score"], "time": ["time"], "subject_id": ["id"], "between": ["group"]}}}
    rl = registry.run(long, request_for(fx))
    rw = _run("fact_mixed_2x3_wide.csv", "anova.mixed", MW)
    assert rl["inputs"]["n_used"] == rw["inputs"]["n_used"] == 24
    for a, b in zip(rl["statistics"], rw["statistics"]):
        assert a["key"] == b["key"] and np.isclose(a["value"], b["value"], rtol=1e-12)


def test_art_aligned_responses_remove_other_effects():
    """ARTool's check: on the aligned (unranked) responses for one effect, the other effects are 0 (balanced)."""
    from statly_engine.stats import anova_factorial, art
    df = load_data("fact_3x3.csv")
    a = pd.factorize(df["method"], sort=True)[0]
    b = pd.factorize(df["school"], sort=True)[0]
    al = art.aligned(df["score"].to_numpy(float), a, b)
    for key, others in (("A", ("B", "AB")), ("B", ("A", "AB")), ("AB", ("A", "B"))):
        t = anova_factorial.type3(al[key], a, b, 3, 3)
        for o in others:
            assert t[o]["ss"] < 1e-9 * t["error"]["ss"]


def test_simple_effects_by_validation():
    with pytest.raises(InvalidParams):
        _run("fact_2x2.csv", "posthoc.simple_effects", FV, options={"by": "nonsense"})
    with pytest.raises(InvalidParams):
        _run("fact_2x2.csv", "posthoc.simple_effects", FV, options={"adjust": "tukey"})
    r = _run("fact_mixed_2x3_wide.csv", "posthoc.simple_effects", MW, options={"by": "time"})
    assert r["statistics"][0]["term"] == "group at t1"


def test_mixed_simple_effects_two_groups_equal_t_squared():
    """Groups at one time point: F = t² of the pooled-covariance group contrast."""
    r = _run("fact_mixed_2x3_wide.csv", "posthoc.simple_effects", MW, options={"by": "within"})
    f = [s for s in r["statistics"] if s["key"] == "F"]
    t = [s for s in r["statistics"] if s["key"] == "t"]
    assert len(f) == len(t) == 3
    for a, b in zip(f, t):
        assert np.isclose(a["value"], b["value"] ** 2, rtol=1e-10)


def test_all_four_ids_run_through_rpc(engine):
    """analysis.run on an imported CSV (real stdio server) for each analysis id."""
    from .conftest import DATA
    runs = [("fact_2x3.csv", "anova.factorial", {"outcome": ["score"], "factors": ["method", "grade"]}),
            ("fact_2x3.csv", "anova.art", {"outcome": ["score"], "factors": ["method", "grade"]}),
            ("fact_mixed_2x3_wide.csv", "anova.mixed", MW),
            ("fact_mixed_2x3_wide.csv", "posthoc.simple_effects", MW)]
    for name, aid, variables in runs:
        pv = engine.call("dataset.import_preview", {"files": [{"path": str(DATA / name), "sheet_name": None}],
                                                    "qualtrics_mode": "off", "stack_onto_dataset_id": None})
        f = pv["files"][0]
        meta = engine.call("dataset.import", {
            "preview_id": pv["preview_id"], "row_filters": [], "variables": [], "stack": None,
            "files": [{"file_id": f["file_id"], "sheet_name": f["sheet_name"], "encoding": f["encoding"],
                       "delimiter": f["delimiter"], "qualtrics_header_rows": f["qualtrics"]["header_rows"], "time_label": None,
                       "drop_columns": []}]})["dataset_meta"]
        res = engine.call("analysis.run", {"schema_version": 1, "request_id": f"r-{aid}", "analysis_id": aid,
                                           "dataset_id": meta["dataset_id"], "snapshot_id": meta["snapshot_id"],
                                           "variables": variables, "subset": [], "options": {}, "corrections": [],
                                           "alpha": 0.05, "tails": "two_sided", "ci_level": 0.95})
        direct = _run(name, aid, variables)
        assert res["analysis_id"] == aid
        assert [s["value"] for s in res["statistics"]] == pytest.approx([s["value"] for s in direct["statistics"]],
                                                                         rel=1e-12)
