"""Targeted education-design tests (see task spec): specific answer sets
must resolve to the expected recommended test."""

from __future__ import annotations

from statly_engine.advisor import evaluate


def _recommend(tree, answers, dataset_context=None):
    result = evaluate(tree, answers, dataset_context)
    assert result["recommendation"] is not None, (
        f"expected a recommendation, got next_question={result['next_question']}"
    )
    return result["recommendation"]


def test_one_group_pre_post_aggregate_recommends_independent_t_with_caveat(tree):
    rec = _recommend(tree, {
        "q_intent": "compare",
        "q_compare_outcome_level": "continuous",
        "q_compare_design": "repeated_aggregate",
        "q_compare_aggregate_groups": "two",
    })
    assert rec["primary_test"] == "t_test.independent"
    assert "aggregate_time_comparison" in rec["caveats"]


def test_one_group_pre_post_linked_recommends_paired_t(tree):
    rec = _recommend(tree, {
        "q_intent": "compare",
        "q_compare_outcome_level": "continuous",
        "q_compare_design": "repeated_linked",
        "q_compare_time_points": "two",
    })
    assert rec["primary_test"] == "t_test.paired"
    assert rec["nonparametric_alternative"] == "wilcoxon_signed_rank"


def test_three_groups_three_times_linked_recommends_mixed_anova(tree):
    rec = _recommend(tree, {
        "q_intent": "compare",
        "q_compare_outcome_level": "continuous",
        "q_compare_design": "repeated_linked",
        "q_compare_time_points": "three_plus",
        "q_compare_between_factor_rm": "yes",
    })
    assert rec["primary_test"] == "anova.mixed"
    assert rec["nonparametric_alternative"] == "anova.art"


def test_post_adjusted_for_pre_recommends_ancova(tree):
    rec = _recommend(tree, {
        "q_intent": "compare",
        "q_compare_outcome_level": "continuous",
        "q_compare_design": "independent_groups",
        "q_compare_between_factors": "one",
        "q_compare_between_groups_count": "two",
        "q_compare_covariate_two": "yes",
    })
    assert rec["primary_test"] == "ancova"
    assert rec["nonparametric_alternative"] == "ancova.quade"


def test_single_likert_item_between_two_groups_recommends_mann_whitney(tree):
    rec = _recommend(tree, {
        "q_intent": "compare",
        "q_compare_outcome_level": "ordinal",
        "q_compare_design_ordinal": "independent_groups",
        "q_compare_ordinal_groups": "two",
    })
    assert rec["primary_test"] == "mann_whitney"
    assert rec["likert_note"] is not None


def test_ten_item_scale_score_between_two_groups_recommends_welch_t(tree):
    rec = _recommend(tree, {
        "q_intent": "compare",
        "q_compare_outcome_level": "continuous",
        "q_compare_design": "independent_groups",
        "q_compare_between_factors": "one",
        "q_compare_between_groups_count": "two",
        "q_compare_covariate_two": "no",
    })
    assert rec["primary_test"] == "t_test.independent"
    assert rec["likert_note"] is None
    assert "welch" in rec["why_this_test"].lower()


def test_yes_no_pre_post_linked_recommends_mcnemar(tree):
    rec = _recommend(tree, {
        "q_intent": "compare",
        "q_compare_outcome_level": "nominal",
        "q_compare_categorical": "linked_two_time_points",
    })
    assert rec["primary_test"] == "mcnemar"


def test_items_hang_together_recommends_cronbach_alpha(tree):
    rec = _recommend(tree, {
        "q_intent": "reliability",
        "q_reliability_type": "rating_scale",
        "q_reliability_detail": "overall_reliability",
    })
    assert rec["primary_test"] == "reliability.cronbach_alpha"


def test_items_measure_construct_recommends_efa_or_cfa(tree):
    rec_explore = _recommend(tree, {"q_intent": "validity", "q_validity_stage": "exploring"})
    assert rec_explore["primary_test"] == "validity.efa"

    rec_confirm = _recommend(tree, {"q_intent": "validity", "q_validity_stage": "confirming"})
    assert rec_confirm["primary_test"] == "validity.cfa"


def test_predict_outcome_from_gpa_and_pretest_recommends_multiple_regression(tree):
    rec = _recommend(tree, {
        "q_intent": "predict",
        "q_predict_outcome_type": "continuous",
        "q_predict_predictor_count": "two_plus",
        "q_predict_entry_method": "no",
    })
    assert rec["primary_test"] == "regression.linear"


def test_dataset_context_auto_answers_and_user_answers_can_be_combined(tree):
    # outcome_level + num_groups auto-answered from dataset_context; the
    # rest supplied explicitly, same result as the fully-manual path above.
    rec = _recommend(
        tree,
        {
            "q_intent": "compare",
            "q_compare_design": "independent_groups",
            "q_compare_between_factors": "one",
            "q_compare_covariate_two": "no",
        },
        dataset_context={"outcome_level": "continuous", "num_groups": 2},
    )
    assert rec["primary_test"] == "t_test.independent"


def test_start_style_call_returns_next_question_when_nothing_answered(tree):
    result = evaluate(tree, {}, None)
    assert result["recommendation"] is None
    assert result["next_question"]["id"] == "q_intent"
    assert len(result["next_question"]["options"]) == 5
