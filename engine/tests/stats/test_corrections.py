"""Test Log family corrections (SPEC §9) reproduce R `p.adjust` (fixtures/r/corrections.R) at 1e-12."""

from __future__ import annotations

import pytest

from statly_engine.errors import InvalidParams
from statly_engine.rpc_methods import session_handlers
from statly_engine.stats.corrections import p_adjust

from .conftest import fixture_paths, load_fixture

CASES = fixture_paths("corrections")


def test_fixture_inventory():
    assert {p.stem for p in CASES} >= {"basic", "ties", "n1", "with_na", "cap_at_one", "edges", "many"}


@pytest.mark.parametrize("method", ["bonferroni", "holm", "fdr_bh"])
@pytest.mark.parametrize("path", CASES, ids=lambda p: p.stem)
def test_matches_r_p_adjust(path, method):
    fx = load_fixture(path)
    got = p_adjust(fx["request"]["p_values"], method)
    want = fx["expected"][method]
    assert len(got) == len(want)
    for g, w in zip(got, want):
        if w is None:
            assert g is None
        else:
            assert g == pytest.approx(w, abs=1e-12)


def test_none_is_identity_and_order_preserved():
    p = [0.04, 0.001, None, 0.3]
    assert p_adjust(p, "none") == p
    assert p_adjust([], "holm") == []


def test_invalid_inputs():
    with pytest.raises(ValueError):
        p_adjust([0.1, 1.2], "holm")
    with pytest.raises(ValueError):
        p_adjust([0.1], "sidak")


def test_rpc_adjust():
    h = session_handlers()["corrections.adjust"]
    assert h(None, {"p_values": [0.01, 0.04, 0.03], "method": "holm"}) == {"adjusted": pytest.approx([0.03, 0.06, 0.06])}
    with pytest.raises(InvalidParams):
        h(None, {"p_values": [0.01], "method": "sidak"})
    with pytest.raises(InvalidParams):
        h(None, {"p_values": [-0.1], "method": "holm"})
