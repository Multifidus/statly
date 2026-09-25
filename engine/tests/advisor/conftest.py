from __future__ import annotations

import pytest

from statly_engine.advisor import load_tree
from statly_engine.advisor.loader import DEFAULT_ANALYSIS_IDS_PATH, _load_canonical_analysis_ids

# Ids the tree is allowed to recommend as primary_test: every canonical
# analysis id from contracts/analysis_ids.json (the single source of truth),
# so this set can never drift from the contract.
ALLOWED_TEST_IDS = set(_load_canonical_analysis_ids(str(DEFAULT_ANALYSIS_IDS_PATH.resolve())))


@pytest.fixture(scope="session")
def tree() -> dict:
    return load_tree()
