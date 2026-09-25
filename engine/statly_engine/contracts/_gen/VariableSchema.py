# Generated from contracts/*.json by scripts/gen-contracts.sh. DO NOT EDIT.

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PositiveFloat,
    RootModel,
    conint,
    constr,
)


class VariableRole(StrEnum):
    """
    SPEC §6 step 1 roles, plus 'unassigned' (before the interview) and 'scale_score' (computed scale totals/means).
    """

    unassigned = 'unassigned'
    identifier = 'identifier'
    group = 'group'
    time = 'time'
    test_item = 'test_item'
    test_total = 'test_total'
    likert_item = 'likert_item'
    scale_score = 'scale_score'
    demographic = 'demographic'
    open_text = 'open_text'
    ignore = 'ignore'


class MeasurementLevel(StrEnum):
    nominal = 'nominal'
    ordinal = 'ordinal'
    continuous = 'continuous'


class StorageDtype(StrEnum):
    """
    Logical storage type of the Parquet column.
    """

    integer = 'integer'
    float = 'float'
    string = 'string'
    boolean = 'boolean'
    datetime = 'datetime'


class ValueLabel(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    value: float | str
    """
    Stored code (e.g. 1) or raw text value.
    """
    label: str
    """
    Display label (e.g. 'Strongly agree').
    """


class ResponseRange(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    min: float
    max: float


class VariableSource(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    file_id: str
    """
    DatasetMeta.import_log.files[].file_id
    """
    original_column_name: str
    qualtrics_import_id: str | None
    """
    From header row 3, e.g. 'QID4' (null for 2-header-row or non-Qualtrics files).
    """
    header_texts: list[str]
    """
    Raw text of each header row for this column, top to bottom (1 entry for plain CSV, 2-3 for Qualtrics).
    """


class PiiKind(StrEnum):
    ip_address = 'ip_address'
    name = 'name'
    email = 'email'
    location = 'location'
    external_reference = 'external_reference'
    value_pattern = 'value_pattern'
    user_flagged = 'user_flagged'


class PiiReason(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    kind: PiiKind = Field(..., title='PiiKind')
    explanation: str
    """
    Plain-language reason shown to the user.
    """


class VariableOperand(BaseModel):
    """
    Reference to a variable, optionally at one time level (linked long datasets only: the value is taken from the same participant's row at that level).
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    variable: str
    time_level: str | None


class ComputedDifference(BaseModel):
    """
    Gain/difference score: minuend - subtrahend (e.g. post - pre).
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    op: Literal['difference']
    minuend: VariableOperand
    subtrahend: VariableOperand


class ComputedNormalizedGain(BaseModel):
    """
    Hake's normalized gain g = (post - pre) / (max_score - pre). Missing when pre == max_score.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    op: Literal['normalized_gain']
    pre: VariableOperand
    post: VariableOperand
    max_score: PositiveFloat


class ScaleScoreOp(StrEnum):
    scale_mean = 'scale_mean'
    scale_sum = 'scale_sum'


class ComputedScaleScore(BaseModel):
    """
    Mean or sum of answered items (reverse-coded items reversed first). Missing when fewer than min_items are answered.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    op: ScaleScoreOp = Field(..., title='ScaleScoreOp')
    items: list[str] = Field(..., min_length=1)
    min_items: conint(ge=1) | None
    """
    Minimum answered items; null = all items must be answered for scale_sum, at least one for scale_mean.
    """
    scale_id: str | None
    """
    Scale this score belongs to, if any.
    """


class RecodeRule(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    from_values: list[float | str] | None
    """
    Exact source values mapped by this rule (null when from_range is used).
    """
    from_range: ResponseRange | None
    """
    Inclusive numeric range mapped by this rule (null when from_values is used).
    """
    to: float | str | None
    """
    New value; null = set missing.
    """


class RecodeUnmatched(StrEnum):
    """
    What happens to values no rule matches.
    """

    keep = 'keep'
    missing = 'missing'


class ComputedRecode(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    op: Literal['recode']
    source: str
    rules: list[RecodeRule] = Field(..., min_length=1)
    unmatched: RecodeUnmatched = Field(..., title='RecodeUnmatched')
    """
    What happens to values no rule matches.
    """


class ComputedDefinition(
    RootModel[
        ComputedDifference
        | ComputedNormalizedGain
        | ComputedScaleScore
        | ComputedRecode
    ]
):
    root: (
        ComputedDifference
        | ComputedNormalizedGain
        | ComputedScaleScore
        | ComputedRecode
    ) = Field(..., title='ComputedDefinition')
    """
    Guided-builder operations only (no formula language). SPEC §6.
    """


class VariableSchema(BaseModel):
    """
    Metadata for one variable (column) of a dataset. Owned by the engine; the frontend edits it via RPC. SPEC §5, §6.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    schema_version: Literal[1]
    name: constr(min_length=1)
    """
    Unique variable name within the dataset (Qualtrics row-1 short ID, e.g. Q5_1). Also the Parquet column name.
    """
    label: str | None
    """
    Short human-readable label.
    """
    question_text: str | None
    """
    Full question text (Qualtrics row 2).
    """
    role: VariableRole
    level: MeasurementLevel
    dtype: StorageDtype
    value_labels: list[ValueLabel]
    """
    Ordered code -> label pairs. Array order IS the category order (matters for ordinal/Likert variables).
    """
    reverse_coded: bool
    """
    If true, scoring uses (min + max) - x with min/max from response_range.
    """
    response_range: ResponseRange | None
    """
    Theoretical min/max of the response scale (e.g. 1..5). Required for reverse-coding; defaults from value_labels codes.
    """
    scale_id: str | None
    """
    Back-reference to DatasetMeta.scales[].id. DatasetMeta.scales[].items is authoritative; the engine keeps both in sync.
    """
    missing_codes: list[float | str]
    """
    User-declared missing-value codes (e.g. -99). Treated as missing in every analysis.
    """
    sources: list[VariableSource]
    """
    Provenance: one entry per imported file this column came from (several when files were stacked). Empty for computed variables.
    """
    is_metadata: bool
    """
    Qualtrics metadata / timing column. Hidden by default, kept available.
    """
    is_pii: bool
    """
    Flagged as personally identifying (FERPA/IRB).
    """
    pii_reason: PiiReason | None
    """
    Why the column was flagged; null when is_pii is false.
    """
    computed: ComputedDefinition | None
    """
    Guided-builder definition when this is a computed variable; null for imported columns.
    """
    display_order: conint(ge=0)
    """
    Position in the Variables screen and data grid.
    """
