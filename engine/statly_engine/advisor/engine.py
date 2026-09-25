"""Pure decision-tree evaluator (SPEC §7.1).

Nothing here knows about statistics: it only walks the tree data structure
loaded by `loader.py`. `evaluate` is a pure function: (tree, answers,
dataset_context) -> {next_question} | {recommendation}.
"""

from __future__ import annotations

from typing import Any


def _rule_matches(when: dict, value: Any) -> bool:
    if "equals" in when and value != when["equals"]:
        return False
    if "min" in when:
        if not isinstance(value, (int, float)) or isinstance(value, bool) or value < when["min"]:
            return False
    if "max" in when:
        if not isinstance(value, (int, float)) or isinstance(value, bool) or value > when["max"]:
            return False
    if "in" in when and value not in when["in"]:
        return False
    return True


def _auto_value(auto: dict, dataset_context: dict) -> Any | None:
    field = auto["field"]
    if field not in dataset_context or dataset_context[field] is None:
        return None
    raw = dataset_context[field]
    for rule in auto["rules"]:
        if _rule_matches(rule["when"], raw):
            return rule["value"]
    return None


def _find_option(node: dict, value: Any) -> dict | None:
    for option in node["options"]:
        if option["value"] == value:
            return option
    return None


def _question_view(node_id: str, node: dict, auto_value: Any | None) -> dict:
    return {
        "id": node_id,
        "text": node["text"],
        "why": node["why"],
        "options": [{"value": o["value"], "label": o["label"]} for o in node["options"]],
        "auto_answer": auto_value,
    }


def _recommendation_view(node_id: str, node: dict) -> dict:
    view = {k: v for k, v in node.items() if k != "type"}
    view["id"] = node_id
    return view


def evaluate(tree: dict, answers: dict | None = None, dataset_context: dict | None = None) -> dict:
    """Walk the tree from `root` applying `answers` (explicit, user-given
    answers keyed by question id) and, for unanswered auto-capable
    questions, `dataset_context`. Explicit answers always win over auto.

    Returns {"next_question": {...} | None, "recommendation": {...} | None,
    "path": [{"question", "value", "source"}]} where exactly one of
    next_question/recommendation is non-null.
    """
    answers = answers or {}
    dataset_context = dataset_context or {}
    nodes = tree["nodes"]
    node_id = tree["root"]
    path: list[dict] = []

    for _ in range(len(nodes) + 1):
        node = nodes[node_id]
        if node["type"] == "recommendation":
            return {"next_question": None, "recommendation": _recommendation_view(node_id, node), "path": path}

        auto_value = _auto_value(node["auto"], dataset_context) if node.get("auto") else None
        if node_id in answers:
            value, source = answers[node_id], "user"
        elif auto_value is not None:
            value, source = auto_value, "auto"
        else:
            return {
                "next_question": _question_view(node_id, node, auto_value),
                "recommendation": None,
                "path": path,
            }

        option = _find_option(node, value)
        if option is None:
            valid = [o["value"] for o in node["options"]]
            raise ValueError(f"Invalid answer {value!r} for question {node_id!r}; expected one of {valid}")
        path.append({"question": node_id, "value": value, "source": source})
        node_id = option["next"]

    raise RuntimeError("decision tree evaluation did not terminate; this should have been caught at load time")


def answer(tree: dict, answers: dict, dataset_context: dict | None = None) -> dict:
    """Alias of `evaluate` kept for readability at RPC call sites."""
    return evaluate(tree, answers, dataset_context)


def enumerate_paths(tree: dict) -> list[dict]:
    """Every root-to-recommendation path, ignoring auto/dataset_context, for
    the frontend and the Study Planner (SPEC §11.2) and for exhaustive tests.
    """
    nodes = tree["nodes"]
    results: list[dict] = []

    def walk(node_id: str, steps: list[dict]) -> None:
        node = nodes[node_id]
        if node["type"] == "recommendation":
            results.append({"answers": steps, "recommendation": _recommendation_view(node_id, node)})
            return
        for option in node["options"]:
            walk(option["next"], steps + [{"question": node_id, "value": option["value"], "label": option["label"]}])

    walk(tree["root"], [])
    return results
