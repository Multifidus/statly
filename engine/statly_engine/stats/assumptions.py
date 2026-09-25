"""Assumption checks (SPEC §7.2, §8). Each check returns ``(AssumptionResult dict, chart_data dict)``.

The frontend never holds the data, so every normality check also ships the records for its
supporting charts (Q-Q plot, histogram) keyed by ChartRef.data_key; ResultBuilder.assumption()
merges them into AnalysisResult.chart_data.

R references (fixtures/r/assumptions.R):
- Shapiro-Wilk: scipy.stats.shapiro == stats::shapiro.test (Royston 1995, AS R94); 3 <= n <= 5000.
- Lilliefors KS: D from statsmodels.stats.diagnostic.lilliefors; the p-value reproduces
  nortest::lillie.test exactly (Dallal-Wilkinson 1986 approximation, and Stephens' (1974)
  modified-statistic polynomial when that approximation exceeds .10). statsmodels' own 'approx'
  p-value switches to a lookup table above .10 and would not match R. n >= 5.
- Levene / Brown-Forsythe: scipy.stats.levene(center='median') == car::leveneTest (default center).
- Q-Q theoretical quantiles: stats::qqnorm plotting positions, ppoints(n): (i - a) / (n + 1 - 2a),
  a = 3/8 for n <= 10 else 1/2.

Verdicts: p >= alpha -> passed. p < alpha -> failed, except when n >= LARGE_N, where normality
tests flag trivial departures, so the verdict is caution and the text points to the Q-Q plot.
"""

from __future__ import annotations

import math
import re
import warnings

import numpy as np
from scipy import stats
from statsmodels.stats.diagnostic import lilliefors as sm_lilliefors

from statly_engine.stats.apa import p_value

LARGE_N = 100
SMALL_CHECK_N = 20  # below this a passed normality test has little power; say so


def scope(kind: str, label: str, group: dict | None = None, n: int | None = None) -> dict:
    """AssumptionScope: kind in group | differences | residuals | overall."""
    return {"kind": kind, "label": label, "group": group, "n": n}


def chart_key(prefix: str, label: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_") or "all"
    return f"{prefix}_{slug}"


def _clean(values) -> np.ndarray:
    x = np.asarray(values, dtype=float)
    return x[np.isfinite(x)]


def qq_points(values) -> list[dict]:
    """Normal Q-Q records {theoretical, sample}, sorted, as stats::qqnorm."""
    x = np.sort(_clean(values))
    n = len(x)
    if n == 0:
        return []
    a = 3 / 8 if n <= 10 else 0.5
    theo = stats.norm.ppf((np.arange(1, n + 1) - a) / (n + 1 - 2 * a))
    return [{"theoretical": float(t), "sample": float(s)} for t, s in zip(theo, x)]


def histogram(values) -> list[dict]:
    """Histogram records {bin_start, bin_end, count} with Sturges' number of bins."""
    x = _clean(values)
    if len(x) == 0:
        return []
    if np.ptp(x) == 0:
        return [{"bin_start": float(x[0]), "bin_end": float(x[0]), "count": int(len(x))}]
    counts, edges = np.histogram(x, bins="sturges")
    return [{"bin_start": float(edges[i]), "bin_end": float(edges[i + 1]), "count": int(c)}
            for i, c in enumerate(counts)]


def normality_charts(values, label: str, prefix: str = "") -> tuple[list[dict], dict]:
    key = chart_key(prefix + "qq" if not prefix else f"{prefix}_qq", label)
    hkey = chart_key(prefix + "hist" if not prefix else f"{prefix}_hist", label)
    refs = [{"chart_type": "qq", "title": f"Q-Q plot: {label}", "data_key": key},
            {"chart_type": "histogram", "title": f"Histogram: {label}", "data_key": hkey}]
    return refs, {key: qq_points(values), hkey: histogram(values)}


def _result(assumption, label, test_key, test_label, symbol, value, df, p, verdict, explanation, sc, refs):
    stat = None if value is None or not math.isfinite(value) else {"symbol": symbol, "value": float(value),
                                                                  "df": [float(d) for d in df]}
    return {"schema_version": 1, "assumption": assumption, "label": label,
            "test_used": {"key": test_key, "label": test_label}, "statistic": stat,
            "p": None if p is None or not math.isfinite(p) else float(min(max(p, 0.0), 1.0)),
            "verdict": verdict, "explanation": explanation, "applies_to": sc, "chart_refs": refs}


def _where(sc: dict) -> str:
    if sc["kind"] == "differences":
        return f"the differences ({sc['label']})"
    if sc["kind"] == "overall":
        return "the scores"
    return f"the {sc['label']} group"


def _normality_verdict(p: float, n: int, alpha: float, test_label: str, sc: dict) -> tuple[str, str]:
    where = _where(sc)
    ptxt = p_value(p)
    ptxt = f"p {ptxt}" if ptxt[0] in "<>" else f"p = {ptxt}"
    if p >= alpha:
        text = (f"The {test_label} test found no clear sign that {where} are far from a bell-shaped "
                f"(normal) curve ({ptxt}), so this assumption looks reasonable.")
        if n < SMALL_CHECK_N:
            text += (f" With only {n} scores this test can miss real problems, so also look at the Q-Q "
                     "plot: the dots should sit close to the line.")
        return "passed", text
    if n >= LARGE_N:
        return "caution", (
            f"The {test_label} test says {where} are not perfectly bell-shaped ({ptxt}). But with {n} "
            "scores, these tests flag even tiny, harmless differences. Look at the Q-Q plot: if the dots "
            "stay fairly close to the line, the test is still trustworthy, because with this many scores "
            "its results hold up well.")
    return "failed", (
        f"The {test_label} test suggests {where} are not bell-shaped ({ptxt}). With a sample this size "
        "that can affect the results. Check the histogram and Q-Q plot, and consider the rank-based "
        "(nonparametric) alternative.")


def _not_computable(assumption, label, test_key, test_label, symbol, sc, refs, reason) -> dict:
    return _result(assumption, label, test_key, test_label, symbol, None, [], None, "caution", reason, sc, refs)


def shapiro_wilk(values, sc: dict, alpha: float = 0.05, charts: bool = True,
                 chart_prefix: str = "") -> tuple[dict, dict]:
    """Shapiro-Wilk W (primary normality check). Matches stats::shapiro.test."""
    x = _clean(values)
    n = len(x)
    sc = {**sc, "n": n}
    refs, data = normality_charts(x, sc["label"], chart_prefix) if charts else ([], {})
    args = ("normality", "Normality", "shapiro_wilk", "Shapiro-Wilk", "W")
    if n < 3:
        return _not_computable(*args, sc, refs, f"Normality can't be checked with only {n} scores "
                               "(at least 3 are needed)."), data
    if np.ptp(x) == 0:
        return _not_computable(*args, sc, refs, f"Every score in {_where(sc)} is the same, so there is "
                               "no spread whose shape could be checked."), data
    if n > 5000:
        return _not_computable(*args, sc, refs, f"With {n} scores the Shapiro-Wilk test is not "
                               "reliable (it works up to 5,000). Use the Q-Q plot instead: with this "
                               "many scores, only a clearly curved pattern matters."), data
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        w, p = stats.shapiro(x)
    verdict, text = _normality_verdict(float(p), n, alpha, "Shapiro-Wilk", sc)
    return _result(*args, float(w), [], float(p), verdict, text, sc, refs), data


def lilliefors_p(d: float, n: int) -> float:
    """p-value of the Lilliefors statistic exactly as nortest::lillie.test (see module docstring)."""
    if n <= 100:
        kd, nd = d, n
    else:
        kd, nd = d * (n / 100) ** 0.49, 100
    p = math.exp(-7.01256 * kd ** 2 * (nd + 2.78019) + 2.99587 * kd * math.sqrt(nd + 2.78019)
                 - 0.122119 + 0.974598 / math.sqrt(nd) + 1.67997 / nd)
    if p > 0.1:
        kk = (math.sqrt(n) - 0.01 + 0.85 / math.sqrt(n)) * d
        if kk <= 0.302:
            p = 1.0
        elif kk <= 0.5:
            p = 2.76773 - 19.828315 * kk + 80.709644 * kk ** 2 - 138.55152 * kk ** 3 + 81.218052 * kk ** 4
        elif kk <= 0.9:
            p = -4.901232 + 40.662806 * kk - 97.490286 * kk ** 2 + 94.029866 * kk ** 3 - 32.355711 * kk ** 4
        elif kk <= 1.31:
            p = 6.198765 - 19.558097 * kk + 23.186922 * kk ** 2 - 12.234627 * kk ** 3 + 2.423045 * kk ** 4
        else:
            p = 0.0
    return p


def ks_lilliefors(values, sc: dict, alpha: float = 0.05, charts: bool = True,
                  chart_prefix: str = "") -> tuple[dict, dict]:
    """Kolmogorov-Smirnov with the Lilliefors correction. Matches nortest::lillie.test."""
    x = _clean(values)
    n = len(x)
    sc = {**sc, "n": n}
    refs, data = normality_charts(x, sc["label"], chart_prefix) if charts else ([], {})
    args = ("normality", "Normality", "ks_lilliefors", "Kolmogorov-Smirnov (Lilliefors)", "D")
    if n < 5:
        return _not_computable(*args, sc, refs, f"This check needs at least 5 scores; there are {n}."), data
    if np.ptp(x) == 0:
        return _not_computable(*args, sc, refs, f"Every score in {_where(sc)} is the same, so there is "
                               "no spread whose shape could be checked."), data
    d, _ = sm_lilliefors(x, dist="norm", pvalmethod="approx")
    p = lilliefors_p(float(d), n)
    verdict, text = _normality_verdict(p, n, alpha, "Kolmogorov-Smirnov (Lilliefors)", sc)
    return _result(*args, float(d), [], p, verdict, text, sc, refs), data


def levene_brown_forsythe(groups: dict[str, "np.ndarray"], sc: dict, alpha: float = 0.05,
                          failed_note: str = "") -> tuple[dict, dict]:
    """Equal spread across groups: Levene's test centred on the median (Brown-Forsythe).

    Matches car::leveneTest(y ~ g) (center = median). F with df = [k - 1, N - k].
    `failed_note` is appended when the check fails (e.g. why Welch's test is unaffected).
    """
    samples = [_clean(v) for v in groups.values()]
    n = int(sum(len(s) for s in samples))
    sc = {**sc, "n": n}
    args = ("homogeneity_of_variance", "Equal spread (homogeneity of variance)", "levene_brown_forsythe",
            "Levene's test (Brown-Forsythe)", "F")
    if len(samples) < 2 or any(len(s) < 2 for s in samples):
        return _not_computable(*args, sc, [], "Each group needs at least 2 scores to compare spread."), {}
    with warnings.catch_warnings(), np.errstate(all="ignore"):
        warnings.simplefilter("ignore")
        f, p = stats.levene(*samples, center="median")
    if not (math.isfinite(f) and math.isfinite(p)):
        return _not_computable(*args, sc, [], "Every group's scores are identical, so spread can't be "
                               "compared."), {}
    df = [len(samples) - 1, n - len(samples)]
    ptxt = p_value(p)
    ptxt = f"p {ptxt}" if ptxt[0] in "<>" else f"p = {ptxt}"
    if p >= alpha:
        verdict = "passed"
        text = f"The groups' scores are spread out by similar amounts ({ptxt}), so this assumption looks reasonable."
    else:
        verdict = "failed"
        text = f"The groups' scores are spread out by different amounts ({ptxt})."
        if failed_note:
            text += " " + failed_note
    return _result(*args, float(f), df, float(p), verdict, text, sc, []), {}
