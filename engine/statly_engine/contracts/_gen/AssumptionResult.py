# Generated from contracts/*.json by scripts/gen-contracts.sh. DO NOT EDIT.

from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, confloat, conint, constr

from . import ChartSpec


class AssumptionVerdict(StrEnum):
    passed = 'passed'
    caution = 'caution'
    failed = 'failed'


class AssumptionTest(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    key: str
    """
    e.g. shapiro_wilk, ks_lilliefors, levene_brown_forsythe, mauchly, box_m, vif.
    """
    label: str
    """
    e.g. 'Shapiro-Wilk'.
    """


class AssumptionStatistic(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    symbol: str
    """
    APA symbol, e.g. 'W', 'F', 'χ²'.
    """
    value: float
    df: list[float] = Field(..., max_length=2)


class AssumptionScopeKind(StrEnum):
    group = 'group'
    differences = 'differences'
    residuals = 'residuals'
    overall = 'overall'


class AssumptionScope(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    kind: AssumptionScopeKind = Field(..., title='AssumptionScopeKind')
    label: str
    """
    e.g. 'Control group', 'Post - Pre differences'.
    """
    group: dict[str, Any] | None
    """
    For kind=group: grouping variable -> level value.
    """
    n: conint(ge=0) | None


class ChartRef(BaseModel):
    """
    A supporting visual. Its data lives in AnalysisResult.chart_data[data_key].
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    chart_type: ChartSpec.ChartType
    title: str
    data_key: str


class AssumptionResult(BaseModel):
    """
    Outcome of one assumption check for one subset of data (one group, the differences, the residuals, ...). SPEC §7.2.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    schema_version: Literal[1]
    assumption: constr(pattern=r'^[a-z][a-z0-9_]*$')
    """
    Assumption key (open enum), e.g. normality, homogeneity_of_variance, sphericity, independence, linearity, multicollinearity, outliers, homogeneity_of_regression_slopes, equal_covariance_matrices.
    """
    label: str
    """
    Display name, e.g. 'Normality'.
    """
    test_used: AssumptionTest | None
    """
    null for visual-only or design-based checks (e.g. independence).
    """
    statistic: AssumptionStatistic | None
    p: confloat(ge=0.0, le=1.0) | None
    verdict: AssumptionVerdict = Field(..., title='AssumptionVerdict')
    explanation: str
    """
    Plain-language meaning of the result for the user's decision (grade 8-10 reading level).
    """
    applies_to: AssumptionScope
    chart_refs: list[ChartRef]
