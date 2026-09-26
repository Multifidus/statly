"""charts.compute against numpy / scipy / pandas references (SPEC §10.2, Phase 7)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from scipy import stats

from statly_engine import charts
from statly_engine.charts.distribution import bin_edges
from statly_engine.errors import InvalidParams
from statly_engine.stats import registry

REPO = Path(__file__).resolve().parents[3]
PRACTICE = REPO / "fixtures" / "practice"
ITEMS = [f"Q3_{i}" for i in range(1, 11)]


def spec(chart_type, x=(), y=(), color=(), facet=(), error_bars="none", subset=(), agg="mean", **cust):
    f = lambda vs, a="none": [{"variable": v, "aggregate": a} for v in vs]  # noqa: E731
    return {"schema_version": 1, "id": "c1", "chart_type": chart_type,
            "source": {"kind": "dataset", "test_log_entry_id": None},
            "shelves": {"x": f(x), "y": f(y, agg), "color": f(color), "facet": f(facet)},
            "subset": list(subset), "error_bars": error_bars, "customization": cust, "theme_preset": "statly",
            "created_at": "2026-09-25T00:00:00Z", "modified_at": "2026-09-25T00:00:00Z"}


@pytest.fixture(scope="module")
def likert() -> pd.DataFrame:
    pre = pd.read_csv(PRACTICE / "one_group_prepost_likert" / "pre.csv", skiprows=[1, 2])
    post = pd.read_csv(PRACTICE / "one_group_prepost_likert" / "post.csv", skiprows=[1, 2])
    pre["Time"], post["Time"] = "Pre", "Post"
    df = pd.concat([pre, post], ignore_index=True)
    df["scale"] = df[ITEMS].mean(axis=1)
    return df


@pytest.fixture(scope="module")
def synth() -> pd.DataFrame:
    rng = np.random.default_rng(7)
    n = 150
    g = rng.choice(["A", "B", "C"], n)
    t = rng.choice(["T1", "T2"], n)
    x = rng.normal(50, 10, n)
    y = 0.6 * x + rng.normal(0, 8, n) + (g == "B") * 5
    y[[3, 17]] = [200.0, -90.0]   # planted outliers
    x[[5, 9]] = np.nan              # missing
    return pd.DataFrame({"group": g, "time": t, "x": x, "y": y})


# ---- means / SE / SD / CI -------------------------------------------------------------------

@pytest.mark.parametrize("kind", ["se", "sd", "ci95", "none"])
def test_means_error_bars(synth, kind):
    out = charts.compute(synth, spec("grouped_bar", x=["group"], y=["y"], color=["time"], error_bars=kind))
    ref = synth.groupby(["group", "time"])["y"].agg(["mean", "std", "count"])
    assert len(out["rows"]) == len(ref)
    for r in out["rows"]:
        m, sd, n = ref.loc[(r["x"], r["color"])]
        se = sd / np.sqrt(n)
        half = stats.t.ppf(0.975, n - 1) * se
        assert r["n"] == n and np.isclose(r["value"], m) and np.isclose(r["sd"], sd) and np.isclose(r["se"], se)
        assert np.isclose(r["ci_low"], m - half) and np.isclose(r["ci_high"], m + half)
        want = {"se": (m - se, m + se), "sd": (m - sd, m + sd), "ci95": (m - half, m + half)}.get(kind)
        if want is None:
            assert r["lower"] is None and r["upper"] is None
        else:
            assert np.allclose([r["lower"], r["upper"]], want)
    assert out["meta"]["levels"]["x"] == ["A", "B", "C"] and out["meta"]["levels"]["color"] == ["T1", "T2"]


def test_line_over_time_on_practice(likert):
    out = charts.compute(likert, spec("line", x=["Time"], y=["scale"], error_bars="ci95"))
    got = {r["x"]: r["value"] for r in out["rows"]}
    ref = likert.groupby("Time")["scale"].mean()
    assert got.keys() == {"Pre", "Post"} and all(np.isclose(got[k], ref[k]) for k in got)
    assert [r["x"] for r in out["rows"]] == ["Post", "Pre"]  # meta=None: sorted levels


def test_several_y_become_x_and_median(synth):
    out = charts.compute(synth, spec("bar", y=["x", "y"], agg="median"))
    assert [r["x"] for r in out["rows"]] == ["x", "y"]
    assert np.isclose(out["rows"][0]["value"], synth["x"].median()) and out["meta"]["error_bars"] == "none"
    assert out["rows"][0]["lower"] is None


def test_subset_and_facet(synth):
    out = charts.compute(synth, spec("bar", x=["time"], y=["y"], facet=["group"],
                                     subset=[{"variable": "group", "op": "not_in", "values": ["C"]}]))
    assert {r["facet"] for r in out["rows"]} == {"A", "B"}
    ref = synth[synth.group == "A"].groupby("time")["y"].mean()
    for r in out["rows"]:
        if r["facet"] == "A":
            assert np.isclose(r["value"], ref[r["x"]])


# ---- counts / Likert ------------------------------------------------------------------------

def test_percent_bar(synth):
    out = charts.compute(synth, spec("percent_bar", x=["group"], color=["time"]))
    ct = pd.crosstab(synth.group, synth.time)
    for r in out["rows"]:
        assert r["count"] == ct.loc[r["x"], r["color"]]
        assert np.isclose(r["percent"], 100 * ct.loc[r["x"], r["color"]] / ct.loc[r["x"]].sum())


def test_likert_counts_on_practice_matrix(likert):
    pre = likert[likert.Time == "Pre"]
    out = charts.compute(pre, spec("likert_diverging", y=ITEMS))
    assert out["meta"]["levels"]["item"] == ITEMS and out["meta"]["levels"]["response"] == ["1", "2", "3", "4", "5"]
    assert out["meta"]["neutral"] == "3"
    for item in ITEMS:
        rows = [r for r in out["rows"] if r["item"] == item]
        vc = pre[item].value_counts()
        assert [r["count"] for r in rows] == [int(vc.get(v, 0)) for v in range(1, 6)]
        assert np.isclose(sum(r["percent"] for r in rows), 100)
        mid = rows[2]
        assert np.isclose(mid["start"] + mid["percent"] / 2, 0)            # neutral centred on zero
        assert all(np.isclose(a["end"], b["start"]) for a, b in zip(rows, rows[1:]))


def test_likert_items_as_stacked_bar(likert):
    out = charts.compute(likert, spec("stacked_bar", y=ITEMS[:2], facet=["Time"]))
    r = next(r for r in out["rows"] if r["x"] == "Q3_1" and r["facet"] == "Pre" and r["color"] == "4")
    assert r["count"] == int((likert[likert.Time == "Pre"]["Q3_1"] == 4).sum())


# ---- distributions --------------------------------------------------------------------------

def test_histogram_fd_matches_numpy(synth):
    out = charts.compute(synth, spec("histogram", x=["x"]))
    x = synth["x"].dropna().to_numpy()
    edges = np.histogram_bin_edges(x, bins="fd")
    counts, _ = np.histogram(x, bins=edges)
    assert [r["count"] for r in out["rows"]] == counts.tolist()
    assert np.allclose([r["bin_start"] for r in out["rows"]], edges[:-1])
    assert out["meta"]["n_excluded"] == 2


def test_histogram_grouped_shares_edges_and_bins_override(synth):
    out = charts.compute(synth, spec("histogram", x=["y"], color=["time"], bins=12))
    assert out["meta"]["n_bins"] == 12
    for t in ("T1", "T2"):
        rows = [r for r in out["rows"] if r["color"] == t]
        want, _ = np.histogram(synth.y[synth.time == t], bins=np.histogram_bin_edges(synth.y, 12))
        assert [r["count"] for r in rows] == want.tolist()


def test_histogram_zero_iqr_falls_back():
    x = np.array([1.0] * 20 + [2.0, 3.0])
    assert len(bin_edges(x)) - 1 == len(np.histogram_bin_edges(x, "sturges")) - 1


def test_kde_matches_scipy(synth):
    out = charts.compute(synth, spec("density", x=["x"], color=["time"]))
    for t in ("T1", "T2"):
        rows = [r for r in out["rows"] if r["color"] == t]
        x = synth.x[(synth.time == t)].dropna().to_numpy()
        ref = stats.gaussian_kde(x)([r["x"] for r in rows])
        assert np.allclose([r["density"] for r in rows], ref, rtol=1e-10, atol=1e-14)


def test_box_matches_tukey_rule(synth):
    out = charts.compute(synth, spec("box", x=["group"], y=["y"]))
    for g in ("A", "B", "C"):
        y = np.sort(synth.y[synth.group == g].to_numpy())
        q1, med, q3 = np.percentile(y, [25, 50, 75])
        lo, hi = q1 - 1.5 * (q3 - q1), q3 + 1.5 * (q3 - q1)
        box = next(r for r in out["rows"] if r["kind"] == "box" and r["x"] == g)
        outs = sorted(r["value"] for r in out["rows"] if r["kind"] == "outlier" and r["x"] == g)
        assert np.allclose([box["q1"], box["median"], box["q3"]], [q1, med, q3])
        assert box["whisker_low"] == y[y >= lo].min() and box["whisker_high"] == y[y <= hi].max()
        assert outs == sorted(y[(y < lo) | (y > hi)].tolist())
    assert any(r["kind"] == "outlier" and r["value"] == 200.0 for r in out["rows"])


def test_violin_has_density_and_box(synth):
    out = charts.compute(synth, spec("violin", x=["group"], y=["x"]))
    kinds = {(r["kind"], r["x"]) for r in out["rows"]}
    assert {("box", g) for g in "ABC"} <= kinds and {("density", g) for g in "ABC"} <= kinds
    d = [r for r in out["rows"] if r["kind"] == "density" and r["x"] == "A"]
    xa = synth.x[synth.group == "A"].dropna()
    assert np.isclose(min(r["value"] for r in d), xa.min()) and np.isclose(max(r["value"] for r in d), xa.max())
    assert np.allclose([r["density"] for r in d], stats.gaussian_kde(xa)([r["value"] for r in d]))


def test_qq_points_and_qqline(likert):
    out = charts.compute(likert, spec("qq", x=["scale"]))
    x = np.sort(likert.scale.to_numpy())
    assert np.allclose([r["sample"] for r in out["rows"]], x)
    ppoints = (np.arange(1, len(x) + 1) - 0.5) / len(x)          # R ppoints(n), n > 10
    assert np.allclose([r["theoretical"] for r in out["rows"]], stats.norm.ppf(ppoints))
    line = out["meta"]["lines"][0]
    q = np.percentile(x, [25, 75])
    z = stats.norm.ppf([0.25, 0.75])
    assert np.isclose(line["slope"], (q[1] - q[0]) / (z[1] - z[0]))


# ---- relationships --------------------------------------------------------------------------

def test_scatter_ols_matches_polyfit(synth):
    out = charts.compute(synth, spec("scatter", x=["x"], y=["y"], color=["time"]))
    for f in out["meta"]["fits"]:
        d = synth[(synth.time == f["color"])].dropna(subset=["x", "y"])
        slope, icpt = np.polyfit(d.x, d.y, 1)
        assert np.isclose(f["slope"], slope) and np.isclose(f["intercept"], icpt)
        assert np.isclose(f["r"], np.corrcoef(d.x, d.y)[0, 1]) and f["n"] == len(d)
        assert len(f["points"]) == 2
    assert len(out["rows"]) == synth[["x", "y"]].dropna().shape[0]


def test_scatter_loess(synth):
    out = charts.compute(synth, spec("scatter", x=["x"], y=["y"], fit_line="loess"))
    assert len(out["meta"]["fits"][0]["points"]) == synth[["x", "y"]].dropna().shape[0]


@pytest.mark.parametrize("method", ["pearson", "spearman"])
def test_correlation_matrix(likert, method):
    out = charts.compute(likert, spec("correlation_heatmap", x=ITEMS[:4], correlation_method=method))
    ref = likert[ITEMS[:4]].corr(method=method)
    assert len(out["rows"]) == 16
    for r in out["rows"]:
        assert np.isclose(r["r"], ref.loc[r["row"], r["col"]])


# ---- factor results -------------------------------------------------------------------------

def _factor_result(likert, aid):
    req = {"schema_version": 1, "request_id": "r1", "analysis_id": aid, "dataset_id": "d", "snapshot_id": "s",
           "variables": {"items": ITEMS}, "subset": [], "options": {}, "corrections": [], "alpha": 0.05,
           "tails": "two_sided", "ci_level": 0.95}
    return registry.run(likert[ITEMS], req)


def test_scree_from_efa(likert):
    res = _factor_result(likert, "validity.efa")
    out = charts.compute_from_result(res, {**spec("scree"), "source": {"kind": "analysis", "test_log_entry_id": "r1"}})
    obs = [r["eigenvalue"] for r in out["rows"] if r["series"].startswith("Eigenvalues")]
    assert np.allclose(obs, [r["eigenvalue"] for r in res["chart_data"]["scree"]])
    assert np.allclose(obs, np.sort(np.linalg.eigvalsh(likert[ITEMS].corr().to_numpy()))[::-1])


def test_cfa_path_layout(likert):
    res = _factor_result(likert, "validity.cfa")
    out = charts.compute_from_result(res, spec("cfa_path"))
    nodes = [r for r in out["rows"] if r["kind"] == "node"]
    edges = [r for r in out["rows"] if r["kind"] == "edge"]
    assert len([n for n in nodes if n["node_type"] == "observed"]) == 10 and len(edges) == 10
    latent = next(n for n in nodes if n["node_type"] == "latent")
    assert latent["y"] == 0 and np.isclose(latent["x"], 4.5)
    std = {r["item"]: r["std"] for r in res["chart_data"]["loadings"]}
    assert all(np.isclose(e["weight"], std[e["to"]]) for e in edges)


def test_wrong_source_and_shelf_errors(synth, likert):
    with pytest.raises(InvalidParams):
        charts.compute(synth, spec("scatter", x=["x"]))
    with pytest.raises(InvalidParams):
        charts.compute(synth, spec("grouped_bar", x=["group"], y=["y"]))
    with pytest.raises(InvalidParams):
        charts.compute(synth, spec("histogram", x=["group"]))   # text, not numbers
    with pytest.raises(InvalidParams):
        charts.compute(synth, spec("scree"))
    with pytest.raises(InvalidParams):
        charts.compute_from_result(_factor_result(likert, "validity.cfa"), spec("scree"))
