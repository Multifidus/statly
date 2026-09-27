"""survey.* RPC handlers: Qualtrics survey design files (.qsf). docs/PROTOCOL.md "Survey file".

- survey.parse   {file_path}                                   -> {survey, issues}
- survey.suggest {dataset_id?, snapshot_id?, survey?, variables?} -> suggest_metadata output + survey_name

Both are read-only. Storing the .qsf with a dataset is dataset.import's optional `survey`; applying
suggestions is left to the app (ordinary variables.update / interview edits), so nothing here writes.
"""

from __future__ import annotations

from statly_engine.contracts import Rpc
from statly_engine.data.readers import read_bytes
from statly_engine.data.store import DatasetStore
from statly_engine.data.survey_apply import suggest_metadata
from statly_engine.data.survey_qsf import ColumnSpec, Question, Survey, parse_qsf
from statly_engine.errors import InvalidParams, StaleOrUnknown
from statly_engine.rpc_methods import rpc_method

SURVEY_ROLE = "survey"


def survey_from_dict(d: dict) -> Survey:
    """Inverse of Survey.to_dict() (the shape survey.parse returns)."""
    questions = [Question(**{**q, "columns": [ColumnSpec(**c) for c in q["columns"]],
                             "notes": list(q["notes"])}) for q in d["questions"]]
    return Survey(name=d["name"], questions=questions, notes=list(d["notes"]))


def _issues(survey: Survey) -> list[dict]:
    notes = list(survey.notes)
    notes += [f"{q.tag}: {n}" for q in survey.questions if not q.in_trash for n in q.notes]
    return [{"code": "survey_note", "severity": "info", "message": n, "file_id": None, "column": None} for n in notes]


def stored_survey(store: DatasetStore, dataset_id: str) -> Survey | None:
    """The survey file kept with a dataset at import (last one wins), parsed; None if there is none."""
    state = store.get(dataset_id)
    for f in reversed(state.meta["import_log"]["files"]):
        if f.get("role") == SURVEY_ROLE and f["file_id"] in state.originals:
            return parse_qsf(state.originals[f["file_id"]][1])
    return None


@rpc_method(Rpc.SurveyParseParams, Rpc.SurveyParseResult)
def parse(store: DatasetStore, params: dict) -> dict:
    survey = parse_qsf(read_bytes(params["file_path"]))
    return {"survey": survey.to_dict(), "issues": _issues(survey)}


@rpc_method(Rpc.SurveySuggestParams, Rpc.SurveySuggestResult)
def suggest(store: DatasetStore, params: dict) -> dict:
    dataset_id = params.get("dataset_id")
    variables = params.get("variables")
    if variables is None:
        if dataset_id is None:
            raise InvalidParams("survey.suggest needs dataset_id or variables.")
        meta = store.get(dataset_id).meta
        snap = params.get("snapshot_id")
        if snap is not None and snap != meta["snapshot_id"]:
            raise StaleOrUnknown("The data changed since this view was loaded; refresh and try again.",
                                 snapshot_id=meta["snapshot_id"])
        variables = sorted(meta["variables"], key=lambda v: v["display_order"])
    if params.get("survey") is not None:
        survey = survey_from_dict(params["survey"])
    elif dataset_id is not None:
        survey = stored_survey(store, dataset_id)
        if survey is None:
            raise InvalidParams("This dataset has no survey file. Add one when importing, or pass `survey`.")
    else:
        raise InvalidParams("survey.suggest needs a survey, or a dataset imported with a survey file.")
    return {"survey_name": survey.name, **suggest_metadata(survey, variables)}


METHODS = {
    "survey.parse": parse,
    "survey.suggest": suggest,
}
