# Generated from contracts/*.json by scripts/gen-contracts.sh. DO NOT EDIT.

from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

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

from . import AnalysisResult, DatasetMeta, ProjectFile
from .DatasetMeta import DatasetMeta as DatasetMeta_1
from .ProjectFile import ProjectFile as ProjectFile_1
from .VariableSchema import VariableSchema


class Rpc(RootModel[Any]):
    root: Any = Field(..., title='Rpc')
    """
    Params/result schemas for the Phase 1 JSON-RPC methods (method table in contracts/README.md). Definitions only; the root schema itself is not used.
    """


class CellValue(RootModel[str | float | bool | None]):
    root: str | float | bool | None = Field(..., title='CellValue')


class ImportFileInput(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    path: str
    """
    Absolute path chosen via the OS file dialog.
    """
    sheet_name: str | None
    """
    XLSX sheet; null = first sheet / ask.
    """


class QualtricsMode(StrEnum):
    auto = 'auto'
    on = 'on'
    off = 'off'


class DatasetImportPreviewParams(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    files: list[ImportFileInput] = Field(..., min_length=1)
    qualtrics_mode: QualtricsMode = Field(..., title='QualtricsMode')
    stack_onto_dataset_id: str | None
    """
    Set when previewing files to append to an existing dataset (dataset.stack).
    """


class ColumnRef(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    file_id: str
    column: str


class ColumnMatchStatus(StrEnum):
    matched = 'matched'
    unmatched = 'unmatched'
    possibly_renamed = 'possibly_renamed'


class ColumnMatch(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    variable: str
    """
    Resulting variable name in the stacked dataset.
    """
    status: ColumnMatchStatus = Field(..., title='ColumnMatchStatus')
    similarity: confloat(ge=0.0, le=1.0) | None
    """
    Fuzzy question-text similarity for possibly_renamed.
    """
    columns: list[ColumnRef]
    """
    One column per file that contributes; files missing here get NA.
    """


class ImportFileDecision(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    file_id: str
    sheet_name: str | None
    encoding: str | None
    delimiter: str | None
    qualtrics_header_rows: conint(ge=1, le=3)
    time_label: str | None
    drop_columns: list[str]
    """
    Columns dropped at import (e.g. PII); recorded in import_log.dropped_columns.
    """


class StackConfig(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    time_variable: str
    levels: list[DatasetMeta.StackLevel]
    column_matches: list[ColumnMatch]
    """
    User-confirmed matching.
    """


class LinkReport(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    counts: DatasetMeta.LinkCounts
    unmatched_ids: list[str] = Field(..., max_length=200)
    """
    Normalized IDs (sample, max 200).
    """
    duplicate_ids: list[str] = Field(..., max_length=200)
    explanation: str


class RowSort(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    variable: str
    descending: bool


class DatasetRowsParams(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    dataset_id: str
    snapshot_id: str | None
    """
    If set and stale, the engine returns error -32002.
    """
    offset: conint(ge=0)
    limit: conint(ge=1, le=2000)
    columns: list[str] | None
    """
    null = all variables in display order.
    """
    sort: RowSort | None


class DatasetRowsResult(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    snapshot_id: str
    offset: conint(ge=0)
    total_rows: conint(ge=0)
    columns: list[str]
    row_ids: list[int]
    """
    _statly_row_id per returned row.
    """
    rows: list[list[CellValue | None]]
    """
    Row-major; missing-coded values are returned as stored (not nulled).
    """


class DatasetIdParams(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    dataset_id: str


class DatasetMissingSummaryResult(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    snapshot_id: str
    missing_summary: list[DatasetMeta.VariableMissingSummary]


class ProjectLoadParams(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    path: str


class ProjectAutosaveResult(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    autosave_path: str
    saved_at: AwareDatetime


class ProjectRecoverableParams(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    autosave_dir: str


class RecoverableAutosave(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    autosave_path: str
    marker: ProjectFile.AutosaveMarker


class ProjectRecoverableResult(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    autosaves: list[RecoverableAutosave]


class ProjectDiscardAutosaveParams(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    autosave_path: str


class OkResult(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    ok: Literal[True]


class ImportIssue(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    code: str
    severity: AnalysisResult.WarningSeverity
    message: str
    file_id: str | None
    column: str | None


class DatasetLinkParams(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    dataset_id: str
    mode: DatasetMeta.LinkMode
    id_variable: str | None
    normalization: DatasetMeta.IdNormalization | None


class FilePreview(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    file_id: str
    path: str
    name: str
    sha256: constr(pattern=r'^[0-9a-f]{64}$')
    size_bytes: conint(ge=0)
    format: DatasetMeta.FileFormat
    sheets: list[str]
    sheet_name: str | None
    encoding: str | None
    delimiter: str | None
    qualtrics: DatasetMeta.QualtricsDetection
    n_rows: conint(ge=0)
    proposed_variables: list[VariableSchema]
    """
    Engine's best guess per column (role, level, labels, metadata/PII flags) for user confirmation.
    """
    sample_rows: list[list[CellValue | None]] = Field(..., max_length=50)
    """
    First rows, cells in proposed_variables order.
    """
    suggested_row_filters: list[DatasetMeta.RowFilter]
    """
    rows_removed = rows that WOULD be removed.
    """
    suggested_scales: list[DatasetMeta.Scale]
    """
    Matrix-question groupings (origin matrix_suggestion).
    """
    multiselect_candidates: list[str]
    """
    Columns holding comma-separated multi-select answers (split offered in Phase 2).
    """
    issues: list[ImportIssue]


class DatasetImportPreviewResult(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    preview_id: str
    """
    Handle to the engine's staged parse; valid until the next import_preview or engine restart.
    """
    files: list[FilePreview]
    stack_proposal: list[ColumnMatch] | None
    """
    Column matching across files (or against stack_onto_dataset_id); null for a single new file.
    """


class DatasetImportParams(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    preview_id: str
    files: list[ImportFileDecision] = Field(..., min_length=1)
    row_filters: list[DatasetMeta.RowFilter]
    """
    Filters to apply; rows_removed on input is ignored and recomputed.
    """
    variables: list[VariableSchema]
    """
    User-confirmed variable metadata (from proposed_variables); empty = accept proposals.
    """
    stack: StackConfig | None
    """
    Required when importing 2+ files at once.
    """


class DatasetStackParams(BaseModel):
    """
    Append newly previewed files (e.g. a later Follow-up export) to an existing dataset.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    dataset_id: str
    preview_id: str
    files: list[ImportFileDecision] = Field(..., min_length=1)
    row_filters: list[DatasetMeta.RowFilter]
    """
    Filters to apply; rows_removed on input is ignored and recomputed.
    """
    variables: list[VariableSchema]
    """
    User-confirmed variable metadata (from proposed_variables); empty = accept proposals.
    """
    stack: StackConfig


class DatasetResult(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    dataset_meta: DatasetMeta_1


class DatasetLinkResult(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    dataset_meta: DatasetMeta_1
    report: LinkReport | None


class ProjectSaveParams(BaseModel):
    """
     Frontend-held parts; the engine substitutes its authoritative dataset_meta and data.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    path: str
    """
    Destination .statly path. Written atomically (temp file + rename); deletes this project's autosave on success.
    """
    project: ProjectFile_1


class ProjectSaveResult(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    path: str
    saved_at: AwareDatetime
    size_bytes: conint(ge=0)
    project: ProjectFile_1


class ProjectLoadResult(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    project: ProjectFile_1
    is_autosave: bool
    autosave_marker: ProjectFile.AutosaveMarker | None


class ProjectAutosaveParams(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    autosave_dir: str
    """
    App data dir supplied by the shell (Tauri appDataDir/autosave).
    """
    original_path: str | None
    project: ProjectFile_1
