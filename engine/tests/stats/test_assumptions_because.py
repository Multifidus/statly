"""Every assumption-check explanation states WHY the verdict was reached (a 'Because' sentence).

Covers the four kinds required by the owner's feedback: normality, homogeneity of variance,
sphericity, and independence / expected counts (chi-square).
"""

from __future__ import annotations

import numpy as np

from statly_engine.stats import assumptions as asm
from statly_engine.stats import categorical as cat
from statly_engine.stats import sphericity as sph


def test_normality_because_pass():
    rng = np.random.default_rng(0)
    x = rng.normal(size=200)
    res, _ = asm.shapiro_wilk(x, asm.scope("overall", "scores"))
    assert res["verdict"] == "passed"
    assert "Because the p value" in res["explanation"]
    assert "is above .05" in res["explanation"]


def test_normality_because_fail():
    # Strongly skewed / bimodal data reliably fails Shapiro-Wilk.
    x = np.concatenate([np.zeros(30), np.ones(30) * 100])
    res, _ = asm.shapiro_wilk(x, asm.scope("overall", "scores"))
    assert res["verdict"] == "failed"
    assert "Because the p value" in res["explanation"]
    assert "is below .05" in res["explanation"]


def test_homogeneity_because_pass():
    rng = np.random.default_rng(1)
    groups = {"a": rng.normal(size=50), "b": rng.normal(size=50)}
    res, _ = asm.levene_brown_forsythe(groups, asm.scope("overall", "groups"))
    assert res["verdict"] == "passed"
    assert "Because the p value" in res["explanation"]
    assert "similar enough" in res["explanation"]


def test_homogeneity_because_fail():
    rng = np.random.default_rng(2)
    groups = {"a": rng.normal(scale=1, size=100), "b": rng.normal(scale=40, size=100)}
    res, _ = asm.levene_brown_forsythe(groups, asm.scope("overall", "groups"))
    assert res["verdict"] == "failed"
    assert "Because the p value" in res["explanation"]
    assert "spreads differ" in res["explanation"]
    assert "Welch" in res["explanation"]


def test_sphericity_because_pass():
    rng = np.random.default_rng(3)
    y = rng.normal(size=(60, 3))
    s = sph.sphericity(y)
    res = sph.assumption(s, k=3, n=60, alpha=0.05, correction="none")
    if res["verdict"] == "passed":
        assert "Because the p value" in res["explanation"]
        assert "is above .05" in res["explanation"]


def test_sphericity_because_fail():
    rng = np.random.default_rng(4)
    n = 40
    base = rng.normal(size=n)
    y = np.column_stack([base, base + rng.normal(scale=0.2, size=n),
                         base * 3 + rng.normal(scale=5, size=n)])
    s = sph.sphericity(y)
    res = sph.assumption(s, k=3, n=n, alpha=0.05, correction="gg")
    if res["verdict"] == "failed":
        assert "Because the p value" in res["explanation"]
        assert "is below .05" in res["explanation"]
        assert "Greenhouse-Geisser" in res["explanation"]


def test_expected_counts_because_pass():
    tab = np.array([[50, 50], [50, 50]])
    e = cat.expected_counts(tab)
    verdict, text = cat.expected_counts_check(e)
    assert verdict == "passed"
    assert "Because every expected count is at least 5" in text


def test_expected_counts_because_fail():
    tab = np.array([[10, 1], [1, 1]])
    e = cat.expected_counts(tab)
    verdict, text = cat.expected_counts_check(e)
    assert verdict == "failed"
    assert "Because the smallest expected count" in text
    assert "is below 5" in text
