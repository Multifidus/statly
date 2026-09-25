# Generated from contracts/*.json by scripts/gen-contracts.sh. DO NOT EDIT.

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, PositiveFloat, conint

from . import AnalysisRequest


class ChartThemePreset(StrEnum):
    """
    Light/dark is a preview concern, not stored.
    """

    statly = 'statly'
    apa = 'apa'


class ChartType(StrEnum):
    bar = 'bar'
    grouped_bar = 'grouped_bar'
    line = 'line'
    interaction = 'interaction'
    box = 'box'
    violin = 'violin'
    histogram = 'histogram'
    density = 'density'
    qq = 'qq'
    scatter = 'scatter'
    correlation_heatmap = 'correlation_heatmap'
    likert_diverging = 'likert_diverging'
    stacked_bar = 'stacked_bar'
    percent_bar = 'percent_bar'
    scree = 'scree'
    cfa_path = 'cfa_path'


class ErrorBarKind(StrEnum):
    none = 'none'
    se = 'se'
    sd = 'sd'
    ci95 = 'ci95'


class ChartSourceKind(StrEnum):
    dataset = 'dataset'
    analysis = 'analysis'


class ChartSource(BaseModel):
    """
    Where the chart's data comes from: the dataset (aggregated by the engine) or a logged analysis result (scree plot, CFA path diagram, EMMs).
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    kind: ChartSourceKind = Field(..., title='ChartSourceKind')
    test_log_entry_id: str | None


class ShelfAggregate(StrEnum):
    none = 'none'
    mean = 'mean'
    median = 'median'
    count = 'count'
    percent = 'percent'
    sum = 'sum'


class ShelfField(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    variable: str
    aggregate: ShelfAggregate = Field(..., title='ShelfAggregate')


class Shelves(BaseModel):
    """
    Arrays allow several variables on a shelf (e.g. several Likert items on Y, heatmap variables on X).
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    x: list[ShelfField]
    y: list[ShelfField]
    color: list[ShelfField] = Field(..., max_length=1)
    facet: list[ShelfField] = Field(..., max_length=2)


class AxisCustomization(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    label: str | None = None
    min: float | None = None
    max: float | None = None


class LegendPosition(StrEnum):
    top = 'top'
    bottom = 'bottom'
    left = 'left'
    right = 'right'
    none = 'none'


class FitLine(StrEnum):
    none = 'none'
    linear = 'linear'
    loess = 'loess'


class ChartCustomization(BaseModel):
    """
    All fields optional; absent = preset default. Open for additions.
    """

    model_config = ConfigDict(
        extra='allow',
    )
    title: str | None = None
    subtitle: str | None = None
    x_axis: AxisCustomization | None = None
    y_axis: AxisCustomization | None = None
    palette: str | None = 'colorblind_safe'
    """
    Named palette; default is colorblind-safe.
    """
    font_family: str | None = None
    font_size: PositiveFloat | None = None
    legend_position: LegendPosition | None = Field(None, title='LegendPosition')
    data_labels: bool | None = None
    gridlines: bool | None = None
    fit_line: FitLine | None = Field(None, title='FitLine')
    width: conint(ge=50) | None = None
    height: conint(ge=50) | None = None


class ChartSpec(BaseModel):
    """
    A saved chart-builder chart. The compiled Vega-Lite spec is NOT stored; it is derived from this spec + data fetched from the engine. SPEC §10.2.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    schema_version: Literal[1]
    id: str
    chart_type: ChartType
    source: ChartSource
    shelves: Shelves
    subset: list[AnalysisRequest.SubsetCondition]
    """
    Row filter applied before plotting.
    """
    error_bars: ErrorBarKind
    customization: ChartCustomization
    theme_preset: ChartThemePreset = Field(..., title='ChartThemePreset')
    """
    Light/dark is a preview concern, not stored.
    """
    created_at: AwareDatetime
    modified_at: AwareDatetime
