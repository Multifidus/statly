"""validity.efa / validity.cfa reproduce fixtures/r/factor.R (psych::fa, psych::fa.parallel, lavaan::cfa).

Tolerances (SPEC §12): KMO, Bartlett and the correlation eigenvalues 1e-6; everything fitted iteratively
(loadings, communalities, factor correlations, parallel-analysis eigenvalues, CFA estimates and fit) 1e-4.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from statly_engine.errors import InvalidParams
from statly_engine.stats import factor_utils as fu
from statly_engine.stats import registry
from statly_engine.stats.effect_sizes_rank import RRandom

from .conftest import TOL, assert_matches_fixture, close, fixture_paths, load_data, load_fixture, request_for, run_fixture

FIT_TOL = 1e-4
EFA = [p for p in fixture_paths("factor") if p.stem.startswith("efa_")]
CFA = [p for p in fixture_paths("factor") if p.stem.startswith("cfa_")]
_id = lambda p: p.stem  # noqa: E731


def test_inventory():
    assert len(EFA) >= 9 and len(CFA) >= 6
    assert "validity.efa" in registry.load_all() and "validity.cfa" in registry.REGISTRY


def _vec(got, want, tol, where):
    assert len(got) == len(want), where
    for i, (g, w) in enumerate(zip(got, want)):
        close(g, w, tol, f"{where}[{i}]")


@pytest.mark.parametrize("path", EFA, ids=_id)
def test_efa_matches_psych(path):
    fx = load_fixture(path)
    exp = fx["expected"]
    res = run_fixture(fx)
    assert_matches_fixture(res, fx, tol=TOL)                       # n, KMO, Bartlett at 1e-6
    cd = res["chart_data"]
    items = fx["request"]["variables"]["items"]
    k = exp["n_factors"]
    stats = {s["key"]: s for s in res["statistics"]}
    assert stats["n_factors"]["value"] == k
    assert stats["parallel_suggested"]["value"] == exp["parallel"]["suggested"]
    com = {r["item"]: r for r in cd["communalities"]}
    _vec([com[v]["kmo"] for v in items], exp["kmo_items"], TOL, "kmo_items")
    scree = sorted(cd["scree"], key=lambda r: r["number"])
    _vec([r["eigenvalue"] for r in scree], exp["eigenvalues"], TOL, "eigenvalues")
    _vec([r["fitted_factor_eigenvalue"] for r in scree], exp["factor_eigenvalues"], FIT_TOL, "factor_eigenvalues")
    _vec([r["factor_eigenvalue"] for r in scree], exp["parallel"]["observed"], FIT_TOL, "pa.observed")
    _vec([r["simulated_mean"] for r in scree], exp["parallel"]["sim_mean"], FIT_TOL, "pa.sim_mean")
    _vec([r["simulated_p95"] for r in scree], exp["parallel"]["sim_p95"], FIT_TOL, "pa.sim_p95")
    load = {(r["item"], r["factor_index"]): r["loading"] for r in cd["loadings"]}
    for i, v in enumerate(items):
        _vec([load[(v, j + 1)] for j in range(k)], exp["loadings"][i], FIT_TOL, f"loadings[{v}]")
    _vec([com[v]["communality"] for v in items], exp["communalities"], FIT_TOL, "communalities")
    _vec([com[v]["uniqueness"] for v in items], exp["uniquenesses"], FIT_TOL, "uniquenesses")
    var = sorted(cd["variance"], key=lambda r: r["factor"])
    _vec([r["ss_loadings"] for r in var], exp["ss_loadings"], FIT_TOL, "ss_loadings")
    _vec([r["proportion"] for r in var], exp["proportion_var"], FIT_TOL, "proportion_var")
    if exp["phi"] is None:
        assert "factor_correlations" not in cd
    else:
        phi = {(r["factor_a"], r["factor_b"]): r["r"] for r in cd["factor_correlations"]}
        for a in range(k):
            for c in range(a + 1, k):
                close(phi[(f"F{a + 1}", f"F{c + 1}")], exp["phi"][a][c], FIT_TOL, f"phi[{a},{c}]")
    codes = {w["code"] for w in res["warnings"]}
    assert ("factor_sample_size" in codes) == (exp["n_used"] < 100)
    assert ("missing_data" in codes) == bool(load_data(fx["dataset"]).isna().any().any())
    assert res["apa_table"] and res["apa_sentence"] and res["plain_language_summary"]
    assert len(res["additional_tables"]) >= 3


def _cfa_row(got, want, where):
    for key in ("est", "se", "z", "p", "std", "std_se", "std_p"):
        if key not in want:
            continue
        gk = {"est": "estimate"}.get(key, key)
        close(got.get(gk), want[key], FIT_TOL, f"{where}.{key}")


@pytest.mark.parametrize("path", CFA, ids=_id)
def test_cfa_matches_lavaan(path):
    fx = load_fixture(path)
    exp = fx["expected"]
    res = run_fixture(fx)
    assert_matches_fixture(res, fx, tol=FIT_TOL)
    cd = res["chart_data"]
    stats = {s["key"]: s for s in res["statistics"]}
    close(stats["baseline_chi2"]["value"], exp["baseline_chi2"], FIT_TOL, "baseline_chi2")
    close(stats["baseline_chi2"]["df"][0], exp["baseline_df"], FIT_TOL, "baseline_df")
    loads = {(r["factor"], r["item"]): r for r in cd["loadings"]}
    assert len(loads) == len(exp["loadings"])
    for e in exp["loadings"]:
        _cfa_row(loads[(e["factor"], e["item"])], e, f"{fx['case']}/{e['factor']}=~{e['item']}")
    resid = {r["item"]: r for r in cd["residual_variances"]}
    for e in exp["residual_variances"]:
        _cfa_row(resid[e["item"]], e, f"{fx['case']}/{e['item']}~~{e['item']}")
    fvar = {r["factor"]: r for r in cd["factor_variances"]}
    for e in exp["factor_variances"]:
        _cfa_row(fvar[e["factor"]], {k: e[k] for k in ("est", "se", "z", "p")}, f"{fx['case']}/{e['factor']} var")
    covs = {(r["factor_a"], r["factor_b"]): r for r in cd.get("factor_covariances", [])}
    assert len(covs) == len(exp["factor_covariances"])
    for e in exp["factor_covariances"]:
        _cfa_row(covs[(e["factor_a"], e["factor_b"])], e, f"{fx['case']}/{e['factor_a']}~~{e['factor_b']}")
    # Path diagram: one latent node per factor, one observed node per item, an edge per loading / covariance.
    nodes = [r for r in cd["path_diagram"] if r["kind"] == "node"]
    edges = [r for r in cd["path_diagram"] if r["kind"] == "edge"]
    model = fx["request"]["options"]["model"]
    assert sum(n["node_type"] == "latent" for n in nodes) == len(model)
    assert sum(n["node_type"] == "observed" for n in nodes) == len(fx["request"]["variables"]["items"])
    assert len(edges) == len(exp["loadings"]) + len(exp["factor_covariances"])
    for e in (e for e in edges if e["edge_type"] == "loading"):
        assert e["weight"] == loads[(e["from"], e["to"])]["std"]
    codes = {w["code"] for w in res["warnings"]}
    assert ("factor_sample_size" in codes) == (exp["n_used"] < 100)
    assert ("missing_data" in codes) == (exp["n_excluded"] > 0)
    if "misspecified" in fx["case"]:
        assert "does not fit the data well" in res["plain_language_summary"]
    assert res["apa_table"] and res["apa_sentence"]


# ---------------------------------------------------------------------------
# Building blocks
# ---------------------------------------------------------------------------
def test_rnorm_and_sample_reproduce_r():
    # set.seed(12345); rnorm(3)   and   set.seed(7); sample(10, 5, TRUE)
    got = fu.rnorm(RRandom(12345), 3)
    for g, w in zip(got, (0.58552881784385558, 0.70946601750952443, -0.10930331468105391)):
        assert abs(g - w) < 1e-15
    assert list(RRandom(7).index(10, 5) + 1) == [10, 3, 7, 2, 10]


def test_rotations_preserve_communalities():
    x = load_data("fac_3f15_n300.csv").to_numpy(float)
    r = fu.pairwise_cor(x)
    lam = fu.sign_unrotated(fu.fit_minres(r, 3)["loadings"])
    h2 = np.sum(lam ** 2, axis=1)
    for method in ("oblimin", "varimax", "promax"):
        rot = fu.rotate(lam, method)
        l, phi = rot["loadings"], rot["phi"]
        model = l @ (phi if phi is not None else np.eye(3)) @ l.T
        assert np.allclose(np.diag(model), h2, atol=1e-10), method
        if phi is not None:
            assert np.allclose(np.diag(phi), 1, atol=1e-10)


def _req(analysis_id, items, **options):
    fx = {"analysis_id": analysis_id, "case": "unit", "request": {"variables": {"items": items}, "options": options}}
    return request_for(fx)


def test_efa_rejects_bad_input():
    df = load_data("fac_2f10_n300.csv")
    items = list(df.columns)
    with pytest.raises(InvalidParams):
        registry.run(df, _req("validity.efa", items, n_factors=7))          # more factors than 10 items identify
    with pytest.raises(InvalidParams):
        registry.run(df, _req("validity.efa", items, rotation="quartimax"))
    flat = df.assign(q1=3)
    with pytest.raises(InvalidParams, match="same answer"):
        registry.run(flat, _req("validity.efa", items, n_factors=2))


def test_efa_suppression_and_defaults():
    df = load_data("fac_3f15_n300.csv")
    res = registry.run(df, _req("validity.efa", list(df.columns), suppress=0.5, parallel_iterations=20))
    assert res["inputs"]["request"]["options"]["suppress"] == 0.5
    cells = [c for row in res["apa_table"]["rows"] if row["kind"] == "data" for c in row["cells"][1:-2]]
    shown = [c for c in cells if c["type"] == "number"]
    assert shown and all(abs(c["value"]) >= 0.5 for c in shown)
    assert any(c["type"] == "empty" for c in cells)


def test_cfa_rejects_bad_models():
    df = load_data("fac_3f15_n300.csv")
    items = [f"q{i}" for i in range(1, 7)]
    with pytest.raises(InvalidParams):
        registry.run(df, _req("validity.cfa", items, model={"A": ["q1", "q2", "q3"], "B": ["q4", "q5", "q99"]}))
    with pytest.raises(InvalidParams):
        registry.run(df, _req("validity.cfa", items, model={"A": ["q1", "q2", "q3", "q4", "q5"], "B": ["q6"]}))
    with pytest.raises(InvalidParams):
        registry.run(df, _req("validity.cfa", items, model={"A": ["q1", "q2", "q3"]}))   # q4-q6 unassigned
    with pytest.raises(InvalidParams):
        registry.run(df, _req("validity.cfa", ["q1", "q2", "q3"], model={"A": ["q1", "q2"], "B": ["q3", "q1"]}))


def test_cfa_default_model_is_one_factor():
    df = load_data("fac_3f15_n300.csv")
    items = [f"q{i}" for i in range(11, 16)]
    res = registry.run(df, _req("validity.cfa", items))
    fx = load_fixture(next(p for p in CFA if p.stem == "cfa_1f_n300"))
    for s in fx["expected"]["statistics"]:
        got = next(r for r in res["statistics"] if r["key"] == s["key"])
        close(got["value"], s["value"], FIT_TOL, s["key"])


def test_cfa_heywood_warning():
    rng = np.random.default_rng(3)
    f = rng.normal(size=(80, 2))
    x = np.column_stack([f[:, 0] + rng.normal(scale=.6, size=80) for _ in range(3)] +
                        [f[:, 1] * 3 + rng.normal(scale=.01, size=80), f[:, 1] + rng.normal(scale=1.5, size=80),
                         f[:, 0] * .2 + rng.normal(scale=1.5, size=80)])
    df = pd.DataFrame(x, columns=[f"v{i}" for i in range(6)])
    res = registry.run(df, _req("validity.cfa", list(df.columns),
                                model={"A": ["v0", "v1", "v2", "v5"], "B": ["v3", "v4", "v5"]}))
    codes = {w["code"] for w in res["warnings"]}
    assert "factor_sample_size" in codes
    std = [r["std"] for r in res["chart_data"]["loadings"]]
    resid = [r["estimate"] for r in res["chart_data"]["residual_variances"]]
    assert ("heywood_case" in codes) == (any(abs(s) > 1 for s in std) or any(v < 0 for v in resid))


def test_efa_and_cfa_through_analysis_run(engine):
    from .test_rpc_analysis import _import_stacked, _request
    meta = _import_stacked(engine, "one_group_prepost_likert")
    items = [f"Q3_{i}" for i in range(1, 11)]
    efa = engine.call("analysis.run", _request(meta, "validity.efa", {"items": items},
                                               options={"n_factors": 2, "parallel_iterations": 20}))
    assert efa["analysis_id"] == "validity.efa" and efa["statistics"][0]["key"] == "kmo"
    cfa = engine.call("analysis.run", _request(meta, "validity.cfa", {"items": items},
                                               options={"model": {"A": items[:5], "B": items[5:]}}))
    assert cfa["statistics"][0]["key"] == "chi2" and cfa["chart_data"]["path_diagram"]
    ids = {a["analysis_id"] for a in engine.call("analysis.list")["analyses"]}
    assert {"validity.efa", "validity.cfa"} <= ids
