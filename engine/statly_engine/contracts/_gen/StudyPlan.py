# Generated from contracts/*.json by scripts/gen-contracts.sh. DO NOT EDIT.

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    PositiveFloat,
    confloat,
    conint,
)

from . import AnalysisRequest


class DesignAnswers(BaseModel):
    """
    Answers to the plain-language design interview. Keys are node ids of content/decision_tree.yaml (the tree is data-driven), so answers are stored generically with the tree version.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    decision_tree_version: str
    answers: dict[str, str | float | bool | list[str]]
    summary: str
    """
    Plain-language design summary for the exported plan.
    """


class PlannedAnalysis(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    analysis_id: str
    """
    Same id space as AnalysisRequest.analysis_id.
    """
    label: str
    rationale: str
    nonparametric_alternative: str | None
    """
    analysis_id of the fallback test.
    """
    assumptions_to_check: list[str]
    """
    AssumptionResult.assumption keys.
    """
    effect_size: str | None
    """
    EffectSize.key to report.
    """
    follow_ups: list[str]
    """
    Post hoc / follow-up analysis ids.
    """


class PowerMode(StrEnum):
    """
    a_priori: effect -> required n. sensitivity: n -> detectable effect.
    """

    a_priori = 'a_priori'
    sensitivity = 'sensitivity'


class PowerInputs(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    alpha: confloat(lt=1.0, gt=0.0)
    power: confloat(lt=1.0, gt=0.0) | None
    tails: AnalysisRequest.Tails
    effect_size_metric: str
    """
    d, f, r, w, f_sq, ...
    """
    effect_size: float | None
    """
    Required for a_priori.
    """
    n_total: conint(ge=2) | None
    """
    Required for sensitivity.
    """
    n_groups: conint(ge=1) | None = None
    n_measurements: conint(ge=1) | None = None
    correlation_among_measures: confloat(ge=-1.0, le=1.0) | None = None
    nonsphericity_epsilon: confloat(le=1.0, gt=0.0) | None = None
    n_predictors: conint(ge=1) | None = None
    df: conint(ge=1) | None = None
    """
    Chi-square degrees of freedom.
    """
    allocation_ratio: PositiveFloat | None = None
    """
    n2 / n1 for two-group designs.
    """


class PowerOutputs(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    n_total: int | None
    n_per_group: list[int] | None
    detectable_effect: float | None
    achieved_power: float | None
    method_note: str
    """
    Method and any approximation used (documented per SPEC §8).
    """


class RecommendationCategory(StrEnum):
    design = 'design'
    data_collection = 'data_collection'
    qualtrics_setup = 'qualtrics_setup'
    analysis = 'analysis'


class Recommendation(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    category: RecommendationCategory = Field(..., title='RecommendationCategory')
    text: str
    why: str


class PowerAnalysis(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    analysis_id: str
    """
    Test family the calculation is for, e.g. t_test.independent, anova.one_way, correlation.pearson, chi_square.independence, regression.linear.
    """
    mode: PowerMode = Field(..., title='PowerMode')
    """
    a_priori: effect -> required n. sensitivity: n -> detectable effect.
    """
    inputs: PowerInputs
    outputs: PowerOutputs | None
    """
    null until computed.
    """


class StudyPlan(BaseModel):
    """
    Output of the Study Planner (pre-data-collection). Can seed a later analysis project. SPEC §11.2.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    schema_version: Literal[1]
    id: str
    title: str
    created_at: AwareDatetime
    modified_at: AwareDatetime
    design: DesignAnswers
    planned_analyses: list[PlannedAnalysis]
    power_analyses: list[PowerAnalysis]
    recommendations: list[Recommendation]
