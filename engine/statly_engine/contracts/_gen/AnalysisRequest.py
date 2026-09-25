# Generated from contracts/*.json by scripts/gen-contracts.sh. DO NOT EDIT.

from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, confloat, constr


class Tails(StrEnum):
    """
    two_sided is the default (SPEC §3). greater/less are one-tailed alternatives.
    """

    two_sided = 'two_sided'
    greater = 'greater'
    less = 'less'


class CorrectionMethod(StrEnum):
    none = 'none'
    bonferroni = 'bonferroni'
    holm = 'holm'
    fdr_bh = 'fdr_bh'


class RequestedCorrection(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    scope: constr(pattern=r'^[a-z][a-z0-9_]*$')
    """
    Which set of p-values within this analysis, e.g. 'pairwise', 'matrix', 'simple_effects'.
    """
    method: CorrectionMethod


class SubsetOp(StrEnum):
    in_ = 'in'
    not_in = 'not_in'


class SubsetCondition(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    variable: str
    op: SubsetOp = Field(..., title='SubsetOp')
    values: list[str | float | bool] = Field(..., min_length=1)


class AnalysisRequest(BaseModel):
    """
    Input to a pure engine analysis: (snapshot_id, AnalysisRequest) -> AnalysisResult. SPEC §4, §7, §8.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    schema_version: Literal[1]
    request_id: constr(min_length=1)
    """
    Client-generated id (UUID); becomes the TestLogEntry id.
    """
    analysis_id: constr(pattern=r'^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$') = (
        Field(
            ...,
            examples=['descriptives', 't_test.one_sample', 't_test.independent', 't_test.paired', 'mann_whitney', 'wilcoxon_signed_rank', 'anova.one_way', 'anova.welch', 'kruskal_wallis', 'anova.repeated_measures', 'friedman', 'chi_square.independence', 'fisher_exact', 'correlation.pearson', 'reliability.cronbach_alpha'],
        )
    )
    """
    Open enum of analysis identifiers, dotted snake_case (family.variant). The engine's registry is authoritative.
    """
    dataset_id: str | None
    """
    null for dataset-free analyses (e.g. power.*; analysis.list reports needs_data=false).
    """
    snapshot_id: str | None
    """
    DatasetMeta.snapshot_id the request was built against; the engine rejects a stale snapshot. null for dataset-free analyses.
    """
    variables: dict[constr(pattern=r'^[a-z][a-z0-9_]*$'), list[str]]
    """
    Analysis role -> variable names. Role keys are analysis-specific snake_case (outcome, group, time, subject_id, covariates, predictors, items, x, y, ...). Always arrays for uniform typing.
    """
    subset: list[SubsetCondition]
    """
    Row conditions ANDed together (e.g. Time in ['Post']). Empty = all rows.
    """
    options: dict[str, Any]
    """
    Analysis-specific options (e.g. {"welch": true, "posthoc": "games_howell", "test_value": 3}). Per-analysis subschemas may be added later under $defs.
    """
    corrections: list[RequestedCorrection]
    """
    Within-analysis p-value adjustments requested (e.g. pairwise comparisons, correlation matrices). Cross-analysis family corrections live in the Test Log, never here.
    """
    alpha: confloat(lt=1.0, gt=0.0)
    tails: Tails
    ci_level: confloat(lt=1.0, gt=0.0)
