"""Loads and validates content/decision_tree.yaml (SPEC §7.1).

Validation happens at load time and fails loudly:
1. Structural validation against decision_tree.schema.json (schema_validate.py).
2. Graph validation: `root` exists, every `next` id exists, every node is
   reachable from `root`, and the question graph has no cycles.
"""

from __future__ import annotations

import json
import sys
from functools import lru_cache
from pathlib import Path

import yaml

from statly_engine.advisor.schema_validate import SchemaValidationError, validate

# In the PyInstaller bundle the spec copies content/ and contracts/analysis_ids.json under
# sys._MEIPASS with the same relative layout; in a source checkout they live at the repo root.
REPO_ROOT = (Path(getattr(sys, "_MEIPASS")) if getattr(sys, "frozen", False)
             else Path(__file__).resolve().parents[3])
DEFAULT_TREE_PATH = REPO_ROOT / "content" / "decision_tree.yaml"
DEFAULT_SCHEMA_PATH = REPO_ROOT / "content" / "decision_tree.schema.json"
DEFAULT_ANALYSIS_IDS_PATH = REPO_ROOT / "contracts" / "analysis_ids.json"


class DecisionTreeError(Exception):
    """Raised when the decision tree file is structurally invalid."""


@lru_cache(maxsize=None)
def _load_canonical_analysis_ids(analysis_ids_path: str) -> frozenset[str]:
    """Flatten contracts/analysis_ids.json (family -> [ids]) into a set of
    every canonical analysis id."""
    data = json.loads(Path(analysis_ids_path).read_text(encoding="utf-8"))
    ids: set[str] = set()
    for key, value in data.items():
        if key.startswith("$"):
            continue
        ids.update(value)
    return frozenset(ids)


def _validate_analysis_ids(tree: dict, analysis_ids_path: Path) -> None:
    """Every primary_test, nonparametric_alternative, and post_hoc[] id used
    by the decision tree must be a canonical id from
    contracts/analysis_ids.json. Fails loudly, naming every offending id."""
    canonical = _load_canonical_analysis_ids(str(analysis_ids_path.resolve()))
    errors: list[str] = []
    for node_id, node in tree["nodes"].items():
        if node["type"] != "recommendation":
            continue
        primary = node["primary_test"]
        if primary not in canonical:
            errors.append(f"{node_id}.primary_test: {primary!r} is not a canonical analysis id")
        nonparam = node.get("nonparametric_alternative")
        if nonparam is not None and nonparam not in canonical:
            errors.append(
                f"{node_id}.nonparametric_alternative: {nonparam!r} is not a canonical analysis id"
            )
        for ph in node.get("post_hoc", []):
            if ph not in canonical:
                errors.append(f"{node_id}.post_hoc: {ph!r} is not a canonical analysis id")
    if errors:
        raise DecisionTreeError(
            "decision_tree.yaml uses non-canonical analysis id(s) not present in "
            f"{analysis_ids_path}:\n" + "\n".join(f"  - {e}" for e in errors)
        )


def _validate_graph(tree: dict) -> None:
    nodes = tree["nodes"]
    root = tree["root"]
    errors: list[str] = []

    if root not in nodes:
        errors.append(f"root {root!r} is not a node in 'nodes'")

    unknown_next: list[str] = []
    for node_id, node in nodes.items():
        if node["type"] != "question":
            continue
        for option in node["options"]:
            if option["next"] not in nodes:
                unknown_next.append(f"{node_id} -> option {option['value']!r} -> unknown next {option['next']!r}")
    errors.extend(unknown_next)

    if not errors:
        # Reachability from root (BFS over question -> option.next edges).
        reachable: set[str] = set()
        queue = [root]
        while queue:
            node_id = queue.pop()
            if node_id in reachable or node_id not in nodes:
                continue
            reachable.add(node_id)
            node = nodes[node_id]
            if node["type"] == "question":
                queue.extend(opt["next"] for opt in node["options"])
        unreachable = sorted(set(nodes) - reachable)
        if unreachable:
            errors.append(f"unreachable nodes (no path from root {root!r}): {unreachable}")

        # Cycle detection via DFS with a recursion stack.
        WHITE, GRAY, BLACK = 0, 1, 2
        color = {node_id: WHITE for node_id in nodes}

        def visit(node_id: str, stack: list[str]) -> None:
            color[node_id] = GRAY
            node = nodes[node_id]
            if node["type"] == "question":
                for opt in node["options"]:
                    nxt = opt["next"]
                    if nxt not in nodes:
                        continue
                    if color[nxt] == GRAY:
                        cycle = " -> ".join(stack + [nxt])
                        errors.append(f"cycle detected: {cycle}")
                    elif color[nxt] == WHITE:
                        visit(nxt, stack + [nxt])
            color[node_id] = BLACK

        if root in nodes:
            visit(root, [root])

    if errors:
        raise DecisionTreeError("decision_tree.yaml is invalid:\n" + "\n".join(f"  - {e}" for e in errors))


def _load_uncached(tree_path: Path, schema_path: Path, analysis_ids_path: Path) -> dict:
    tree = yaml.safe_load(tree_path.read_text(encoding="utf-8"))
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    try:
        validate(tree, schema)
    except SchemaValidationError as exc:
        raise DecisionTreeError(
            "decision_tree.yaml failed schema validation:\n" + "\n".join(f"  - {e}" for e in exc.errors)
        ) from exc
    _validate_graph(tree)
    _validate_analysis_ids(tree, analysis_ids_path)
    return tree


@lru_cache(maxsize=None)
def _load_cached(tree_path: str, schema_path: str, analysis_ids_path: str) -> dict:
    return _load_uncached(Path(tree_path), Path(schema_path), Path(analysis_ids_path))


def load_tree(
    tree_path: Path | None = None,
    schema_path: Path | None = None,
    analysis_ids_path: Path | None = None,
) -> dict:
    """Load, validate, and return the decision tree as a plain dict.

    Cached by resolved path so repeated RPC calls don't re-parse/re-validate.
    Pass explicit paths (e.g. in tests) to bypass the cache for a fixture file.
    """
    tp = (tree_path or DEFAULT_TREE_PATH).resolve()
    sp = (schema_path or DEFAULT_SCHEMA_PATH).resolve()
    ap = (analysis_ids_path or DEFAULT_ANALYSIS_IDS_PATH).resolve()
    return _load_cached(str(tp), str(sp), str(ap))
