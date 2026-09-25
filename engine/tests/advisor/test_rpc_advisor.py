"""RPC-level tests through the real stdio server (docs/PROTOCOL.md), as for
Phase 1 methods in test_rpc_server.py / tests/data/test_rpc_data.py."""

from __future__ import annotations


def test_advisor_start_returns_first_question(engine):
    result = engine.call("advisor.start", {})
    assert result["recommendation"] is None
    assert result["next_question"]["id"] == "q_intent"


def test_advisor_start_applies_dataset_context_auto_answers(engine):
    result = engine.call("advisor.start", {
        "dataset_context": {"outcome_level": "nominal"},
    })
    # q_intent still needs an explicit answer (no auto field), so the first
    # question returned is still the root -- auto only kicks in once we're
    # on a question that declares `auto`.
    assert result["next_question"]["id"] == "q_intent"


def test_advisor_answer_walks_to_a_recommendation(engine):
    result = engine.call("advisor.answer", {"answers": {
        "q_intent": "compare",
        "q_compare_outcome_level": "nominal",
        "q_compare_categorical": "linked_two_time_points",
    }})
    assert result["next_question"] is None
    assert result["recommendation"]["primary_test"] == "mcnemar"
    assert len(result["path"]) == 3


def test_advisor_answer_invalid_value_is_invalid_params_error(engine):
    error = engine.error("advisor.answer", {"answers": {"q_intent": "not_a_real_option"}})
    assert error["code"] == -32003


def test_advisor_answer_missing_answers_is_invalid_params_error(engine):
    error = engine.error("advisor.answer", {})
    assert error["code"] == -32003


def test_advisor_paths_enumerates_every_path(engine):
    result = engine.call("advisor.paths", {})
    paths = result["paths"]
    assert len(paths) >= 30
    primary_tests = {p["recommendation"]["primary_test"] for p in paths}
    assert "mcnemar" in primary_tests
    assert "t_independent" in primary_tests
    assert "anova_mixed" in primary_tests
