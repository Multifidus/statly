"""Loads and validates content/decision_tree.yaml (SPEC §7.1).

Validation happens at load time and fails loudly:
1. Structural validation against decision_tree.schema.json (schema_validate.py).
2. Graph validation: `root` exists, every `next` id exists, every node is
   reachable from `root`, and the question graph has no cycles.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import yaml

from statly_engine.advisor.schema_validate import SchemaValidationError, validate

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_TREE_PATH = REPO_ROOT / "content" / "decision_tree.yaml"
DEFAULT_SCHEMA_PATH = REPO_ROOT / "content" / "decision_tree.schema.json"


class DecisionTreeError(Exception):
    """Raised when the decision tree file is structurally invalid."""


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


def _load_uncached(tree_path: Path, schema_path: Path) -> dict:
    tree = yaml.safe_load(tree_path.read_text(encoding="utf-8"))
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    try:
        validate(tree, schema)
    except SchemaValidationError as exc:
        raise DecisionTreeError(
            "decision_tree.yaml failed schema validation:\n" + "\n".join(f"  - {e}" for e in exc.errors)
        ) from exc
    _validate_graph(tree)
    return tree


@lru_cache(maxsize=None)
def _load_cached(tree_path: str, schema_path: str) -> dict:
    return _load_uncached(Path(tree_path), Path(schema_path))


def load_tree(tree_path: Path | None = None, schema_path: Path | None = None) -> dict:
    """Load, validate, and return the decision tree as a plain dict.

    Cached by resolved path so repeated RPC calls don't re-parse/re-validate.
    Pass explicit paths (e.g. in tests) to bypass the cache for a fixture file.
    """
    tp = (tree_path or DEFAULT_TREE_PATH).resolve()
    sp = (schema_path or DEFAULT_SCHEMA_PATH).resolve()
    return _load_cached(str(tp), str(sp))
