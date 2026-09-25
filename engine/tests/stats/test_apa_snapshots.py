"""APA snapshot tests (SPEC §12): the exact apa_sentence / apa_table / summary for fixed inputs.

Regenerate after an intentional wording or formatting change with
    STATLY_UPDATE_SNAPSHOTS=1 .venv/bin/python -m pytest tests/stats/test_apa_snapshots.py
and review the diff of tests/stats/snapshots/*.json.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from statly_engine.stats import apa

from .conftest import EXPECTED, load_fixture, run_fixture

SNAP = Path(__file__).parent / "snapshots"
CASES = ["t_test.independent/basic", "t_test.paired/basic", "t_test.one_sample/greater", "descriptives/grouped"]


@pytest.mark.parametrize("case", CASES)
def test_apa_output_snapshot(case):
    res = run_fixture(load_fixture(EXPECTED / f"{case}.json"))
    got = {"apa_sentence": res["apa_sentence"], "apa_table": res["apa_table"],
           "plain_language_summary": res["plain_language_summary"]}
    path = SNAP / (case.replace("/", "__") + ".json")
    if os.environ.get("STATLY_UPDATE_SNAPSHOTS") == "1" or not path.exists():
        SNAP.mkdir(exist_ok=True)
        path.write_text(json.dumps(got, indent=2, ensure_ascii=False) + "\n")
    assert got == json.loads(path.read_text())


def test_apa_number_rules():
    assert apa.p_value(0.0004) == "< .001" and apa.p_value(0.0341) == ".034" and apa.p_value(0.99951) == "> .999"
    assert apa.p_relation(0.05) == " = .050" and apa.p_relation(1e-9) == " < .001"
    assert apa.no_zero(0.456) == ".46" and apa.no_zero(-0.05) == "-.05" and apa.no_zero(1.0) == "1.00"
    assert apa.num(-0.001) == "0.00" and apa.num(2.5) == "2.50" and apa.num(None) == "—"
    assert apa.df_text(28.0) == "28" and apa.df_text(47.8558) == "47.86"
    assert apa.ci_text(0.1, None) == "[0.10, ∞]" and apa.ci_text(None, -0.2) == "[-∞, -0.20]"
    r = apa.Rich().stat("t", [47.8558], -1.9333).t(", ").p(0.0591)
    assert r.plain() == "t(47.86) = -1.93, p = .059"
    assert [x["italic"] for x in r.runs] == [True, False, True, False]
