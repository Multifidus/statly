"""Power analysis (SPEC §8, §11.2): a priori sample size and sensitivity analyses. Dataset-free.

Registered with ``needs_data=False`` and no variable roles: ``fn(None, request, None)``.

Modes (``options.mode``):
- ``a_priori`` (default): effect size, alpha, power -> required n (exact root, then rounded up).
- ``sensitivity``: n, alpha, power -> smallest detectable effect.
Post hoc ("observed") power is deliberately not offered; see stats/README.md.

References (fixtures/r/power.R): t tests = ``pwr.t.test`` / ``pwr.t2n.test`` (noncentral t); one-way
ANOVA = ``pwr.anova.test``; correlation = ``pwr.r.test`` (pwr's Fisher-z approximation); chi-square =
``pwr.chisq.test``; regression = ``pwr.f2.test`` (lambda = f2 (u + v + 1)). Repeated-measures designs
use G*Power 3's univariate formulas (Faul et al., 2007, Table 3):
  within:       lambda = f2 N m eps / (1 - rho),        df = (m-1)eps, (N-k)(m-1)eps
  between:      lambda = f2 N m / (1 + (m-1) rho),      df = k-1, N-k
  interaction:  lambda = f2 N m eps / (1 - rho),        df = (k-1)(m-1)eps, (N-k)(m-1)eps
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable

import numpy as np
from scipy import optimize, stats

from statly_engine.errors import InvalidParams
from statly_engine.stats import apa
from statly_engine.stats.apa import Rich
from statly_engine.stats.core import FIELD_NORMS, ResultBuilder, magnitude, warning
from statly_engine.stats.effect_sizes import Estimate
from statly_engine.stats.registry import register

MODES = ("a_priori", "sensitivity")
POST_HOC_MESSAGE = (
    "Statly doesn't calculate post hoc (\"observed\") power. It is just a restatement of the p-value, so it "
    "can't tell you whether a non-significant result means there was no effect or too few people. Run a "
    "sensitivity analysis instead: give your sample size and Statly shows the smallest effect your study "
    "could reliably detect.")
N_MAX = 1e7

# Conventional effect sizes (Cohen, 1988), as pwr::cohen.ES.
CONVENTIONS = {
    "d": {"small": 0.2, "medium": 0.5, "large": 0.8},
    "f": {"small": 0.1, "medium": 0.25, "large": 0.4},
    "r": {"small": 0.1, "medium": 0.3, "large": 0.5},
    "w": {"small": 0.1, "medium": 0.3, "large": 0.5},
    "f2": {"small": 0.02, "medium": 0.15, "large": 0.35},
}
# core.BENCHMARKS family used for the interpretation (w shares r's cut-offs .1/.3/.5).
FAMILY = {"d": "d", "f": "cohens_f", "r": "r", "w": "r", "f2": "f_sq"}

COMMON_OPTIONS = {
    "mode": "a_priori (default): effect size -> sample size; sensitivity: sample size -> detectable effect",
    "effect_size": "planned effect (number) or 'small' / 'medium' / 'large' (Cohen, 1988); a_priori only",
    "power": "target power, default 0.80",
    "n": "sensitivity only: planned sample size (see each analysis for per-group vs total)",
    "unit": "what the sample consists of, for the summary (default 'participants')",
}


# ---------------------------------------------------------------------------
# Problem description: one power function of (n, effect) plus how to present it
# ---------------------------------------------------------------------------
@dataclass
class Problem:
    power: Callable[[float, float], float]     # (n, effect) -> power; n continuous
    n_lo: float                                # smallest n the formula accepts (exclusive-ish)
    effect_lo: float
    effect_hi: float
    es: str                                    # d | f | r | w | f2
    es_key: str
    es_label: str
    es_symbol: str
    n_meaning: str                             # "per group", "pairs", "in total", ...
    test_name: str                             # "independent-samples t test"
    to_int: Callable[[float], int]             # exact n -> planned integer n (rounded up)
    total: Callable[[int], int]                # planned n -> total N
    details: Callable[[float, float], dict]    # (n, effect) -> {critical, crit_df, ncp}
    n_step: int = 1                            # grid step for the power curve (RM: multiples of k)
    sign: float = 1.0                          # -1 for 'less' (effect reported negative)
    n_label: str = "n"
    planned_power: Callable[[int, float], float] | None = None    # at integer planned n (integer n2)
    planned_details: Callable[[int, float], dict] | None = None

    def power_at(self, n: int, effect: float) -> float:
        return (self.planned_power or self.power)(n, effect)

    def details_at(self, n: int, effect: float) -> dict:
        return (self.planned_details or self.details)(n, effect)


def _ceil(x: float) -> int:
    return int(math.ceil(x - 1e-9))


def _solve(fn: Callable[[float], float], target: float, lo: float, hi: float) -> float:
    """Root of fn(x) = target for increasing fn on [lo, hi] (Brent, xtol 1e-11)."""
    if fn(lo) - target >= 0:
        return lo
    b = max(2 * lo, lo + 8)                  # expand the bracket geometrically: keeps evaluations near the root
    while b < hi and not fn(b) - target >= 0:
        lo, b = b, 2 * b
    hi = min(b, hi)
    if not fn(hi) - target >= 0:
        raise InvalidParams("That power can't be reached within a realistic sample size or effect size. "
                            "Try a larger effect or a lower target power.")
    return optimize.brentq(lambda x: fn(x) - target, lo, hi, xtol=1e-11, rtol=4 * np.finfo(float).eps,
                           maxiter=1000)


# ---- distributions (match R's pt/pf/pchisq with ncp) ----
def _t_power(nu: float, ncp: float, alpha: float, tails: str) -> float:
    if tails == "two_sided":
        q = stats.t.isf(alpha / 2, nu)
        up, down = float(stats.nct.sf(q, nu, ncp)), float(stats.nct.cdf(-q, nu, ncp))
        # scipy returns NaN for the far (opposite-direction) tail when it is ~0 at large nu.
        return (0.0 if math.isnan(up) else up) + (0.0 if math.isnan(down) else down)
    if tails == "greater":
        return float(stats.nct.sf(stats.t.isf(alpha, nu), nu, ncp))
    return float(stats.nct.cdf(stats.t.ppf(alpha, nu), nu, ncp))


def _t_crit(nu: float, alpha: float, tails: str) -> float:
    if tails == "two_sided":
        return float(stats.t.isf(alpha / 2, nu))
    return float(stats.t.isf(alpha, nu)) if tails == "greater" else float(stats.t.ppf(alpha, nu))


def _f_power(df1: float, df2: float, lam: float, alpha: float) -> float:
    return float(stats.ncf.sf(stats.f.isf(alpha, df1, df2), df1, df2, lam))


def _chi_power(df: float, lam: float, alpha: float) -> float:
    return float(stats.ncx2.sf(stats.chi2.isf(alpha, df), df, lam))


def _r_power(n: float, r: float, alpha: float, tails: str) -> float:
    """pwr.r.test (arctanh approximation with the r / (2(n-1)) bias term)."""
    if tails == "less":
        r = -r
    if tails == "two_sided":
        r = abs(r)
        ttt = stats.t.isf(alpha / 2, n - 2)
    else:
        ttt = stats.t.isf(alpha, n - 2)
    rc = math.sqrt(ttt ** 2 / (ttt ** 2 + n - 2))
    zr = math.atanh(r) + r / (2 * (n - 1))
    zrc = math.atanh(rc)
    p = stats.norm.cdf((zr - zrc) * math.sqrt(n - 3))
    if tails == "two_sided":
        p += stats.norm.cdf((-zr - zrc) * math.sqrt(n - 3))
    return float(p)


def _r_crit(n: float, alpha: float, tails: str) -> float:
    ttt = stats.t.isf(alpha / 2 if tails == "two_sided" else alpha, n - 2)
    rc = math.sqrt(ttt ** 2 / (ttt ** 2 + n - 2))
    return -rc if tails == "less" else rc


# ---------------------------------------------------------------------------
# Option parsing
# ---------------------------------------------------------------------------
def _num_opt(opts: dict, name: str, default=None, *, lo=None, hi=None, lo_open=False, hi_open=False,
             integer=False, what: str | None = None):
    v = opts.get(name, default)
    if v is None:
        return None
    what = what or name.replace("_", " ")
    try:
        x = float(v)
    except (TypeError, ValueError):
        raise InvalidParams(f"The {what} must be a number.", option=name) from None
    if not math.isfinite(x):
        raise InvalidParams(f"The {what} must be a finite number.", option=name)
    if integer and abs(x - round(x)) > 1e-9:
        raise InvalidParams(f"The {what} must be a whole number.", option=name)
    if lo is not None and (x < lo or (lo_open and x == lo)):
        raise InvalidParams(f"The {what} must be {'above' if lo_open else 'at least'} {lo:g}.", option=name)
    if hi is not None and (x > hi or (hi_open and x == hi)):
        raise InvalidParams(f"The {what} must be {'below' if hi_open else 'at most'} {hi:g}.", option=name)
    return int(round(x)) if integer else x


def _choice(opts: dict, name: str, choices: tuple, default: str) -> str:
    v = opts.get(name, default)
    if v not in choices:
        raise InvalidParams(f"Option '{name}' must be one of: {', '.join(choices)}.", option=name)
    return v


@dataclass
class Common:
    mode: str
    alpha: float
    power: float
    tails: str
    unit: str
    effect: float | None       # signed as supplied / resolved (a_priori)
    effect_label: str | None   # 'medium' when given as a label
    n: float | None            # sensitivity n


def _common(request, es: str, *, one_sided_ok: bool) -> Common:
    opts = request.options or {}
    mode = opts.get("mode", "a_priori")
    if mode in ("post_hoc", "posthoc", "observed"):
        raise InvalidParams(POST_HOC_MESSAGE, option="mode")
    if mode not in MODES:
        raise InvalidParams("Option 'mode' must be 'a_priori' (find the sample size) or 'sensitivity' (find the "
                            "smallest detectable effect).", option="mode")
    tails = request.tails
    if not one_sided_ok and tails != "two_sided":
        raise InvalidParams("This test has no one-sided version (F and chi-square tests are always "
                            "non-directional); choose a two-sided test.", option="tails")
    alpha = float(request.alpha)
    power = _num_opt(opts, "power", 0.80, lo=0, hi=1, lo_open=True, hi_open=True, what="target power")
    if power <= alpha:
        raise InvalidParams("The target power must be larger than alpha (the significance level).", option="power")
    unit = str(opts.get("unit") or "participants")
    effect, label = None, None
    if mode == "a_priori":
        raw = opts.get("effect_size")
        if raw is None:
            raise InvalidParams("Enter the effect size you expect, or choose small, medium or large.",
                                option="effect_size")
        if isinstance(raw, str) and raw.lower() in CONVENTIONS[es]:
            label = raw.lower()
            effect = CONVENTIONS[es][label] * (-1.0 if (tails == "less" and es in ("d", "r")) else 1.0)
        else:
            effect = _num_opt(opts, "effect_size", what="effect size")
            if es in ("f", "w", "f2") and effect <= 0:
                raise InvalidParams("The effect size must be above 0.", option="effect_size")
            if es == "r" and not (-1 < effect < 1):
                raise InvalidParams("A correlation effect size must be between -1 and 1.", option="effect_size")
            if effect == 0:
                raise InvalidParams("An effect size of 0 can't be detected; enter the smallest effect that would "
                                    "matter.", option="effect_size")
            if tails == "greater" and effect < 0 or tails == "less" and effect > 0:
                raise InvalidParams("A one-sided test only detects effects in the stated direction, but the "
                                    "effect size points the other way. Flip its sign or the test direction.",
                                    option="effect_size")
    return Common(mode, alpha, power, tails, unit, effect, label, None)


# ---------------------------------------------------------------------------
# Per-analysis problems
# ---------------------------------------------------------------------------
def _t_problem(request, c: Common) -> tuple[Problem, dict]:
    opts = request.options or {}
    design = _choice(opts, "design", ("independent", "paired", "one_sample"), "independent")
    tails, alpha = c.tails, c.alpha
    sign = -1.0 if tails == "less" else 1.0
    inputs = {"design": design}
    if design == "independent":
        ratio = _num_opt(opts, "allocation_ratio", 1.0, lo=0, lo_open=True, what="allocation ratio (n2 / n1)")
        n2_fixed = None
        if c.mode == "sensitivity" and opts.get("n2") is not None:
            n2_fixed = _num_opt(opts, "n2", lo=2, integer=True, what="second group's size")
        inputs["allocation_ratio"] = ratio

        def n2_of(n1: float) -> float:
            return n2_fixed if n2_fixed is not None else ratio * n1

        def pw(n1, d):
            n2 = n2_of(n1)
            return _t_power(n1 + n2 - 2, d / math.sqrt(1 / n1 + 1 / n2), alpha, tails)

        def details(n1, d):
            n2 = n2_of(n1)
            nu = n1 + n2 - 2
            return {"critical": _t_crit(nu, alpha, tails), "crit_df": [nu], "ncp": d / math.sqrt(1 / n1 + 1 / n2),
                    "crit_symbol": "t"}
        equal = n2_fixed is None and abs(ratio - 1) < 1e-12
        prob = Problem(pw, max(2.0, 2.0 / ratio) + 1e-10 if n2_fixed is None else 2 + 1e-10, 1e-7, 50.0, "d",
                       "cohens_d", "Cohen's d", "d", "per group" if equal else "in group 1",
                       "independent-samples t test", _ceil,
                       (lambda n1: 2 * n1) if equal else (lambda n1: n1 + (n2_fixed or _ceil(ratio * n1))),
                       details, sign=sign)
        prob.n2_of = (lambda n1: n2_fixed) if n2_fixed is not None else (lambda n1: _ceil(ratio * n1))  # type: ignore[attr-defined]
        if n2_fixed is None:      # planned groups are whole people: n2 = ceiling(ratio x n1)
            def pw_int(n1, d):
                n2 = prob.n2_of(n1)
                return _t_power(n1 + n2 - 2, d / math.sqrt(1 / n1 + 1 / n2), alpha, tails)

            def details_int(n1, d):
                n2 = prob.n2_of(n1)
                nu = n1 + n2 - 2
                return {"critical": _t_crit(nu, alpha, tails), "crit_df": [nu],
                        "ncp": d / math.sqrt(1 / n1 + 1 / n2), "crit_symbol": "t"}
            prob.planned_power, prob.planned_details = pw_int, details_int
        return prob, inputs

    def pw1(n, d):
        return _t_power(n - 1, d * math.sqrt(n), alpha, tails)

    def details1(n, d):
        return {"critical": _t_crit(n - 1, alpha, tails), "crit_df": [n - 1], "ncp": d * math.sqrt(n),
                "crit_symbol": "t"}
    if design == "paired":
        return Problem(pw1, 2 + 1e-10, 1e-7, 50.0, "d", "d_z", "Cohen's d_z", "d_z", "pairs",
                       "paired-samples t test", _ceil, lambda n: n, details1, sign=sign), inputs
    return Problem(pw1, 2 + 1e-10, 1e-7, 50.0, "d", "cohens_d", "Cohen's d", "d", "in total",
                   "one-sample t test", _ceil, lambda n: n, details1, sign=sign), inputs


ANOVA_DESIGNS = ("one_way", "rm_within", "rm_between", "mixed_interaction")


def _anova_problem(request, c: Common) -> tuple[Problem, dict]:
    opts = request.options or {}
    design = _choice(opts, "design", ANOVA_DESIGNS, "one_way")
    alpha = c.alpha
    if design == "one_way":
        k = _num_opt(opts, "groups", 3, lo=2, integer=True, what="number of groups")

        def pw(n, f):
            return _f_power(k - 1, (n - 1) * k, k * n * f * f, alpha)

        def details(n, f):
            return {"critical": float(stats.f.isf(alpha, k - 1, (n - 1) * k)), "crit_df": [k - 1, (n - 1) * k],
                    "ncp": k * n * f * f, "crit_symbol": "F"}
        return Problem(pw, 2 + 1e-10, 1e-7, 50.0, "f", "cohens_f", "Cohen's f", "f", "per group",
                       f"one-way ANOVA with {k} groups", _ceil, lambda n: k * n, details), {"design": design,
                                                                                            "groups": k}

    k_default = 1 if design == "rm_within" else 2
    k = _num_opt(opts, "groups", k_default, lo=1 if design == "rm_within" else 2, integer=True,
                 what="number of groups")
    m = _num_opt(opts, "measurements", 3, lo=2, integer=True, what="number of measurements")
    rho = _num_opt(opts, "correlation", 0.5, lo=-1 / (m - 1), hi=1, lo_open=True, hi_open=True,
                   what="correlation among repeated measures")
    eps = _num_opt(opts, "epsilon", 1.0, lo=1 / (m - 1), hi=1, what="nonsphericity correction (epsilon)")
    if design == "rm_between":
        eps = 1.0

        def parts(n, f):
            return k - 1, n - k, f * f * n * m / (1 + (m - 1) * rho)
        name = f"repeated-measures ANOVA, between-subjects effect ({k} groups, {m} measurements)"
    elif design == "rm_within":
        def parts(n, f):
            return (m - 1) * eps, (n - k) * (m - 1) * eps, f * f * n * m * eps / (1 - rho)
        name = f"repeated-measures ANOVA, within-subjects effect ({m} measurements" + (
            f", {k} groups)" if k > 1 else ")")
    else:
        def parts(n, f):
            return (k - 1) * (m - 1) * eps, (n - k) * (m - 1) * eps, f * f * n * m * eps / (1 - rho)
        name = f"mixed ANOVA, group × time interaction ({k} groups, {m} measurements)"

    def pw(n, f):
        d1, d2, lam = parts(n, f)
        return _f_power(d1, d2, lam, alpha)

    def details(n, f):
        d1, d2, lam = parts(n, f)
        return {"critical": float(stats.f.isf(alpha, d1, d2)), "crit_df": [d1, d2], "ncp": lam, "crit_symbol": "F"}

    def to_int(n_exact):
        n = _ceil(n_exact)
        return int(math.ceil(n / k) * k)      # equal group sizes
    prob = Problem(pw, k + 1.0, 1e-7, 50.0, "f", "cohens_f", "Cohen's f", "f", "in total", name, to_int,
                   lambda n: n, details, n_step=k, n_label="N")
    return prob, {"design": design, "groups": k, "measurements": m, "correlation": rho, "epsilon": eps}


def _r_problem(request, c: Common) -> tuple[Problem, dict]:
    alpha, tails = c.alpha, c.tails

    def details(n, r):
        return {"critical": _r_crit(n, alpha, tails), "crit_df": [n - 2], "ncp": None, "crit_symbol": "r"}
    return Problem(lambda n, r: _r_power(n, r, alpha, tails), 4 + 1e-10, 1e-10, 1 - 1e-10, "r", "r",
                   "Pearson's r", "r", "in total", "test of a Pearson correlation", _ceil, lambda n: n, details,
                   sign=-1.0 if tails == "less" else 1.0, n_label="N"), {}


def _chi_problem(request, c: Common) -> tuple[Problem, dict]:
    opts = request.options or {}
    df = _num_opt(opts, "df", None, lo=1, integer=True, what="degrees of freedom")
    if df is None:
        rows = _num_opt(opts, "rows", None, lo=2, integer=True, what="number of rows")
        cols = _num_opt(opts, "columns", None, lo=2, integer=True, what="number of columns")
        cats = _num_opt(opts, "categories", None, lo=2, integer=True, what="number of categories")
        if rows is not None and cols is not None:
            df = (rows - 1) * (cols - 1)
        elif cats is not None:
            df = cats - 1
        else:
            raise InvalidParams("Give the degrees of freedom ('df'), the table size ('rows' and 'columns'), or "
                                "the number of 'categories' for a goodness-of-fit test.", option="df")
    alpha = c.alpha

    def details(n, w):
        return {"critical": float(stats.chi2.isf(alpha, df)), "crit_df": [df], "ncp": n * w * w,
                "crit_symbol": "χ²"}
    return Problem(lambda n, w: _chi_power(df, n * w * w, alpha), 1 + 1e-10, 1e-7, 50.0, "w", "cohens_w",
                   "Cohen's w", "w", "in total", f"chi-square test with {df} df", _ceil, lambda n: n, details,
                   n_label="N"), {"df": df}


def _reg_problem(request, c: Common) -> tuple[Problem, dict]:
    opts = request.options or {}
    p = _num_opt(opts, "predictors", 1, lo=1, integer=True, what="number of predictors")
    q = _num_opt(opts, "tested_predictors", p, lo=1, hi=p, integer=True, what="number of tested predictors")
    alpha = c.alpha

    # n is the total N; v = N - p - 1 (continuous for the root).
    def pw(n, f2):
        v = n - p - 1
        return _f_power(q, v, f2 * (q + v + 1), alpha)

    def details(n, f2):
        v = n - p - 1
        return {"critical": float(stats.f.isf(alpha, q, v)), "crit_df": [q, v], "ncp": f2 * (q + v + 1),
                "crit_symbol": "F"}
    name = (f"multiple regression, R² with {p} predictor{'s' if p > 1 else ''}" if q == p else
            f"hierarchical regression, R² change for {q} of {p} predictors")
    return Problem(pw, p + 2 + 1e-10, 1e-7, 1e3, "f2", "cohens_f2", "Cohen's f²", "f²", "in total", name,
                   _ceil, lambda n: n, details, n_label="N"), {"predictors": p, "tested_predictors": q}


# ---------------------------------------------------------------------------
# Shared driver
# ---------------------------------------------------------------------------
def _n_for(prob: Problem, effect: float, target: float) -> float:
    return _solve(lambda n: prob.power(n, effect), target, prob.n_lo, N_MAX)


def _planned_n(prob: Problem, n_exact: float, effect: float, target: float) -> int:
    n = max(prob.to_int(n_exact), prob.to_int(prob.n_lo))
    while prob.power_at(n, effect) < target:          # guard against root tolerance at an integer
        n = prob.to_int(n + 1)
    return n


def _effect_for(prob: Problem, n: float, target: float) -> float:
    mag = _solve(lambda e: prob.power(n, prob.sign * e), target, prob.effect_lo, prob.effect_hi)
    return prob.sign * mag


def _sym_rich(sym: str) -> Rich:
    """APA symbol runs: d_z with subscript, f² with superscript, others italic."""
    if sym == "d_z":
        return Rich().i("d").sub("z", italic=True)
    if sym == "f²":
        return Rich().i("f").sup("2")
    return Rich().i(sym)


def _fmt_es(prob: Problem, v: float) -> str:
    return apa.no_zero(v, 2) if prob.es == "r" else apa.num(v, 2)


def _curve(prob: Problem, centre: int, effects: dict[str, float], target: float) -> list[dict]:
    step = prob.n_step
    lo = max(prob.to_int(prob.n_lo), step)
    hi = max(2 * centre, centre + 10 * step)
    grid = sorted({int(math.ceil(x / step) * step) for x in np.linspace(lo, hi, 40)} | {centre})
    out = []
    for series, e in effects.items():
        for n in grid:
            if n <= prob.n_lo:
                continue
            out.append({"series": series, "effect": float(e), "n": int(n), "n_total": int(prob.total(n)),
                        "power": float(prob.power_at(n, e)), "target_power": float(target)})
    return out


def _run(request, prob: Problem, c: Common, extra_inputs: dict, analysis_label: str) -> dict:
    b = ResultBuilder(request)
    tails_txt = {"two_sided": "two-sided", "greater": "one-sided (greater)", "less": "one-sided (less)"}[c.tails]
    sided = prob.es in ("d", "r")                 # F and chi-square tests have no sides
    lead = f"{tails_txt} " if sided else ""
    sym = prob.es_symbol
    rsym = _sym_rich(sym)
    alpha_txt = apa.no_zero(c.alpha, 2 if round(c.alpha, 2) == c.alpha else 3)
    pct = f"{c.power * 100:g}%"
    a_pct = ("an " if pct.startswith("8") or pct[:2] in ("11", "18") else "a ") + pct
    per = "" if prob.n_meaning == "in total" else f" {prob.n_meaning}"

    if c.mode == "a_priori":
        effect = c.effect
        n_exact = _n_for(prob, effect, c.power)
        n_req = _planned_n(prob, n_exact, effect, c.power)
        achieved = prob.power_at(n_req, effect)
        det = prob.details_at(n_req, effect)
        total = prob.total(n_req)
        b.statistic("n_required", f"Required sample size ({prob.n_meaning}, rounded up)", prob.n_label, n_req)
        b.statistic("n_exact", "Exact solution before rounding", prob.n_label, n_exact)
        b.statistic("n_total", "Total sample size", "N", total)
        if hasattr(prob, "n2_of"):
            b.statistic("n2_required", "Required size of group 2", "n", prob.n2_of(n_req))
        b.statistic("achieved_power", "Power at the planned sample size", "1 − β", achieved)
        b.effect(prob.es_key, prob.es_label, sym, Estimate(effect, None, None, request.ci_level),
                 family=FAMILY[prob.es], what="effect")
        size = f"{c.effect_label} effect ({sym} = {_fmt_es(prob, effect)})" if c.effect_label else (
            f"effect of {sym} = {_fmt_es(prob, effect)}")
        size = ("an " if size.startswith("effect") else "a ") + size
        if hasattr(prob, "n2_of") and prob.n_meaning != "per group":
            n_phrase = f"{n_req} {c.unit} in group 1 and {prob.n2_of(n_req)} in group 2 ({total} in total)"
        elif prob.n_meaning == "per group":
            n_phrase = f"{n_req} {c.unit} per group ({total} in total)"
        elif prob.n_meaning == "pairs":
            n_phrase = f"{n_req} {c.unit} measured twice (matched pairs)"
        else:
            n_phrase = f"{n_req} {c.unit} in total" + (
                f" ({n_req // prob.n_step} per group)" if prob.n_step > 1 else "")
        summary = (f"To have {a_pct} chance of detecting {size} with a {lead}{prob.test_name} at "
                   f"α = {alpha_txt}, you need about {n_phrase}. Plan to recruit more if you expect people to "
                   "drop out or skip questions.")
        r = (Rich().t(f"An a priori power analysis ({lead}{prob.test_name}, ").extend(rsym)
             .t(f" = {_fmt_es(prob, effect)}, ").i("α").t(f" = {alpha_txt}, power = {apa.no_zero(c.power, 2)}) "
                                                         "indicated a required sample size of ")
             .i("n" if per else "N").t(f" = {n_req}{per}"))
        if per:
            r.t(" (").i("N").t(f" = {total})")
        r.t(f"; achieved power = {apa.no_zero(achieved, 3)}.")
        centre, curve_effect = n_req, effect
        if total > 1000:
            b.warn(warning("large_sample_required", "caution",
                           f"This design needs {total} {c.unit}, which is a lot. A larger expected effect, a "
                           "more reliable measure, or a within-person design can lower the number needed."))
    else:
        opts = request.options or {}
        n = _num_opt(opts, "n", None, lo=math.ceil(prob.n_lo), integer=True,
                     what=f"sample size ({prob.n_meaning})")
        if n is None:
            raise InvalidParams("A sensitivity analysis needs the planned sample size ('n').", option="n")
        if prob.n_step > 1 and n % prob.n_step:
            raise InvalidParams(f"The total sample size must split equally into {prob.n_step} groups.", option="n")
        effect = _effect_for(prob, n, c.power)
        det = prob.details(n, effect)
        total = prob.total(n)
        b.statistic("detectable_effect", f"Smallest detectable {prob.es_label}", sym, effect)
        b.statistic("power", "Target power", "1 − β", c.power)
        b.statistic("n_total", "Total sample size", "N", total)
        b.effect(prob.es_key, prob.es_label, sym, Estimate(effect, None, None, request.ci_level),
                 family=FAMILY[prob.es], what="effect")
        mag = magnitude(effect, FAMILY[prob.es])
        mag_txt = {"negligible": "very small", "medium": "medium-sized"}.get(mag, mag)
        if hasattr(prob, "n2_of") and prob.n_meaning != "per group":
            n_phrase = f"{n} {c.unit} in group 1 and {prob.n2_of(n)} in group 2"
        else:
            n_phrase = (f"{n} pairs of scores (each person measured twice)" if prob.n_meaning == "pairs" else
                        f"{n} {c.unit}" + ("" if not per else f" {prob.n_meaning}"))
        cmp_word = "or larger" if effect > 0 else "or stronger"
        summary = (f"With {n_phrase}, a {lead}{prob.test_name} at α = {alpha_txt} has {a_pct} chance of "
                   f"detecting an effect of {sym} = {_fmt_es(prob, effect)} {cmp_word} (a {mag_txt} effect by "
                   "common benchmarks). Smaller true effects would often be missed.")
        r = (Rich().t("A sensitivity power analysis indicated that with ").i("n" if per else "N")
             .t(f" = {n}{per}, a {lead}{prob.test_name} at ").i("α")
             .t(f" = {alpha_txt} has {pct} power to detect effects of ").extend(rsym)
             .t(f" {'≥' if effect > 0 else '≤'} {_fmt_es(prob, effect)}."))
        centre, curve_effect = n, effect

    b.statistic("critical_value", f"Critical {det['crit_symbol']}", det["crit_symbol"], det["critical"],
                det["crit_df"])
    if det["ncp"] is not None:
        b.statistic("ncp", "Noncentrality parameter", "λ" if det["crit_symbol"] != "t" else "δ", det["ncp"])
    b.summary(summary).sentence(r)

    # Power curve (power vs n) for the planned/detected effect and the conventional benchmarks.
    conv = CONVENTIONS[prob.es]
    series = {"planned": curve_effect} | {k: prob.sign * v for k, v in conv.items()}
    b.chart("power_curve", _curve(prob, centre, series, c.power))

    # APA table + benchmark table + inputs table.
    cols = [apa.column("test", "Test", "left"), apa.column("es", _sym_rich(sym)),
            apa.column("alpha", Rich().i("α")), apa.column("power", "Power"),
            apa.column("n", Rich().i(prob.n_label).t(f" ({prob.n_meaning})") if per else Rich().i("N")),
            apa.column("total", Rich().i("N"))]
    row = apa.row([apa.cell_text(prob.test_name), apa.cell_num(effect, 2, bounded=prob.es == "r"),
                   apa.cell_num(c.alpha, 3, bounded=True),
                   apa.cell_num(c.power if c.mode == "sensitivity" else achieved, 3, bounded=True),
                   apa.cell_int(centre), apa.cell_int(total)])
    note = Rich().t(f"{'A priori' if c.mode == 'a_priori' else 'Sensitivity'} analysis{', ' + tails_txt if sided else ''}. Power in "
                    f"the table is {'the target' if c.mode == 'sensitivity' else 'achieved at the planned n'}. "
                    + analysis_label)
    b.table(apa.table("Power Analysis", cols, [row], general_note=note))

    bcols = [apa.column("size", "Benchmark", "left"), apa.column("value", _sym_rich(sym))]
    brows = []
    for lbl, v in conv.items():
        cells = [apa.cell_text(lbl.capitalize()), apa.cell_num(prob.sign * v, 2, bounded=prob.es == "r")]
        if c.mode == "a_priori":
            try:
                nb = _planned_n(prob, _n_for(prob, prob.sign * v, c.power), prob.sign * v, c.power)
                cells.append(apa.cell_int(nb))
            except InvalidParams:
                cells.append(apa.cell_empty())
        brows.append(apa.row(cells))
    if c.mode == "a_priori":
        bcols.append(apa.column("n", Rich().t(f"Required {prob.n_label}" + (f" ({prob.n_meaning})" if per else ""))))
    b.extra_table(apa.table("Conventional Effect-Size Benchmarks", bcols, brows, number=None,
                            general_note=f"Benchmarks from Cohen (1988). {FIELD_NORMS}"))

    rows = [("Mode", c.mode.replace("_", " ")), ("Test", prob.test_name), ("Tails", tails_txt if sided else "not applicable (F / chi-square)"),
            ("Alpha", f"{c.alpha:g}"), ("Target power", f"{c.power:g}")]
    if c.mode == "a_priori":
        rows.append(("Effect size", f"{sym} = {c.effect:g}" + (f" ({c.effect_label})" if c.effect_label else "")))
    else:
        rows.append(("Sample size", f"{centre} ({prob.n_meaning})"))
    rows += [(k.replace("_", " ").capitalize(), f"{v:g}" if isinstance(v, float) else str(v))
             for k, v in extra_inputs.items()]
    b.extra_table(apa.table("Power Analysis Inputs", [apa.column("k", "Input", "left"), apa.column("v", "Value", "left")],
                            [apa.row([apa.cell_text(k), apa.cell_text(v)]) for k, v in rows], number=None))

    if c.tails != "two_sided":
        b.warn(warning("one_sided_test", "info",
                       "A one-sided test needs fewer people but can only detect an effect in the direction you "
                       "predicted. Decide this before collecting data."))
    b.inputs(0, 0, [])
    return b.build()


def _approx_warning(b_msg: str) -> dict:
    return warning("approximation", "info", b_msg)


# ---------------------------------------------------------------------------
# Registered analyses
# ---------------------------------------------------------------------------
def _register(analysis_id: str, label: str, options: dict):
    return register(analysis_id, label=label, roles=[], options=COMMON_OPTIONS | options, needs_data=False)


@_register("power.t_test", "Power analysis: t test", {
    "design": "independent (default) | paired (effect d_z) | one_sample",
    "allocation_ratio": "independent only: n2 / n1 (default 1)",
    "n2": "independent sensitivity only: size of group 2 (default n × allocation_ratio, rounded up)"})
def t_test(df, request, meta=None) -> dict:
    c = _common(request, "d", one_sided_ok=True)
    prob, extra = _t_problem(request, c)
    return _run(request, prob, c, extra, "Noncentral t distribution (as R pwr.t.test / pwr.t2n.test).")


@_register("power.anova", "Power analysis: ANOVA", {
    "design": "one_way (default) | rm_within | rm_between | mixed_interaction",
    "groups": "number of groups k (one_way default 3; RM designs: between-subjects groups)",
    "measurements": "RM designs: number of repeated measurements m (default 3)",
    "correlation": "RM designs: correlation among repeated measures (default 0.5)",
    "epsilon": "rm_within / mixed_interaction: nonsphericity correction, 1/(m-1) to 1 (default 1)"})
def anova(df, request, meta=None) -> dict:
    c = _common(request, "f", one_sided_ok=False)
    prob, extra = _anova_problem(request, c)
    if extra["design"] == "one_way":
        return _run(request, prob, c, extra, "Noncentral F distribution (as R pwr.anova.test); n is per group.")
    res_note = ("Repeated-measures power uses G*Power 3's univariate approach (Faul et al., 2007): Cohen's f "
                "for the tested effect, one common correlation among the repeated measures, and epsilon to "
                "allow for nonsphericity. N is the total sample, split equally across groups.")
    out = _run(request, prob, c, extra, res_note)
    out["warnings"].append(_approx_warning(
        "This is an approximation. It assumes every pair of measurements is correlated about "
        f"{extra['correlation']:g} and that the spread is similar at every time point"
        + ("" if extra["design"] == "rm_between" else f" (epsilon = {extra['epsilon']:g})")
        + ". If those guesses are off, the real power can be noticeably higher or lower."))
    return out


@_register("power.correlation", "Power analysis: correlation", {})
def correlation(df, request, meta=None) -> dict:
    c = _common(request, "r", one_sided_ok=True)
    prob, extra = _r_problem(request, c)
    out = _run(request, prob, c, extra, "Fisher z approximation (as R pwr.r.test).")
    out["warnings"].append(_approx_warning(
        "Power for a correlation uses the Fisher z approximation (as R's pwr package). G*Power's exact method "
        "can give a sample size that differs by one or two people."))
    return out


@_register("power.chi_square", "Power analysis: chi-square test", {
    "df": "degrees of freedom; or give rows + columns (independence) or categories (goodness of fit)",
    "rows": "number of rows of the crosstab", "columns": "number of columns of the crosstab",
    "categories": "goodness of fit: number of categories"})
def chi_square(df, request, meta=None) -> dict:
    c = _common(request, "w", one_sided_ok=False)
    prob, extra = _chi_problem(request, c)
    return _run(request, prob, c, extra, "Noncentral chi-square distribution (as R pwr.chisq.test).")


@_register("power.regression", "Power analysis: multiple regression", {
    "predictors": "total number of predictors p in the (full) model (default 1)",
    "tested_predictors": "number of predictors whose R² change is tested (default = predictors: test of R²)",
    "effect_size": "Cohen's f² = R² / (1 − R²), or ΔR² / (1 − R²_full) for an R² change"})
def regression(df, request, meta=None) -> dict:
    c = _common(request, "f2", one_sided_ok=False)
    prob, extra = _reg_problem(request, c)
    out = _run(request, prob, c, extra, "Noncentral F with λ = f²(u + v + 1) (as R pwr.f2.test); N = v + p + 1.")
    if extra["tested_predictors"] < extra["predictors"]:
        out["warnings"].append(_approx_warning(
            "For an R² change Statly follows R's pwr package (λ = f²(u + v + 1)). G*Power uses λ = f² × N, which "
            "gives slightly more power, so its sample size can be a few people smaller."))
    return out


# ---------------------------------------------------------------------------
# Test hook: power / critical value / ncp at a given n and effect (used to check G*Power's printed
# examples). Not an analysis: Statly never reports power computed from an observed effect.
# ---------------------------------------------------------------------------
_PROBLEMS = {"power.t_test": ("d", True, _t_problem), "power.anova": ("f", False, _anova_problem),
             "power.correlation": ("r", True, _r_problem), "power.chi_square": ("w", False, _chi_problem),
             "power.regression": ("f2", False, _reg_problem)}


def _power_at(request, n: float, effect: float) -> dict:
    from statly_engine.contracts import AnalysisRequest
    req = request if isinstance(request, AnalysisRequest) else AnalysisRequest.model_validate(request)
    es, one_sided_ok, make = _PROBLEMS[req.analysis_id]
    c = Common("sensitivity", float(req.alpha), 0.5, req.tails, "participants", None, None, n)
    prob, _ = make(req, c)
    return {"power": prob.power(n, effect), **prob.details(n, effect)}
