"""Structural tests for content/decision_tree.yaml: every path resolves to
an allowed test, no orphan/unreachable nodes, and load-time validation
catches unknown next ids, unreachable nodes, and cycles."""

from __future__ import annotations

import json

import pytest
import yaml

from statly_engine.advisor import DecisionTreeError, enumerate_paths, load_tree
from statly_engine.advisor.loader import DEFAULT_SCHEMA_PATH

from .conftest import ALLOWED_TEST_IDS


def test_every_path_ends_in_an_allowed_recommendation(tree):
    paths = enumerate_paths(tree)
    assert len(paths) > 0
    for path in paths:
        rec = path["recommendation"]
        assert rec["primary_test"] in ALLOWED_TEST_IDS, (path["answers"], rec["primary_test"])
        if rec["nonparametric_alternative"] is not None:
            assert rec["nonparametric_alternative"] in ALLOWED_TEST_IDS


def test_path_count_and_node_counts(tree):
    paths = enumerate_paths(tree)
    questions = [n for n in tree["nodes"].values() if n["type"] == "question"]
    recommendations = [n for n in tree["nodes"].values() if n["type"] == "recommendation"]
    # Sanity bounds rather than an exact count, so small content edits don't
    # make this test brittle -- but it does prove the tree is non-trivial
    # and every recommendation node is actually reachable as a leaf.
    assert len(questions) >= 25
    assert len(recommendations) >= 30
    reachable_rec_ids = {p["recommendation"]["id"] for p in paths}
    all_rec_ids = {n_id for n_id, n in tree["nodes"].items() if n["type"] == "recommendation"}
    assert reachable_rec_ids == all_rec_ids


def test_no_orphan_nodes(tree):
    """Every node must be reachable from root (loader already enforces this
    at load time; this test re-derives it independently via enumerate_paths
    so a regression here fails a specific, readable assertion)."""
    reached = set()
    for path in enumerate_paths(tree):
        reached.add(path["recommendation"]["id"])
        reached.update(step["question"] for step in path["answers"])
    assert reached == set(tree["nodes"])


def test_recommendation_ids_are_unique_and_snake_case(tree):
    for node_id, node in tree["nodes"].items():
        assert node_id == node_id.lower()
        assert " " not in node_id


def _write_tree(tmp_path, tree_dict):
    path = tmp_path / "broken.yaml"
    path.write_text(yaml.safe_dump(tree_dict), encoding="utf-8")
    return path


def test_unknown_next_id_fails_loudly(tmp_path):
    broken = {
        "version": 1,
        "root": "q1",
        "nodes": {
            "q1": {
                "type": "question", "text": "t", "why": "w",
                "options": [
                    {"value": "a", "label": "A", "next": "does_not_exist"},
                    {"value": "b", "label": "B", "next": "rec1"},
                ],
            },
            "rec1": {
                "type": "recommendation", "primary_test": "t_one_sample",
                "nonparametric_alternative": None, "assumptions": [], "effect_size": [],
                "post_hoc": [], "why_this_test": "x", "likert_note": None, "caveats": [],
            },
        },
    }
    path = _write_tree(tmp_path, broken)
    with pytest.raises(DecisionTreeError, match="unknown next"):
        load_tree(tree_path=path, schema_path=DEFAULT_SCHEMA_PATH)


def test_unreachable_node_fails_loudly(tmp_path):
    broken = {
        "version": 1,
        "root": "q1",
        "nodes": {
            "q1": {
                "type": "question", "text": "t", "why": "w",
                "options": [
                    {"value": "a", "label": "A", "next": "rec1"},
                    {"value": "b", "label": "B", "next": "rec1"},
                ],
            },
            "rec1": {
                "type": "recommendation", "primary_test": "t_one_sample",
                "nonparametric_alternative": None, "assumptions": [], "effect_size": [],
                "post_hoc": [], "why_this_test": "x", "likert_note": None, "caveats": [],
            },
            "rec_orphan": {
                "type": "recommendation", "primary_test": "t_paired",
                "nonparametric_alternative": None, "assumptions": [], "effect_size": [],
                "post_hoc": [], "why_this_test": "x", "likert_note": None, "caveats": [],
            },
        },
    }
    path = _write_tree(tmp_path, broken)
    with pytest.raises(DecisionTreeError, match="unreachable"):
        load_tree(tree_path=path, schema_path=DEFAULT_SCHEMA_PATH)


def test_cycle_fails_loudly(tmp_path):
    broken = {
        "version": 1,
        "root": "q1",
        "nodes": {
            "q1": {
                "type": "question", "text": "t", "why": "w",
                "options": [
                    {"value": "a", "label": "A", "next": "q2"},
                    {"value": "b", "label": "B", "next": "q2"},
                ],
            },
            "q2": {
                "type": "question", "text": "t2", "why": "w2",
                "options": [
                    {"value": "a", "label": "A", "next": "q1"},
                    {"value": "b", "label": "B", "next": "q1"},
                ],
            },
        },
    }
    path = _write_tree(tmp_path, broken)
    with pytest.raises(DecisionTreeError, match="cycle"):
        load_tree(tree_path=path, schema_path=DEFAULT_SCHEMA_PATH)


def test_decision_tree_yaml_matches_json_schema_via_jsonschema_library():
    """Belt-and-suspenders check with the real `jsonschema` library (a dev
    dependency already used by engine/tests/test_contracts.py) against
    content/decision_tree.schema.json, independent of our hand-rolled
    validator in schema_validate.py."""
    jsonschema = pytest.importorskip("jsonschema")
    from statly_engine.advisor.loader import DEFAULT_TREE_PATH

    tree_data = yaml.safe_load(DEFAULT_TREE_PATH.read_text(encoding="utf-8"))
    schema = json.loads(DEFAULT_SCHEMA_PATH.read_text(encoding="utf-8"))
    jsonschema.validate(tree_data, schema)
