"""Analysis registry: ``@register("analysis_id", ...)`` on a pure function
``fn(df, request, meta) -> AnalysisResult dict``.

`df` is the dataset frame already reduced to the request's subset; `request` is the validated
pydantic AnalysisRequest; `meta` is the DatasetMeta dict (labels, value labels, missing codes,
link config) or None (fixture tests). Functions must not mutate `df` and must build their result
with stats.core.ResultBuilder.

Roles are declared as one or more *layouts* (alternative sets of roles, e.g. paired t accepts
wide `measures` or long `outcome` + `time` + `subject_id`). The registry checks the request's
role -> variable lists against the layouts before calling the function, so analyses can index
`request.variables[...]` safely.
"""

from __future__ import annotations

import importlib
from dataclasses import dataclass, field
from typing import Callable

import pandas as pd

from statly_engine.contracts import AnalysisRequest
from statly_engine.errors import InvalidParams
from statly_engine.stats import prep

# Modules whose import registers analyses. Add new analysis modules here.
ANALYSIS_MODULES = ("statly_engine.stats.descriptives", "statly_engine.stats.ttests")


@dataclass(frozen=True)
class Role:
    name: str
    min: int = 1
    max: int | None = 1          # None = unbounded
    description: str = ""


@dataclass(frozen=True)
class Layout:
    name: str
    roles: tuple[Role, ...]


@dataclass(frozen=True)
class AnalysisSpec:
    analysis_id: str
    label: str
    fn: Callable
    layouts: tuple[Layout, ...]
    options: dict = field(default_factory=dict)   # option name -> description (for analysis.list)

    def match_layout(self, variables: dict[str, list[str]]) -> Layout:
        given = {k for k, v in variables.items() if v}
        problems = []
        for layout in self.layouts:
            names = {r.name for r in layout.roles}
            extra = given - names
            bad = [r for r in layout.roles
                   if len(variables.get(r.name, [])) < r.min
                   or (r.max is not None and len(variables.get(r.name, [])) > r.max)]
            if not extra and not bad:
                return layout
            problems.append(_describe(layout, extra, bad))
        raise InvalidParams(f"The variables chosen don't fit {self.label}. " + " Or: ".join(problems))


def _describe(layout: Layout, extra: set, bad: list[Role]) -> str:
    parts = []
    for r in bad:
        want = f"{r.min}" if r.max == r.min else (f"{r.min} or more" if r.max is None else f"{r.min} to {r.max}")
        parts.append(f"'{r.name}' needs {want} variable(s)")
    if extra:
        parts.append(f"unexpected role(s): {', '.join(sorted(extra))}")
    return f"[{layout.name}] " + "; ".join(parts) + "."


REGISTRY: dict[str, AnalysisSpec] = {}


def register(analysis_id: str, *, label: str, roles: "list[Role] | dict[str, list[Role]]",
             options: dict | None = None):
    """Decorator. `roles` is one list of Roles, or {layout_name: [Role, ...]} for alternatives."""
    layouts = (tuple(Layout(n, tuple(r)) for n, r in roles.items()) if isinstance(roles, dict)
               else (Layout("default", tuple(roles)),))

    def deco(fn):
        if analysis_id in REGISTRY and REGISTRY[analysis_id].fn is not fn:
            raise ValueError(f"analysis id registered twice: {analysis_id}")
        REGISTRY[analysis_id] = AnalysisSpec(analysis_id, label, fn, layouts, options or {})
        return fn
    return deco


def load_all() -> dict[str, AnalysisSpec]:
    for mod in ANALYSIS_MODULES:
        importlib.import_module(mod)
    return REGISTRY


def get(analysis_id: str) -> AnalysisSpec:
    load_all()
    spec = REGISTRY.get(analysis_id)
    if spec is None:
        raise InvalidParams(f"Unknown analysis '{analysis_id}'.", analysis_id=analysis_id)
    return spec


def describe_all() -> list[dict]:
    """analysis.list payload: ids, labels, role layouts, options."""
    load_all()
    return [{
        "analysis_id": s.analysis_id, "label": s.label,
        "layouts": [{"name": l.name, "roles": [{"role": r.name, "min": r.min, "max": r.max,
                                                "description": r.description} for r in l.roles]}
                    for l in s.layouts],
        "options": s.options,
    } for s in sorted(REGISTRY.values(), key=lambda s: s.analysis_id)]


def run(df: pd.DataFrame, request: "AnalysisRequest | dict", meta: dict | None = None) -> dict:
    """Validate the request, apply its subset, and run the registered analysis (pure)."""
    req = request if isinstance(request, AnalysisRequest) else AnalysisRequest.model_validate(request)
    spec = get(req.analysis_id)
    spec.match_layout(req.variables)
    prep.require(df, [v for names in req.variables.values() for v in names])
    sub = prep.apply_subset(df, req.subset, meta)
    if len(sub) == 0:
        raise InvalidParams("No rows are left after applying the filter, so there is nothing to analyse.")
    return spec.fn(sub, req, meta)
