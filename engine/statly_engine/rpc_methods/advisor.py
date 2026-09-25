"""advisor.* RPC handlers (SPEC §7.1). Stateless: the decision tree is
loaded once (cached) from content/decision_tree.yaml and every handler is a
pure function of its params, per docs/PROTOCOL.md and CLAUDE.md.

Unlike dataset.*/project.*, these params/results aren't in contracts/Rpc.json
(out of scope for this change), so handlers validate params by hand and
raise statly_engine.errors.InvalidParams on bad input rather than using the
@rpc_method contract-model decorator.
"""

from __future__ import annotations

from statly_engine.advisor import enumerate_paths, evaluate, load_tree
from statly_engine.errors import InvalidParams


def _dataset_context(params: dict) -> dict | None:
    ctx = params.get("dataset_context")
    if ctx is not None and not isinstance(ctx, dict):
        raise InvalidParams("dataset_context must be an object.")
    return ctx


def start(store, params: dict) -> dict:
    """advisor.start {dataset_context?} -> first question (auto-answers
    applied) or a recommendation if dataset_context alone determines one."""
    tree = load_tree()
    return evaluate(tree, {}, _dataset_context(params))


def answer(store, params: dict) -> dict:
    """advisor.answer {answers, dataset_context?} -> next question or
    recommendation. `answers` is the full set of question-id -> value
    answered so far (not just the latest one); this keeps the handler a
    pure function of its params instead of session state."""
    answers = params.get("answers")
    if not isinstance(answers, dict):
        raise InvalidParams("answers must be an object of question id -> value.")
    tree = load_tree()
    try:
        return evaluate(tree, answers, _dataset_context(params))
    except ValueError as exc:
        raise InvalidParams(str(exc)) from exc


def paths(store, params: dict) -> dict:
    """advisor.paths {} -> every root-to-recommendation path (for tests and
    the Study Planner, SPEC §11.2)."""
    tree = load_tree()
    return {"paths": enumerate_paths(tree)}


METHODS = {
    "advisor.start": start,
    "advisor.answer": answer,
    "advisor.paths": paths,
}
