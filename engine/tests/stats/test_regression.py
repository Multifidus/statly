"""Regression family vs R (fixtures/r/regression.R -> fixtures/expected/regression/*.json).

Tolerance 1e-6 for lm-based analyses and 1e-4 for the iterative logistic / ordinal models (SPEC §12).
Coefficients, model summaries, blocks, thresholds, VIF, Brant and classification tables are compared with
the result's chart_data records; statistics and effect sizes by (key, term); assumptions by test key.
"""

from __future__ import annotations

import copy

import numpy as np
import pandas as pd
import pytest

from statly_engine.contracts import AnalysisResult
from statly_engine.errors import InvalidParams
from statly_engine.stats import registry
from statly_engine.stats.regression_logistic import fit_logit, fit_polr

from .conftest import close, fixture_paths, load_data, load_fixture, request_for, run_fixture
from .test_rpc_analysis import _import_stacked, _request

CASES = fixture_paths("regression")
IDS = {"regression.linear", "regression.hierarchical", "regression.logistic", "regression.ordinal"}
ITERATIVE = {"regression.logistic", "regression.ordinal"}
SKIP_KEYS = {"term", "label", "threshold", "model", "n_over", "cutoff"}


def _tol(fx) -> float:
    return 1e-4 if fx["analysis_id"] in ITERATIVE else 1e-6


def test_inventory_and_registry():
    assert len(CASES) >= 18
    assert {load_fixture(p)["analysis_id"] for p in CASES} == IDS
    assert IDS <= set(registry.load_all())


def _k(v) -> str:
    return str(float(v)) if isinstance(v, (int, float)) and not isinstance(v, bool) else str(v)


def _cmp_records(got: list[dict], want: list[dict], key: str, tol: float, where: str) -> None:
    by = {_k(g[key]): g for g in got}
    assert len(got) == len(want), f"{where}: {len(got)} records, R has {len(want)}"
    for w in want:
        g = by.get(_k(w[key]))
        assert g is not None, f"{where}: no record {w[key]!r} (have {list(by)})"
        for k, v in w.items():
            if k in SKIP_KEYS or k.startswith("confint_") or isinstance(v, (str, list, dict, bool)):
                continue
            close(g.get(k), v, tol, f"{where}[{w[key]}].{k}")


@pytest.mark.parametrize("path", CASES, ids=lambda p: p.stem)
def test_regression_matches_r(path):
    fx = load_fixture(path)
    exp = fx["expected"]
    where = f"{fx['analysis_id']}/{fx['case']}"
    if exp is None:
        with pytest.raises(InvalidParams):
            run_fixture(fx)
        return
    res = run_fixture(fx)
    tol = _tol(fx)
    assert res["inputs"]["n_used"] == exp["n_used"] and res["inputs"]["n_excluded"] == exp["n_excluded"], where
    if exp.get("warning"):  # quasi-separation: a result with a serious warning, not a crash
        assert any(w["code"] == exp["warning"] and w["severity"] == "serious" for w in res["warnings"]), where
        assert res["plain_language_summary"] and res["apa_table"]["rows"]
        return

    assert res["statistics"][0]["key"] == exp["statistics"][0]["key"], f"{where}: headline"
    assert res["statistics"][0]["term"] == exp["statistics"][0]["term"], f"{where}: headline term"
    for s in exp["statistics"]:
        hits = [r for r in res["statistics"] if r["key"] == s["key"] and r["term"] == s["term"]]
        assert len(hits) == 1, f"{where}: statistic {s['key']}[{s['term']}]"
        w = f"{where}/stat {s['key']}[{s['term']}]"
        close(hits[0]["value"], s["value"], tol, w)
        close(hits[0]["p"], s["p"], tol, w + ".p")
        assert len(hits[0]["df"]) == len(s["df"]), w + ".df"
        for g, e in zip(hits[0]["df"], s["df"]):
            close(g, e, tol, w + ".df")
    for e in exp["effect_sizes"]:
        hits = [r for r in res["effect_sizes"] if r["key"] == e["key"] and r["term"] == e.get("term")]
        assert len(hits) == 1, f"{where}: effect {e['key']}[{e.get('term')}]"
        w = f"{where}/effect {e['key']}[{e.get('term')}]"
        close(hits[0]["value"], e["value"], tol, w)
        ci = hits[0]["ci"] or {"lower": None, "upper": None}
        close(ci["lower"], e["ci_lower"], tol, w + ".lower")
        close(ci["upper"], e["ci_upper"], tol, w + ".upper")

    cd = res["chart_data"]
    _cmp_records(cd["coefficients"], exp["coefficients"], "term", tol, where + "/coef")
    _cmp_records(cd["model_summary"], [exp["model"]], "df" if "chi2" in exp["model"] else "df1", tol, where + "/model")
    _cmp_records(cd.get("vif", []), exp.get("vif", []), "term", tol, where + "/vif")
    if "blocks" in exp:
        _cmp_records(cd["blocks"], exp["blocks"], "block", tol, where + "/blocks")
        for i, coefs in enumerate(exp["block_coefficients"], start=1):
            _cmp_records([r for r in cd["block_coefficients"] if r["model"] == i], coefs, "term", tol, f"{where}/m{i}")
    if "thresholds" in exp:
        _cmp_records(cd["thresholds"], exp["thresholds"], "threshold", tol, where + "/thresholds")
    if "brant" in exp:
        _cmp_records(cd["brant"], exp["brant"], "term", tol, where + "/brant")
    if "classification" in exp:
        c = exp["classification"]
        rows = cd["classification"]
        assert [rows[0]["predicted_no"], rows[0]["predicted_yes"], rows[1]["predicted_no"], rows[1]["predicted_yes"]] \
            == [c["tn"], c["fp"], c["fn"], c["tp"]], where
        close(rows[2]["percent_correct"], c["percent_correct"], 1e-9, where + "/pct")
    for dc in exp.get("dummy_coding", []):
        recs = [r for r in cd["dummy_coding"] if r["variable"] == dc["variable"]]
        assert [r["level"] for r in recs if r["is_reference"]][0] == dc["reference"]
        assert list(dict.fromkeys(r["level"] for r in recs)) == dc["levels"]

    for a in exp["assumptions"]:
        hits = [r for r in res["assumptions"] if r["test_used"] and r["test_used"]["key"] == a["test"]]
        assert len(hits) == 1, f"{where}: assumption {a['test']}"
        h, w = hits[0], f"{where}/assumption {a['test']}"
        assert h["applies_to"]["n"] == a["n"], w + ".n"
        close(h["statistic"]["value"] if h["statistic"] else None, a["statistic"], tol, w)
        close(h["p"], a["p"], tol, w + ".p")
        assert len(h["statistic"]["df"]) == len(a["df"]), w + ".df"
        for g, e in zip(h["statistic"]["df"], a["df"]):
            close(g, e, tol, w + ".df")
        if a["test"] == "cooks_distance":
            assert sum(r["influential"] for r in cd["cooks_distance"]) == a["n_over"], w + ".n_over"
    assert all(ref["data_key"] in cd for x in res["assumptions"] for ref in x["chart_refs"]), f"{where}: chart refs"
    assert res["plain_language_summary"] and res["apa_sentence"] and res["apa_table"]["rows"]


def test_polr_matches_default_polr_to_optim_precision():
    """Our Newton MLE equals polr's refined optimum; polr's default optim stop is within 1e-3 of it."""
    fx = load_fixture(fixture_paths("regression")[0].parent / "four_levels.json")
    res = run_fixture(fx)
    got = [r["estimate"] for r in res["chart_data"]["coefficients"]]
    assert np.allclose(got, fx["expected"]["polr_default"]["coefficients"], atol=1e-3)


def test_profile_ci_is_exact_root():
    """The OR CIs are the exact profile-likelihood roots; R's confint() spline is within 1e-3."""
    fx = load_fixture(fixture_paths("regression")[0].parent / "balanced.json")
    res = run_fixture(fx)
    for g, w in zip(res["chart_data"]["coefficients"], fx["expected"]["coefficients"]):
        assert abs(g["ci_lower"] - w["confint_ci_lower"]) < 1e-3 and abs(g["ci_upper"] - w["confint_ci_upper"]) < 1e-3


# ---------------------------------------------------------------------------
# Behaviour beyond the fixtures
# ---------------------------------------------------------------------------
def _run(dataset: str, analysis_id: str, variables: dict, meta: dict | None = None, **kw) -> dict:
    fx = {"analysis_id": analysis_id, "case": "adhoc", "dataset": dataset, "request": {"variables": variables, **kw}}
    return registry.run(load_data(dataset), request_for(fx), meta)


def test_value_labels_set_reference_and_categorical_option():
    meta = {"variables": [{"name": "region", "label": "Region", "level": "nominal", "dtype": "string",
                           "value_labels": [{"value": "Urban", "label": "City"}, {"value": "Rural", "label": "Country"},
                                            {"value": "Suburban", "label": "Suburbs"}]},
                          {"name": "score", "dtype": "float", "level": "continuous"},
                          {"name": "hours", "dtype": "float", "level": "continuous"},
                          {"name": "female", "dtype": "integer", "level": "continuous"}]}
    res = _run("reg_multiple.csv", "regression.linear", {"outcome": ["score"], "predictors": ["hours", "region"]}, meta)
    terms = [r["term"] for r in res["chart_data"]["coefficients"]]
    assert terms == ["(Intercept)", "hours", "region[Rural]", "region[Suburban]"]  # first value label = reference
    assert any(t["title"] == "Dummy Coding of Region" for t in res["additional_tables"])
    # a numeric 0/1 predictor forced categorical gives the same fit as the numeric one
    a = _run("reg_multiple.csv", "regression.linear", {"outcome": ["score"], "predictors": ["female"]})
    b = _run("reg_multiple.csv", "regression.linear", {"outcome": ["score"], "predictors": ["female"]},
             options={"categorical": ["female"]})
    assert b["chart_data"]["coefficients"][1]["term"] == "female[1]"
    close(a["statistics"][0]["value"], b["statistics"][0]["value"], 1e-12, "forced categorical F")


@pytest.mark.parametrize("analysis_id, variables, kw", [
    ("regression.linear", {"outcome": ["score"], "predictors": ["hours"]}, {"tails": "greater"}),
    ("regression.linear", {"outcome": ["score"], "predictors": ["region"]}, {"options": {"reference": {"region": "Mars"}}}),
    ("regression.linear", {"outcome": ["score"], "predictors": ["hours", "hours"]}, {}),
    ("regression.hierarchical", {"outcome": ["score"], "block_1": ["hours"], "block_2": ["hours"]}, {}),
    ("regression.hierarchical", {"outcome": ["score"], "block_1": ["hours"], "block_2": ["female"],
                                 "block_4": ["motivation"]}, {}),
    ("regression.logistic", {"outcome": ["region"], "predictors": ["hours"]}, {}),
    ("regression.ordinal", {"outcome": ["female"], "predictors": ["hours"]}, {}),
])
def test_invalid_requests(analysis_id, variables, kw):
    with pytest.raises(InvalidParams):
        _run("reg_multiple.csv", analysis_id, variables, **kw)


def test_too_few_cases():
    df = load_data("reg_small.csv").head(3)
    fx = {"analysis_id": "regression.linear", "case": "adhoc", "dataset": "",
          "request": {"variables": {"outcome": ["y"], "predictors": ["x1", "x2"]}}}
    with pytest.raises(InvalidParams, match="more people than coefficients"):
        registry.run(df, request_for(fx))


def test_logit_and_polr_fitters_agree_for_two_levels():
    """A 2-level cumulative logit is the binary logit with the sign flipped (sanity check of the Hessian)."""
    df = load_data("reg_logistic.csv").dropna(subset=["hours", "motivation"])
    X = df[["hours", "motivation"]].to_numpy(float)
    y = df["pass"].to_numpy(float)
    lg = fit_logit(np.column_stack([np.ones(len(y)), X]), y)
    po = fit_polr(X, y.astype(int), 2)
    assert np.allclose(po["beta"], lg["coef"][1:], atol=1e-8) and np.isclose(po["zeta"][0], -lg["coef"][0], atol=1e-8)
    assert np.allclose(np.sqrt(np.diag(po["vcov"]))[:2], np.sqrt(np.diag(lg["vcov"]))[1:], rtol=1e-6)


def test_regression_via_rpc(engine):
    meta = _import_stacked(engine, "one_group_prepost_likert")
    runs = {
        "regression.linear": {"outcome": ["Q3_1"], "predictors": ["Q3_2", "Time"]},
        "regression.hierarchical": {"outcome": ["Q3_1"], "block_1": ["Time"], "block_2": ["Q3_2", "Q3_3"]},
        "regression.logistic": {"outcome": ["Time"], "predictors": ["Q3_1", "Q3_2"]},
        "regression.ordinal": {"outcome": ["Q3_1"], "predictors": ["Time", "Q3_2"]},
    }
    for aid, variables in runs.items():
        res = engine.call("analysis.run", _request(meta, aid, variables))
        AnalysisResult.model_validate(res)
        assert res["analysis_id"] == aid and res["statistics"][0]["p"] is not None
    ids = {a["analysis_id"] for a in engine.call("analysis.list")["analyses"]}
    assert IDS <= ids
