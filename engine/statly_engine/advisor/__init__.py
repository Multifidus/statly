"""Test Advisor decision engine (SPEC §7.1).

`content/decision_tree.yaml` is the single source of truth for test
selection. This package loads and validates it, then evaluates it with a
pure function: (tree, answers) -> next question | recommendation.
"""

from __future__ import annotations

from statly_engine.advisor.engine import answer, enumerate_paths, evaluate
from statly_engine.advisor.loader import DecisionTreeError, load_tree

__all__ = ["DecisionTreeError", "load_tree", "evaluate", "answer", "enumerate_paths"]
