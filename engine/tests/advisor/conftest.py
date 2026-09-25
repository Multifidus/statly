from __future__ import annotations

import pytest

from statly_engine.advisor import load_tree

# Ids the tree is allowed to recommend as primary_test: the t-test/descriptives
# ids already owned by another agent, plus every id this decision tree uses.
ALLOWED_TEST_IDS = {
    "t_one_sample", "t_independent", "t_paired",
    "wilcoxon_one_sample", "mann_whitney", "wilcoxon_signed_rank", "sign_test",
    "anova_one_way", "anova_welch", "kruskal_wallis",
    "anova_rm", "friedman",
    "anova_factorial", "anova_mixed", "art_anova",
    "ancova", "quade",
    "manova",
    "chi_square_independence", "chi_square_gof", "fisher_exact", "mcnemar", "cochran_q",
    "pearson", "spearman", "kendall_tau_b", "point_biserial", "partial_correlation",
    "regression_linear", "regression_hierarchical", "regression_logistic", "regression_ordinal",
    "cronbach_alpha", "mcdonald_omega", "kr20", "split_half", "item_analysis",
    "efa", "cfa",
}


@pytest.fixture(scope="session")
def tree() -> dict:
    return load_tree()
