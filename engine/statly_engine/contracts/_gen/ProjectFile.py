# Generated from contracts/*.json by scripts/gen-contracts.sh. DO NOT EDIT.

from __future__ import annotations

from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict

from .ChartSpec import ChartSpec
from .DatasetMeta import DatasetMeta
from .StudyPlan import StudyPlan
from .TagCodebook import TagCodebook
from .TestLogEntry import TestLogEntry


class TestFamily(BaseModel):
    """
    User-named group of related tests for multiple-comparison correction. Membership and method live on TestLogEntry.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: str
    name: str


class UiState(BaseModel):
    """
    Minimal, non-essential UI restore hints. Safe to discard.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    active_view: str | None
    """
    e.g. 'data', 'variables', 'analyze', 'results', 'charts', 'qualitative', 'planner'.
    """
    active_chart_id: str | None = None
    active_test_log_entry_id: str | None = None


class AutosaveMarker(BaseModel):
    """
    autosave.json, present ONLY in autosave copies of a .statly zip.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    schema_version: Literal[1]
    project_id: str
    original_path: str | None
    """
    Path of the real .statly file; null if never saved.
    """
    saved_at: AwareDatetime


class ProjectFile(BaseModel):
    """
    Root document stored as project.json inside a .statly zip (layout in contracts/README.md). SPEC §13 Phase 1.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    schema_version: Literal[1]
    project_id: str
    """
    Stable UUID; keys autosave files.
    """
    name: str
    app_version: str
    engine_version: str
    """
    Engine version that last wrote the file.
    """
    created_at: AwareDatetime
    modified_at: AwareDatetime
    dataset_meta: DatasetMeta | None
    """
    null for a planner-only project with no data yet.
    """
    data_path: str | None
    """
    Parquet path inside the zip ('data/dataset.parquet'); null iff dataset_meta is null.
    """
    test_log: list[TestLogEntry]
    test_families: list[TestFamily]
    chart_specs: list[ChartSpec]
    tag_codebook: TagCodebook | None
    study_plan: StudyPlan | None
    ui_state: UiState
