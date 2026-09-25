"""ResultBuilder: assembles a contract-valid AnalysisResult (contracts/AnalysisResult.json).

Every analysis builds its result through this class so the shape, the effect-size
interpretation (Cohen benchmarks + the field-norms caveat), the standard warnings and the
inputs echo are identical across analyses. `build()` validates with the generated pydantic
model and returns a JSON-ready dict.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone

import numpy as np

from statly_engine import ENGINE_VERSION
from statly_engine.contracts import AnalysisRequest, AnalysisResult
from statly_engine.stats.apa import Rich
from statly_engine.stats.effect_sizes import Estimate

SMALL_N = 30            # per-group n below which a small_sample warning is raised
UNEQUAL_RATIO = 1.5     # largest/smallest group n above which unequal_groups is raised
FEW_DISTINCT = 7        # <= this many distinct values -> ties_present (Likert-like outcome)

# Conventional benchmarks: (upper bound of negligible, small, medium); >= last is large.
BENCHMARKS: dict[str, tuple[tuple[float, float, float], str]] = {
    "d": ((0.2, 0.5, 0.8), "Cohen (1988)"),           # d, g, delta, d_z, d_av
    "r": ((0.1, 0.3, 0.5), "Cohen (1988)"),           # r, rank-biserial, phi
    "eta_sq": ((0.01, 0.06, 0.14), "Cohen (1988)"),   # eta², partial eta², omega², epsilon²
    "cohens_f": ((0.1, 0.25, 0.4), "Cohen (1988)"),
    "f_sq": ((0.02, 0.15, 0.35), "Cohen (1988)"),
    "kendall_w": ((0.1, 0.3, 0.5), "Cohen (1988)"),
}
FIELD_NORMS = ("These size labels are general rules of thumb. In education research, effects are "
               "usually judged against similar studies and programs, where even a \"small\" effect can "
               "be meaningful.")
_MAG_WORD = {"negligible": "very small (negligible)", "small": "small", "medium": "medium-sized",
             "large": "large"}


def finite(x) -> bool:
    return x is not None and isinstance(x, (int, float, np.floating, np.integer)) and math.isfinite(float(x))


def clean(x):
    """float or None (NaN/inf -> None) for contract numbers."""
    return float(x) if finite(x) else None


def magnitude(value: float | None, family: str) -> str | None:
    if not finite(value) or family not in BENCHMARKS:
        return None
    cuts, _ = BENCHMARKS[family]
    a = abs(value)
    for label, cut in zip(("negligible", "small", "medium"), cuts):
        if a < cut:
            return label
    return "large"


def interpret(value: float | None, family: str | None, what: str = "difference") -> dict | None:
    """EffectSizeInterpretation with Cohen's benchmark and the field-norms caveat (SPEC §8)."""
    if family is None:
        return None
    mag = magnitude(value, family)
    if mag is None:
        return None
    return {"magnitude": mag, "benchmark": BENCHMARKS[family][1],
            "text": f"By common benchmarks this is a {_MAG_WORD[mag]} {what}. {FIELD_NORMS}"}


def warning(code: str, severity: str, message: str) -> dict:
    return {"code": code, "severity": severity, "message": message}


def small_sample_warning(counts: dict[str, int]) -> dict | None:
    small = {k: n for k, n in counts.items() if n < SMALL_N}
    if not small:
        return None
    if len(counts) == 1:
        n = next(iter(counts.values()))
        msg = (f"Only {n} scores were analysed. With fewer than {SMALL_N}, results are less precise and "
               "depend more on the data being roughly bell-shaped, so check the plots.")
    else:
        parts = ", ".join(f"{k} (n = {n})" for k, n in small.items())
        msg = (f"Some groups have fewer than {SMALL_N} people: {parts}. Small groups give less precise "
               "results and depend more on the data being roughly bell-shaped, so check the plots.")
    return warning("small_sample", "caution", msg)


def unequal_groups_warning(counts: dict[str, int]) -> dict | None:
    ns = [n for n in counts.values() if n > 0]
    if len(ns) < 2 or max(ns) / min(ns) <= UNEQUAL_RATIO:
        return None
    parts = ", ".join(f"{k} (n = {n})" for k, n in counts.items())
    return warning("unequal_groups", "info",
                   f"The groups are quite different in size: {parts}. Tests that assume equal spread "
                   "are less trustworthy when group sizes differ, which is one reason Statly uses "
                   "Welch's version by default.")


def ties_warning(values, variable_label: str) -> dict | None:
    """Few distinct values (e.g. one Likert item): many tied scores."""
    vals = np.asarray(values, float)
    vals = vals[np.isfinite(vals)]
    k = len(np.unique(vals))
    if len(vals) == 0 or k > FEW_DISTINCT or k == len(vals):
        return None
    return warning("ties_present", "info",
                   f"{variable_label} has only {k} different values, so many scores are tied (common "
                   "for a single survey item). Single Likert items are ordinal; a rank-based test such "
                   "as Mann-Whitney or Wilcoxon is often recommended for them.")


def missing_warning(n_excluded: int, what: str = "rows") -> dict | None:
    if n_excluded <= 0:
        return None
    return warning("missing_data", "info",
                   f"{n_excluded} {what} were left out because a value needed for this analysis was "
                   "blank or marked missing. Everyone else's answers were used.")


def constant_warning(label: str) -> dict:
    return warning("constant_variable", "serious",
                   f"Every score in {label} is the same, so there is no variation to test. The test "
                   "statistic can't be calculated.")


class ResultBuilder:
    """Collects the parts of one AnalysisResult.

    Usage (see stats/README.md):
        b = ResultBuilder(request)
        b.statistic("t", "Student's t", "t", t, [df], p)
        b.effect("cohens_d", "Cohen's d", "d", estimate, family="d")
        ... b.summary(...); b.sentence(rich); b.table(apa.table(...)); b.inputs(...)
        return b.build()
    """

    def __init__(self, request: AnalysisRequest, analysis_id: str | None = None):
        self.request = request
        self.analysis_id = analysis_id or request.analysis_id
        self.statistics: list[dict] = []
        self.effect_sizes: list[dict] = []
        self.assumptions: list[dict] = []
        self.continuous: list[dict] = []
        self.frequencies: list[dict] = []
        self.plain_language_summary = ""
        self.apa_sentence: list[dict] = []
        self.apa_table: dict | None = None
        self.additional_tables: list[dict] = []
        self.warnings: list[dict] = []
        self.chart_data: dict[str, list[dict]] = {}
        self._inputs: dict | None = None

    # -- parts ---------------------------------------------------------------
    def statistic(self, key: str, label: str, symbol: str, value, df=(), p=None, term: str | None = None):
        self.statistics.append({"key": key, "label": label, "symbol": symbol, "value": clean(value),
                                "df": [float(d) for d in df if finite(d)], "p": clean(p), "term": term})
        return self

    def effect(self, key: str, label: str, symbol: str, est: Estimate, family: str | None = None,
               term: str | None = None, what: str = "difference"):
        ci = None
        if est.value is not None and (est.lower is not None or est.upper is not None):
            ci = {"level": est.level, "lower": clean(est.lower), "upper": clean(est.upper)}
        self.effect_sizes.append({"key": key, "label": label, "symbol": symbol, "value": clean(est.value),
                                  "ci": ci, "term": term, "interpretation": interpret(est.value, family, what)})
        return self

    def assumption(self, result: dict, charts: dict[str, list[dict]] | None = None):
        self.assumptions.append(result)
        for k, v in (charts or {}).items():
            self.chart_data[k] = v
        return self

    def descriptives(self, rows: list[dict]):
        self.continuous.extend(rows)
        return self

    def frequency_tables(self, tables: list[dict]):
        self.frequencies.extend(tables)
        return self

    def summary(self, text: str):
        self.plain_language_summary = text
        return self

    def sentence(self, rich: Rich | list[dict]):
        self.apa_sentence = rich.runs if isinstance(rich, Rich) else rich
        return self

    def table(self, table: dict):
        self.apa_table = table
        return self

    def extra_table(self, table: dict):
        self.additional_tables.append(table)
        return self

    def warn(self, w: dict | None):
        if w is not None and all(x["code"] != w["code"] for x in self.warnings):
            self.warnings.append(w)
        return self

    def chart(self, key: str, records: list[dict]):
        self.chart_data[key] = records
        return self

    def inputs(self, n_used: int, n_excluded: int, n_by_group: list[tuple[dict, int]] | None = None):
        self._inputs = {"n_used": int(n_used), "n_excluded": int(n_excluded),
                        "n_by_group": [{"group": g, "n": int(n)} for g, n in (n_by_group or [])]}
        return self

    # -- output --------------------------------------------------------------
    def build(self) -> dict:
        if self._inputs is None:
            raise RuntimeError("ResultBuilder.inputs() must be called before build()")
        req = self.request
        result = {
            "schema_version": 1,
            "analysis_id": self.analysis_id,
            "statistics": self.statistics,
            "effect_sizes": self.effect_sizes,
            "assumptions": self.assumptions,
            "descriptives": {"continuous": self.continuous, "frequencies": self.frequencies},
            "plain_language_summary": self.plain_language_summary,
            "apa_sentence": self.apa_sentence,
            "apa_table": self.apa_table,
            "additional_tables": self.additional_tables,
            "warnings": self.warnings,
            "chart_data": self.chart_data,
            "inputs": {"request": req.model_dump(mode="json"), "dataset_id": req.dataset_id,
                       "snapshot_id": req.snapshot_id, **self._inputs},
            "engine_version": ENGINE_VERSION,
            "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        }
        return AnalysisResult.model_validate(result).model_dump(mode="json")
