"""Cross-check: content/decision_tree.yaml must only recommend canonical
analysis ids (contracts/analysis_ids.json), and every recommendation's
primary_test should (eventually) have a Learn page under
content/learn/tests/. Missing Learn pages are expected during Phase 5
content rollout, so they are reported as an xfail-style list rather than
failing the run."""

from __future__ import annotations

import json

import pytest

from statly_engine.advisor import enumerate_paths
from statly_engine.advisor.loader import DEFAULT_ANALYSIS_IDS_PATH, REPO_ROOT

LEARN_TESTS_DIR = REPO_ROOT / "content" / "learn" / "tests"


def _canonical_analysis_ids() -> set[str]:
    data = json.loads(DEFAULT_ANALYSIS_IDS_PATH.read_text(encoding="utf-8"))
    ids: set[str] = set()
    for key, value in data.items():
        if key.startswith("$"):
            continue
        ids.update(value)
    return ids


def _learn_page_ids() -> set[str]:
    """Every id front-matter value under content/learn/tests/*.md, recovering
    the dotted id from the double-underscore filename convention (see
    content/learn/README.md) as a cheap cross-check independent of the
    front matter itself."""
    ids = set()
    for path in LEARN_TESTS_DIR.glob("*.md"):
        ids.add(path.stem.replace("__", "."))
    return ids


def test_every_recommendation_id_is_canonical(tree):
    """Belt-and-suspenders re-check of the load-time validation in
    statly_engine.advisor.loader: every primary_test, nonparametric_alternative,
    and post_hoc id reachable from root must be a canonical analysis id."""
    canonical = _canonical_analysis_ids()
    errors = []
    for path in enumerate_paths(tree):
        rec = path["recommendation"]
        if rec["primary_test"] not in canonical:
            errors.append(f"{rec['id']}.primary_test={rec['primary_test']!r}")
        if rec["nonparametric_alternative"] is not None and rec["nonparametric_alternative"] not in canonical:
            errors.append(f"{rec['id']}.nonparametric_alternative={rec['nonparametric_alternative']!r}")
        for ph in rec["post_hoc"]:
            if ph not in canonical:
                errors.append(f"{rec['id']}.post_hoc={ph!r}")
    assert not errors, "non-canonical analysis id(s) used by decision tree: " + ", ".join(errors)


def test_every_recommendation_primary_test_has_a_learn_page(tree):
    """Every primary_test used by the tree should have a Learn page under
    content/learn/tests/. Phase 5 content isn't fully populated yet, so ids
    missing a page are reported (skip-style) rather than failing the run."""
    learn_ids = _learn_page_ids()
    primary_tests = {p["recommendation"]["primary_test"] for p in enumerate_paths(tree)}
    missing = sorted(primary_tests - learn_ids)
    if missing:
        pytest.skip(
            "primary_test ids with no Learn page yet under content/learn/tests/ "
            f"(expected during Phase 5 content rollout): {missing}"
        )
