# Generated from contracts/*.json by scripts/gen-contracts.sh. DO NOT EDIT.

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    RootModel,
    confloat,
    conint,
    constr,
)

from .AnalysisRequest import AnalysisRequest
from .AssumptionResult import AssumptionResult


class ConfidenceInterval(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    level: confloat(lt=1.0, gt=0.0)
    lower: float | None
    upper: float | None


class Statistic(BaseModel):
    """
    One test statistic. Multi-term analyses (ANOVA) emit one per term.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    key: str
    """
    Machine key: t, F, chi2, U, W, H, r, z, ...
    """
    label: str
    """
    e.g. 'Welch's t'.
    """
    symbol: str
    """
    APA symbol, italicized when rendered: t, F, χ², U.
    """
    value: float | None
    df: list[float] = Field(..., max_length=2)
    """
    [] none, [df] t/χ², [df1, df2] F. Non-integer allowed (Welch, GG).
    """
    p: confloat(ge=0.0, le=1.0) | None
    term: str | None
    """
    Model term / comparison this row belongs to (e.g. 'Group', 'Group × Time', 'Control vs A'); null for single-statistic tests.
    """


class EffectMagnitude(StrEnum):
    negligible = 'negligible'
    small = 'small'
    medium = 'medium'
    large = 'large'


class EffectSizeInterpretation(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    magnitude: EffectMagnitude = Field(..., title='EffectMagnitude')
    benchmark: str
    """
    Source of the benchmark, e.g. 'Cohen (1988)'.
    """
    text: str
    """
    Plain-language interpretation incl. the field-norms caveat.
    """


class EffectSize(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    key: str
    """
    cohens_d, hedges_g, glass_delta, d_z, d_av, r, rank_biserial, eta_sq, partial_eta_sq, omega_sq, cohens_f, epsilon_sq, kendall_w, cramers_v, phi, odds_ratio, r_sq, f_sq, ...
    """
    label: str
    symbol: str
    value: float | None
    ci: ConfidenceInterval | None
    """
    95% CI by default (AnalysisRequest.ci_level); null only where no CI method exists.
    """
    term: str | None
    interpretation: EffectSizeInterpretation | None


class GroupDescriptives(BaseModel):
    """
    Continuous-variable summary for one variable within one cell (group/time). All numbers nullable (undefined for n < 2 etc.).
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    variable: str
    group: dict[str, str | float | bool]
    """
    Grouping variable -> level for this cell; {} for the whole sample.
    """
    label: str
    n: conint(ge=0)
    n_missing: conint(ge=0)
    mean: float | None
    sd: float | None
    se: float | None
    ci: ConfidenceInterval | None
    """
    CI of the mean.
    """
    median: float | None
    q1: float | None
    q3: float | None
    iqr: float | None
    min: float | None
    max: float | None
    skewness: float | None
    kurtosis: float | None
    """
    Excess kurtosis.
    """


class FrequencyLevel(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    value: str | float | bool | None
    """
    null = the missing row.
    """
    label: str
    count: conint(ge=0)
    percent: float
    valid_percent: float | None


class FrequencyTable(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    variable: str
    group: dict[str, str | float | bool]
    levels: list[FrequencyLevel]


class Descriptives(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    continuous: list[GroupDescriptives]
    frequencies: list[FrequencyTable]


class TextRun(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    text: str
    italic: bool | None = False
    subscript: bool | None = False
    superscript: bool | None = False


class RichText(RootModel[list[TextRun]]):
    """
    Minimal styled text for APA output (italic statistical symbols, sub/superscripts). Concatenate run.text for plain text.
    """

    root: list[TextRun] = Field(..., title='RichText')
    """
    Minimal styled text for APA output (italic statistical symbols, sub/superscripts). Concatenate run.text for plain text.
    """


class ColumnAlign(StrEnum):
    left = 'left'
    center = 'center'
    right = 'right'
    decimal = 'decimal'


class ApaColumn(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    key: str
    header: RichText
    align: ColumnAlign = Field(..., title='ColumnAlign')


class ApaColumnGroup(BaseModel):
    """
    Spanning header above consecutive columns.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    label: RichText
    first_column: conint(ge=0)
    span: conint(ge=1)


class NumberCell(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['number']
    value: float | None
    display: str
    """
    Engine-formatted APA text (decimals, no leading zero where applicable).
    """


class PValueCell(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['p_value']
    value: float | None
    display: str
    """
    e.g. '.034', '< .001'.
    """


class IntervalCell(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['interval']
    lower: float | None
    upper: float | None
    display: str
    """
    e.g. '[0.12, 0.88]'.
    """


class TextCell(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['text']
    text: RichText


class EmptyCell(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['empty']


class TableCell(
    RootModel[NumberCell | PValueCell | IntervalCell | TextCell | EmptyCell]
):
    root: NumberCell | PValueCell | IntervalCell | TextCell | EmptyCell = Field(
        ..., title='TableCell'
    )


class ApaRowKind(StrEnum):
    data = 'data'
    section_header = 'section_header'
    total = 'total'


class ApaRow(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    cells: list[TableCell]
    """
    One cell per column, in column order.
    """
    indent: conint(ge=0, le=3)
    kind: ApaRowKind = Field(..., title='ApaRowKind')


class ApaNotes(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    general: RichText | None
    specific: list[RichText]
    probability: list[RichText]


class ApaTable(BaseModel):
    """
    Structured APA 7 table, renderable to HTML (clipboard) and DOCX/PDF. Table number is assigned at render/export time when null.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    number: conint(ge=1) | None
    title: str
    """
    Rendered in italic title case.
    """
    columns: list[ApaColumn] = Field(..., min_length=1)
    column_groups: list[ApaColumnGroup]
    rows: list[ApaRow]
    notes: ApaNotes


class WarningSeverity(StrEnum):
    info = 'info'
    caution = 'caution'
    serious = 'serious'


class ResultWarning(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    code: constr(pattern=r'^[a-z][a-z0-9_]*$')
    """
    e.g. small_sample, ties_present, unequal_groups, constant_variable, perfect_separation, pairs_dropped.
    """
    severity: WarningSeverity = Field(..., title='WarningSeverity')
    message: str
    """
    Plain-language message.
    """


class GroupCount(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    group: dict[str, str | float | bool]
    n: conint(ge=0)


class ResultInputs(BaseModel):
    """
    Exact inputs used, for reproducibility and the Test Log.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    request: AnalysisRequest
    dataset_id: str
    snapshot_id: str
    n_used: conint(ge=0)
    """
    Rows (or matched participants for paired designs) actually analysed.
    """
    n_excluded: conint(ge=0)
    """
    Rows in the subset excluded for missing data / unmatched IDs.
    """
    n_by_group: list[GroupCount]


class AnalysisResult(BaseModel):
    """
    Output of a pure engine analysis. Field list is fixed by SPEC §4. The engine is the single APA formatter: every numeric table cell carries an engine-formatted display string.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    schema_version: Literal[1]
    analysis_id: str
    """
    Echo of AnalysisRequest.analysis_id (the engine may resolve an alias to the concrete test run).
    """
    statistics: list[Statistic]
    effect_sizes: list[EffectSize]
    assumptions: list[AssumptionResult]
    descriptives: Descriptives
    plain_language_summary: str
    apa_sentence: RichText
    apa_table: ApaTable | None
    """
    Primary APA 7 table (null only if the analysis has no tabular output).
    """
    additional_tables: list[ApaTable]
    """
    Secondary tables (e.g. post hoc comparisons, item statistics, loadings).
    """
    warnings: list[ResultWarning]
    chart_data: dict[str, list[dict[str, float | str | bool | None]]]
    """
    Data for supporting charts (Q-Q, histograms, scree...), keyed by ChartRef.data_key. Each value is a list of flat records.
    """
    inputs: ResultInputs
    engine_version: str
    timestamp: AwareDatetime
