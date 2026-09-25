# Generated from contracts/*.json by scripts/gen-contracts.sh. DO NOT EDIT.

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    confloat,
    conint,
    constr,
)

from .VariableSchema import VariableSchema


class ScaleScoringMethod(StrEnum):
    mean = 'mean'
    sum = 'sum'


class ScaleOrigin(StrEnum):
    """
    matrix_suggestion = proposed from a Qualtrics matrix question (Q5_1, Q5_2, ...).
    """

    user = 'user'
    matrix_suggestion = 'matrix_suggestion'


class Scale(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: str
    name: str
    items: list[str]
    """
    Item variable names (authoritative scale membership).
    """
    scoring_method: ScaleScoringMethod = Field(..., title='ScaleScoringMethod')
    min_items: conint(ge=1) | None
    """
    Minimum answered items for a score; null = no threshold beyond at least one (mean) / all (sum).
    """
    score_variable: str | None
    """
    Name of the computed variable (op scale_mean/scale_sum) holding the score, once created.
    """
    origin: ScaleOrigin = Field(..., title='ScaleOrigin')
    """
    matrix_suggestion = proposed from a Qualtrics matrix question (Q5_1, Q5_2, ...).
    """


class FileFormat(StrEnum):
    csv = 'csv'
    xlsx = 'xlsx'


class QualtricsDetection(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    detected: bool
    confirmed: bool
    """
    User accepted (or forced) Qualtrics mode.
    """
    header_rows: conint(ge=1, le=3)
    """
    Header rows consumed: 1 (plain), 2 (older Qualtrics) or 3 (with ImportId row).
    """


class RowFilterKind(StrEnum):
    exclude_values = 'exclude_values'
    exclude_unfinished = 'exclude_unfinished'
    progress_below = 'progress_below'


class DropReason(StrEnum):
    pii = 'pii'
    user = 'user'


class DroppedColumn(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    file_id: str
    column: str
    reason: DropReason = Field(..., title='DropReason')


class StackLevel(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    file_id: str
    label: str


class LinkMode(StrEnum):
    aggregate = 'aggregate'
    linked = 'linked'


class IdNormalization(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    trim_whitespace: bool
    case_insensitive: bool


class LinkCounts(BaseModel):
    """
    Participant-level counts after normalization.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    matched: conint(ge=0)
    """
    IDs present at every time level.
    """
    unmatched: conint(ge=0)
    """
    IDs missing from at least one time level (excluded only from paired/repeated analyses).
    """
    duplicate: conint(ge=0)
    """
    IDs appearing more than once within a single time level.
    """


class VariableMissingSummary(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    variable: str
    n_total: conint(ge=0)
    n_valid: conint(ge=0)
    n_missing_blank: conint(ge=0)
    """
    Empty / NA cells.
    """
    n_missing_coded: conint(ge=0)
    """
    Cells equal to a declared missing code.
    """
    pct_missing: confloat(ge=0.0, le=100.0)


class ImportedFile(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    file_id: str
    name: str
    """
    Original file name (no directory).
    """
    sha256: constr(pattern=r'^[0-9a-f]{64}$')
    size_bytes: conint(ge=0)
    format: FileFormat
    encoding: str | None
    """
    Detected/confirmed text encoding for CSV (e.g. utf-8, utf-8-sig, utf-16-le, cp1252); null for XLSX.
    """
    delimiter: str | None
    """
    Detected/confirmed CSV delimiter; null for XLSX.
    """
    sheet_name: str | None
    """
    Chosen XLSX sheet; null for CSV.
    """
    qualtrics: QualtricsDetection
    time_label: str | None
    """
    User-editable time label when stacked (e.g. 'Pre').
    """
    n_rows_read: conint(ge=0)
    """
    Data rows read, after header rows.
    """
    n_rows_kept: conint(ge=0)
    """
    Rows kept after row filters.
    """
    stored_path: str
    """
    Path of the untouched original inside the .statly zip, e.g. 'originals/<file_id>/<name>'.
    """
    imported_at: AwareDatetime


class RowFilter(BaseModel):
    """
    A row exclusion applied at import, with its plain-language explanation and effect.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: str
    kind: RowFilterKind
    file_id: str | None
    """
    File the filter applied to; null = all files.
    """
    variable: str | None
    """
    Column tested (e.g. Status, Finished, Progress).
    """
    values: list[str | float] | None
    """
    exclude_values: values that exclude a row (e.g. ['Survey Preview', 'Spam'] or Qualtrics codes 1, 8).
    """
    threshold: float | None
    """
    progress_below: rows with Progress < threshold are removed.
    """
    explanation: str
    rows_removed: conint(ge=0)


class StackingInfo(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    time_variable: str
    """
    Name of the created Time variable (role 'time').
    """
    levels: list[StackLevel]
    """
    Time levels in order (this order is the Time variable's value order).
    """


class LinkConfig(BaseModel):
    """
    Aggregate (default) or linked mode. In linked mode id_variable, normalization and counts are non-null.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    mode: LinkMode = Field(..., title='LinkMode')
    id_variable: str | None
    normalization: IdNormalization | None
    counts: LinkCounts | None


class ImportLog(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    files: list[ImportedFile]
    row_filters: list[RowFilter]
    dropped_columns: list[DroppedColumn]


class DatasetMeta(BaseModel):
    """
    Everything about a dataset except the rows. The engine owns the data (Parquet); the frontend holds only this plus paged row slices (dataset.rows). SPEC §5.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    schema_version: Literal[1]
    dataset_id: constr(min_length=1)
    """
    Stable id for the dataset for the life of the project.
    """
    snapshot_id: constr(min_length=1)
    """
    Content id of the current data + variable metadata. Changes on every mutation; analyses are pure functions of (snapshot_id, AnalysisRequest).
    """
    n_rows: conint(ge=0)
    row_id_column: Literal['_statly_row_id']
    """
    Reserved int64 Parquet column holding a stable per-row id (survives sorting/filtering; referenced by TagCodebook applications). Not listed in variables.
    """
    variables: list[VariableSchema]
    scales: list[Scale]
    import_log: ImportLog
    stacking: StackingInfo | None
    """
    Present when several files were stacked into one long dataset.
    """
    link: LinkConfig
    missing_summary: list[VariableMissingSummary]
