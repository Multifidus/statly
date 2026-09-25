# Generated from contracts/*.json by scripts/gen-contracts.sh. DO NOT EDIT.

from __future__ import annotations

from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, confloat, conint

from . import AnalysisRequest as AnalysisRequest_1
from . import AnalysisResult
from .AnalysisRequest import AnalysisRequest


class ResultSummary(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    analysis_label: str
    """
    e.g. 'Independent-samples t test (Welch)'.
    """
    outcome_variables: list[str]
    """
    Used to detect related tests (same outcome across items) and suggest families.
    """
    primary_statistic: AnalysisResult.Statistic | None
    p: confloat(ge=0.0, le=1.0) | None
    """
    The p-value subject to family correction.
    """
    primary_effect_size: AnalysisResult.EffectSize | None
    n_used: conint(ge=0)
    apa_sentence: AnalysisResult.RichText
    plain_language_summary: str
    engine_version: str


class TestLogEntry(BaseModel):
    """
    One analysis run, recorded in the project's Test Log. Corrections are never automatic: family_id, correction_method (identical across a family; 'none' when not in one) and adjusted_p are set only by the user's choice. SPEC §9.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    schema_version: Literal[1]
    id: str
    """
    Equals request.request_id.
    """
    timestamp: AwareDatetime
    request: AnalysisRequest
    result_summary: ResultSummary
    result_path: str | None
    """
    Full AnalysisResult JSON inside the .statly zip, e.g. 'results/<id>.json'.
    """
    family_id: str | None
    """
    ProjectFile.test_families[].id this test belongs to; null = not in a family.
    """
    correction_method: AnalysisRequest_1.CorrectionMethod
    adjusted_p: confloat(ge=0.0, le=1.0) | None
    """
    Adjusted version of result_summary.p within the family; null when correction_method is 'none'.
    """
