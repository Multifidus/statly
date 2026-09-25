"""Rater agreement (SPEC §8 "Reliability": ICC, Cohen's kappa, Fleiss' kappa, Kendall's W).
Reference: fixtures/r/agreement_education.R.

Data: one row per rated subject (student, essay...), one column per rater (`raters` role). Every
coefficient uses complete cases (subjects rated by every rater, as psych/irr do); the rest are counted.
Tails must be two-sided.

- icc = psych::ICC(lmer = FALSE): the classical ANOVA mean squares (as SPSS). All six Shrout & Fleiss
  (1979) forms with psych's CIs; headline options.form (default ICC2 = two-way random, absolute
  agreement, single rater). F_one_way (ICC1 forms), F_two_way (ICC2/3 forms) and F_raters (do the
  raters differ on average?) are reported. psych's default lmer = TRUE (REML variance components)
  differs only when a variance component estimate is negative.
- cohen_kappa = psych::cohen.kappa: unweighted, linear (w.exp = 1) and quadratic (w.exp = 2) weighted
  kappa, CI = estimate +/- z sqrt(var) (Fleiss, Cohen & Everitt 1969) clipped to [-1, 1]. options.weights
  picks the headline (default unweighted). z and p = irr::kappa2 (SE under H0). Categories = the
  values either rater used, in value-label order, else sorted (weights depend on this order).
- fleiss_kappa = irr::kappam.fleiss: kappa, z, p (SE under H0, Fleiss 1971/Fleiss et al. 1979); CI =
  kappa +/- z SE clipped to [-1, 1] (DescTools::KappaM); per-category kappas (irr detail = TRUE).
- kendall_w = irr::kendall(correct = TRUE): tie-corrected W, chi-square = m(n - 1)W on n - 1 df. This is
  agreement among m raters ranking n subjects (raters are the blocks), distinct from the Friedman effect
  size in effect_sizes_rank.py. CI: percentile bootstrap over subjects (boot::boot, R = 2000, seed 12345,
  reproduced draw for draw with RRandom). effectsize's own CI resamples the blocks (raters), which is
  degenerate with a handful of raters.
- Benchmarks: Landis & Koch (1977) for kappa and W, Koo & Li (2016) for ICC, with a caveat.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy import stats

from statly_engine.errors import InvalidParams
from statly_engine.stats import apa, prep
from statly_engine.stats.anova import require_two_sided
from statly_engine.stats.apa import Rich
from statly_engine.stats.core import SMALL_N, ResultBuilder, finite, warning
from statly_engine.stats.descriptives import cell
from statly_engine.stats.effect_sizes import Estimate
from statly_engine.stats.effect_sizes_rank import BOOT_SEED, RRandom, _perc_ci, tie_sum
from statly_engine.stats.registry import Role, register

KW_ITERATIONS = 2000
_RATERS = [Role("raters", 2, None, "One column per rater; one row per person or piece of work rated")]
_TWO_RATERS = [Role("raters", 2, 2, "The two raters' columns; one row per person or piece of work rated")]

AGREEMENT_CAVEAT = ("These labels are rough conventions. What counts as good enough depends on the stakes: "
                    "ratings used for decisions about individual students need higher agreement than ratings "
                    "used for research summaries.")


# ---------------------------------------------------------------------------
# Benchmarks
# ---------------------------------------------------------------------------
def landis_koch(k) -> str | None:
    if not finite(k):
        return None
    for cut, word in ((0.0, "poor"), (0.20, "slight"), (0.40, "fair"), (0.60, "moderate"), (0.80, "substantial")):
        if k < cut or (cut > 0 and k <= cut):
            return word
    return "almost perfect"


def koo_li(icc) -> str | None:
    if not finite(icc):
        return None
    return "poor" if icc < 0.5 else "moderate" if icc < 0.75 else "good" if icc <= 0.9 else "excellent"


_MAG = {"poor": "negligible", "slight": "negligible", "fair": "small", "moderate": "medium", "substantial": "large",
        "almost perfect": "large", "good": "large", "excellent": "large"}


def _interpret(word: str | None, source: str) -> dict | None:
    if word is None:
        return None
    return {"magnitude": _MAG[word], "benchmark": source,
            "text": f"By {source}'s benchmarks this is {word} agreement. {AGREEMENT_CAVEAT}"}


def _agreement_effect(b: ResultBuilder, key, label, symbol, est: Estimate, scale: str, term=None):
    b.effect(key, label, symbol, est, None, term)
    word = koo_li(est.value) if scale == "icc" else landis_koch(est.value)
    b.effect_sizes[-1]["interpretation"] = _interpret(word, "Koo and Li (2016)" if scale == "icc" else
                                                      "Landis and Koch (1977)")


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------
def _rater_names(request) -> list[str]:
    names = list(dict.fromkeys(request.variables["raters"]))
    if len(names) < 2:
        raise InvalidParams("Choose at least two different rater columns.")
    return names


def _numeric_ratings(df, request, meta) -> dict:
    names = _rater_names(request)
    x = np.column_stack([prep.numeric(df, v, meta).to_numpy() for v in names])
    ok = np.isfinite(x).all(axis=1)
    return {"names": names, "labels": [prep.label(meta, v) for v in names], "x": x[ok], "n_excluded": int((~ok).sum())}


def _category_ratings(df, request, meta) -> dict:
    names = _rater_names(request)
    cols = [prep.categorical(df, v, meta) for v in names]
    ok = np.all([c.notna().to_numpy() for c in cols], axis=0)
    cols = [c[ok] for c in cols]
    levels = prep.level_order(pd.concat(cols, ignore_index=True), names[0], meta) if ok.any() else []
    codes = np.column_stack([c.map(lambda v: next(i for i, lv in enumerate(levels) if prep._same(v, lv))).to_numpy(int)
                             for c in cols]) if ok.any() else np.zeros((0, len(names)), int)
    if codes.shape[0] < 2:
        raise InvalidParams(f"Only {codes.shape[0]} rows have a rating from every rater; agreement needs at least 2.")
    if len(levels) < 2:
        raise InvalidParams("Every rating is the same category, so agreement beyond chance can't be estimated "
                            "(kappa is undefined when only one category is used).")
    return {"names": names, "labels": [prep.label(meta, v) for v in names], "codes": codes, "levels": levels,
            "level_labels": [prep.value_label(meta, names[0], lv) for lv in levels], "n_excluded": int((~ok).sum())}


def _common(b: ResultBuilder, n: int, n_excl: int, m: int):
    if n < SMALL_N:
        b.warn(warning("small_sample", "caution", f"Only {n} people or pieces of work were rated by every rater. "
                       "Agreement estimates from small samples are imprecise; look at the interval."))
    if n_excl:
        b.warn(warning("missing_data", "info", f"{n_excl} rows were left out because at least one rater's rating was "
                       "blank or marked missing. Agreement is computed on rows rated by everyone."))
    b.inputs(n, n_excl)


def _p_phrase(p) -> str:
    s = apa.p_value(p)
    return f"p {s}" if s[0] in "<>" else f"p = {s}"


# ---------------------------------------------------------------------------
# ICC
# ---------------------------------------------------------------------------
ICC_FORMS = ("ICC1", "ICC2", "ICC3", "ICC1k", "ICC2k", "ICC3k")
_ICC_LABELS = {
    "ICC1": "ICC(1,1): one-way random, single rater", "ICC2": "ICC(2,1): two-way random, absolute agreement, single rater",
    "ICC3": "ICC(3,1): two-way mixed, consistency, single rater", "ICC1k": "ICC(1,k): one-way random, average of raters",
    "ICC2k": "ICC(2,k): two-way random, absolute agreement, average of raters",
    "ICC3k": "ICC(3,k): two-way mixed, consistency, average of raters"}
_ICC_SYMBOL = {"ICC1": "ICC(1,1)", "ICC2": "ICC(2,1)", "ICC3": "ICC(3,1)", "ICC1k": "ICC(1,k)", "ICC2k": "ICC(2,k)",
               "ICC3k": "ICC(3,k)"}


def icc_all(x: np.ndarray, level: float = 0.95) -> dict:
    """psych::ICC(lmer = FALSE) on a complete n x k matrix: six forms, F tests and CIs."""
    n, k = x.shape
    gm = x.mean()
    ssr = k * float(np.sum((x.mean(axis=1) - gm) ** 2))
    ssc = n * float(np.sum((x.mean(axis=0) - gm) ** 2))
    sse = float(np.sum((x - gm) ** 2)) - ssr - ssc
    sse = max(sse, 0.0)
    msb, msj = ssr / (n - 1), ssc / (k - 1)
    mse = sse / ((n - 1) * (k - 1))
    msw = (ssc + sse) / (n * (k - 1))
    with np.errstate(all="ignore"):
        icc = {"ICC1": (msb - msw) / (msb + (k - 1) * msw),
               "ICC2": (msb - mse) / (msb + (k - 1) * mse + k * (msj - mse) / n),
               "ICC3": (msb - mse) / (msb + (k - 1) * mse),
               "ICC1k": (msb - msw) / msb, "ICC2k": (msb - mse) / (msb + (msj - mse) / n), "ICC3k": (msb - mse) / msb}
        a = 1 - level
        df1n, df1d, df2n, df2d = n - 1, n * (k - 1), n - 1, (n - 1) * (k - 1)
        f11, f21 = msb / msw, msb / mse
        fj = msj / mse
        ci = {}
        f1l, f1u = f11 / stats.f.ppf(1 - a / 2, df1n, df1d), f11 * stats.f.ppf(1 - a / 2, df1d, df1n)
        f3l, f3u = f21 / stats.f.ppf(1 - a / 2, df2n, df2d), f21 * stats.f.ppf(1 - a / 2, df2d, df2n)
        ci["ICC1"] = ((f1l - 1) / (f1l + k - 1), (f1u - 1) / (f1u + k - 1))
        ci["ICC3"] = ((f3l - 1) / (f3l + k - 1), (f3u - 1) / (f3u + k - 1))
        ci["ICC1k"] = (1 - 1 / f1l, 1 - 1 / f1u)
        ci["ICC3k"] = (1 - 1 / f3l, 1 - 1 / f3u)
        i2 = icc["ICC2"]
        vn = (k - 1) * (n - 1) * (k * i2 * fj + n * (1 + (k - 1) * i2) - k * i2) ** 2
        vd = (n - 1) * k ** 2 * i2 ** 2 * fj ** 2 + (n * (1 + (k - 1) * i2) - k * i2) ** 2
        v = vn / vd
        fu, fl = stats.f.ppf(1 - a / 2, n - 1, v), stats.f.ppf(1 - a / 2, v, n - 1)
        base = k * msj + (k * n - k - n) * mse
        l3 = n * (msb - fu * mse) / (fu * base + n * msb)
        u3 = n * (fl * msb - mse) / (base + n * fl * msb)
        ci["ICC2"] = (l3, u3)
        ci["ICC2k"] = (l3 * k / (1 + l3 * (k - 1)), u3 * k / (1 + u3 * (k - 1)))
        tests = {"F_one_way": (f11, (df1n, df1d), stats.f.sf(f11, df1n, df1d)),
                 "F_two_way": (f21, (df2n, df2d), stats.f.sf(f21, df2n, df2d)),
                 "F_raters": (fj, (k - 1, df2d), stats.f.sf(fj, k - 1, df2d))}
    return {"icc": icc, "ci": ci, "tests": tests, "ms": {"subjects": msb, "raters": msj, "error": mse, "within": msw}}


@register("reliability.icc", label="Intraclass correlation (ICC)", roles=_RATERS,
          options={"form": "Headline form: ICC1, ICC2 (default; two-way random, absolute agreement, single rater), "
                           "ICC3, ICC1k, ICC2k or ICC3k. All six are reported."})
def icc(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    require_two_sided(request, "The ICC")
    form = str(request.options.get("form", "ICC2"))
    form = next((f for f in ICC_FORMS if f.lower() == form.lower().replace("(", "").replace(")", "")), None)
    if form is None:
        raise InvalidParams("options.form must be one of ICC1, ICC2, ICC3, ICC1k, ICC2k, ICC3k.")
    level = request.ci_level
    d = _numeric_ratings(df, request, meta)
    x = d["x"]
    n, k = x.shape
    if n < 2:
        raise InvalidParams(f"Only {n} rows have a score from every rater; the ICC needs at least 2.")
    if np.ptp(x) == 0:
        raise InvalidParams("Every score is the same, so there is no variation for the ICC to describe.")
    res = icc_all(x, level)
    b = ResultBuilder(request)
    tests = ["F_one_way", "F_two_way"] if form in ("ICC1", "ICC1k") else ["F_two_way", "F_one_way"]
    tl = {"F_one_way": "F (one-way: subjects)", "F_two_way": "F (two-way: subjects)", "F_raters": "F (raters)"}
    for key in tests + ["F_raters"]:
        f, dfs, p = res["tests"][key]
        b.statistic(key, tl[key], "F", f, list(dfs), p)
    for f in [form] + [g for g in ICC_FORMS if g != form]:
        lo, hi = res["ci"][f]
        _agreement_effect(b, f.lower(), _ICC_LABELS[f], _ICC_SYMBOL[f], Estimate(float(res["icc"][f]), lo, hi, level), "icc")
    b.descriptives([cell(v, {}, lab, x[:, j], level, 0) for j, (v, lab) in enumerate(zip(d["names"], d["labels"]))])
    b.chart("icc_forms", [{"form": f, "label": _ICC_LABELS[f], "icc": float(res["icc"][f]),
                           "ci_lower": float(res["ci"][f][0]), "ci_upper": float(res["ci"][f][1])} for f in ICC_FORMS])
    if k < 3:
        b.warn(warning("few_raters", "info", "Only two raters: the ICC describes these two, and the interval is wide."))
    _common(b, n, d["n_excluded"], k)
    fr, dfr, pr = res["tests"]["F_raters"]
    if finite(pr) and pr < request.alpha and form in ("ICC2", "ICC2k", "ICC3", "ICC3k"):
        b.warn(warning("rater_bias", "info", "The raters differ on average (some are consistently harsher or more "
                       "lenient). Absolute-agreement ICCs (ICC2) count that as disagreement; consistency ICCs (ICC3) "
                       "ignore it."))

    val, (lo, hi) = res["icc"][form], res["ci"][form]
    f, dfs, p = res["tests"]["F_one_way" if form in ("ICC1", "ICC1k") else "F_two_way"]
    word = koo_li(val)
    s = Rich().t(f"Agreement among the {k} raters was {word}, {_ICC_SYMBOL[form]} = {apa.no_zero(val)}, "
                 f"{apa.level_text(level)} CI {apa.ci_text(lo, hi, 2, True)}, ").stat("F", dfs, f).t(", ").p(p).t(".")
    summary = (f"The intraclass correlation measures how closely the {k} raters' scores agree across the {n} people or "
               f"pieces of work rated. The {_ICC_LABELS[form].split(': ')[1]} ICC is {apa.no_zero(val)} "
               f"(between {apa.no_zero(lo)} and {apa.no_zero(hi)} with {apa.level_text(level)} confidence), which is "
               f"{word} by Koo and Li's (2016) guidelines. {AGREEMENT_CAVEAT}")
    b.sentence(s).summary(summary)
    cols = [apa.column("form", "Form", "left"), apa.column("icc", "ICC"), apa.column("ci", f"{apa.level_text(level)} CI"),
            apa.column("f", Rich().i("F")), apa.column("df1", Rich().i("df").sub("1")),
            apa.column("df2", Rich().i("df").sub("2")), apa.column("p", Rich().i("p"))]
    rows = []
    for g in ICC_FORMS:
        ff, dd, pp = res["tests"]["F_one_way" if g in ("ICC1", "ICC1k") else "F_two_way"]
        rows.append(apa.row([apa.cell_text(_ICC_LABELS[g]), apa.cell_num(float(res["icc"][g]), bounded=True),
                             apa.cell_ci(res["ci"][g][0], res["ci"][g][1], 2, True), apa.cell_num(float(ff)),
                             apa.cell_df(dd[0]), apa.cell_df(dd[1]), apa.cell_p(float(pp))]))
    note = Rich().t(f"n = {n} rated with all {k} raters. Shrout and Fleiss (1979) forms; headline {_ICC_SYMBOL[form]}. "
                    "Rater effect: ").stat("F", dfr, fr).t(", ").p(pr).t(".")
    b.table(apa.table("Intraclass Correlation Coefficients", cols, rows, general_note=note))
    return b.build()


# ---------------------------------------------------------------------------
# Cohen's kappa
# ---------------------------------------------------------------------------
_WEIGHT_EXP = {"unweighted": None, "linear": 1, "quadratic": 2}
_KAPPA_KEY = {"unweighted": "kappa", "linear": "kappa_linear", "quadratic": "kappa_quadratic"}
_Z_KEY = {"unweighted": "z_unweighted", "linear": "z_linear", "quadratic": "z_quadratic"}
_KAPPA_LABEL = {"unweighted": "Cohen's kappa", "linear": "Weighted kappa (linear weights)",
                "quadratic": "Weighted kappa (quadratic weights)"}


def _weights(q: int, exp: int | None) -> np.ndarray:
    if exp is None:
        return np.eye(q)
    d = np.abs(np.subtract.outer(np.arange(q), np.arange(q))).astype(float)
    return 1 - d ** exp / (q - 1) ** exp


def cohen_kappa_stats(table: np.ndarray, weighting: str, level: float = 0.95) -> dict:
    """psych::cohen.kappa estimate + CI and irr::kappa2 z / p for one weighting."""
    n = float(table.sum())
    p = table / n
    q = p.shape[0]
    r, c = p.sum(axis=1), p.sum(axis=0)
    w = _weights(q, _WEIGHT_EXP[weighting])
    po, pc = float(np.sum(w * p)), float(np.sum(w * np.outer(r, c)))
    kappa = (po - pc) / (1 - pc)
    if weighting == "unweighted":        # psych Vark (Fleiss, Cohen & Everitt 1969)
        diag = np.diag(p)
        t1 = float(np.sum(diag * ((1 - pc) - (r + c) * (1 - po)) ** 2))
        off = p * np.add.outer(c, r) ** 2
        t2 = (1 - po) ** 2 * float(off.sum() - np.trace(off))
        var = (t1 + t2 - (po * pc - 2 * pc + po) ** 2) / (n * (1 - pc) ** 4)
    else:                                # psych Varkw
        colw, roww = w.T @ c, w.T @ r
        var = (float(np.sum(p * (w * (1 - pc) - np.add.outer(colw, roww) * (1 - po)) ** 2))
               - (po * pc - 2 * pc + po) ** 2) / (n * (1 - pc) ** 4)
    if not np.isfinite(var) or var < 0:
        var = 0.0
    zc = stats.norm.ppf(1 - (1 - level) / 2)
    lo, hi = kappa - zc * math.sqrt(var), kappa + zc * math.sqrt(var)
    # irr::kappa2: SE under H0
    wi, wj = w @ c, w @ r
    var0 = (float(np.sum(np.outer(r, c) * (w - np.add.outer(wi, wj)) ** 2)) - pc ** 2) / (n * (1 - pc) ** 2)
    z = kappa / math.sqrt(var0) if var0 > 0 else float("nan")
    pz = 2 * stats.norm.sf(abs(z)) if np.isfinite(z) else None
    return {"kappa": kappa, "lower": lo, "upper": hi, "z": z, "p": pz, "po": po, "pc": pc}


@register("reliability.cohen_kappa", label="Cohen's kappa (two raters)", roles=_TWO_RATERS,
          options={"weights": "\"unweighted\" (default; categories are unordered), \"linear\" or \"quadratic\" "
                              "(ordered categories: near-misses get partial credit). All three are reported."})
def cohen_kappa(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    require_two_sided(request, "Cohen's kappa")
    weighting = str(request.options.get("weights", "unweighted")).lower()
    if weighting not in _WEIGHT_EXP:
        raise InvalidParams("options.weights must be \"unweighted\", \"linear\" or \"quadratic\".")
    level = request.ci_level
    d = _category_ratings(df, request, meta)
    codes, q = d["codes"], len(d["levels"])
    n = codes.shape[0]
    table = np.zeros((q, q))
    np.add.at(table, (codes[:, 0], codes[:, 1]), 1)
    res = {w: cohen_kappa_stats(table, w, level) for w in _WEIGHT_EXP}
    clip = any(abs(v) > 1 for w in res.values() for v in (w["lower"], w["upper"]))   # psych clips all bounds
    b = ResultBuilder(request)
    order = [weighting] + [w for w in _WEIGHT_EXP if w != weighting]
    for w in order:
        b.statistic(_Z_KEY[w], f"z ({w})", "z", res[w]["z"], [], res[w]["p"])
    for w in order:
        lo, hi = res[w]["lower"], res[w]["upper"]
        if clip:
            lo, hi = max(-1.0, min(1.0, lo)), max(-1.0, min(1.0, hi))
        _agreement_effect(b, _KAPPA_KEY[w], _KAPPA_LABEL[w], "κ" if w == "unweighted" else "κw",
                          Estimate(float(res[w]["kappa"]), lo, hi, level), "kappa")
    labs = d["level_labels"]
    b.chart("agreement_table", [{"rater1": labs[i], "rater2": labs[j], "count": int(table[i, j])}
                                for i in range(q) for j in range(q)])
    _common(b, n, d["n_excluded"], 2)
    if weighting == "unweighted" and q >= 3:
        b.warn(warning("ordered_categories", "info", "If the categories are ordered (e.g. rubric levels), weighted "
                       "kappa gives partial credit for near-misses; set weights to linear or quadratic."))
    h = res[weighting]
    hlo, hi_ = b.effect_sizes[0]["ci"]["lower"], b.effect_sizes[0]["ci"]["upper"]
    word = landis_koch(h["kappa"])
    sym = Rich().i("κ") if weighting == "unweighted" else Rich().i("κ").sub("w", italic=True)
    s = Rich().t(f"The two raters showed {word} agreement ({apa.num(100 * res['unweighted']['po'], 1)}% identical ratings), ")
    s.extend(sym).t(f" = {apa.no_zero(h['kappa'])}, {apa.level_text(level)} CI {apa.ci_text(hlo, hi_, 2, True)}, ") \
        .i("z").t(f" = {apa.num(h['z'])}, ").p(h["p"]).t(".")
    summary = (f"{d['labels'][0]} and {d['labels'][1]} gave the same rating for "
               f"{apa.num(100 * res['unweighted']['po'], 1)}% of the {n} cases. After removing the agreement expected "
               f"by chance, {_KAPPA_LABEL[weighting].lower().replace('cohen', 'Cohen')} is {apa.no_zero(h['kappa'])}, "
               f"which is {word} agreement by Landis and Koch's (1977) benchmarks ({_p_phrase(h['p'])} compared with "
               f"chance). {AGREEMENT_CAVEAT}")
    b.sentence(s).summary(summary)
    cols = [apa.column("r1", f"{d['labels'][0]} \\ {d['labels'][1]}", "left")] + \
        [apa.column(f"c{j}", labs[j]) for j in range(q)] + [apa.column("total", "Total")]
    rows = [apa.row([apa.cell_text(labs[i])] + [apa.cell_int(table[i, j]) for j in range(q)] +
                    [apa.cell_int(table[i].sum())]) for i in range(q)]
    rows.append(apa.row([apa.cell_text("Total")] + [apa.cell_int(table[:, j].sum()) for j in range(q)] + [apa.cell_int(n)]))
    note = Rich().t("Diagonal cells are agreements. ")
    for w in ("unweighted", "linear", "quadratic"):
        e = next(x for x in b.effect_sizes if x["key"] == _KAPPA_KEY[w])
        note.t(f"{_KAPPA_LABEL[w]} = {apa.no_zero(e['value'])} {apa.ci_text(e['ci']['lower'], e['ci']['upper'], 2, True)}; ")
    note.t(f"{apa.level_text(level)} CIs.")
    b.table(apa.table(f"Agreement Between {d['labels'][0]} and {d['labels'][1]}", cols, rows, general_note=note))
    return b.build()


# ---------------------------------------------------------------------------
# Fleiss' kappa
# ---------------------------------------------------------------------------
def fleiss_kappa_stats(codes: np.ndarray, q: int, level: float = 0.95) -> dict:
    """irr::kappam.fleiss (+ detail): overall and per-category kappa, z, p; CI kappa +/- z SE in [-1, 1]."""
    ns, nr = codes.shape
    tt = np.zeros((ns, q))
    for j in range(nr):
        np.add.at(tt, (np.arange(ns), codes[:, j]), 1)
    agree = float(np.sum((np.sum(tt ** 2, axis=1) - nr) / (nr * (nr - 1)) / ns))
    pj = tt.sum(axis=0) / (ns * nr)
    chance = float(np.sum(pj ** 2))
    kappa = (agree - chance) / (1 - chance)
    qj = 1 - pj
    spq = float(np.sum(pj * qj))
    var = (2 / (spq ** 2 * (ns * nr * (nr - 1)))) * (spq ** 2 - float(np.sum(pj * qj * (qj - pj))))
    se = math.sqrt(var)
    zc = stats.norm.ppf(1 - (1 - level) / 2)
    clip = lambda v: max(-1.0, min(1.0, v))  # noqa: E731
    pjk = (np.sum(tt ** 2, axis=0) - ns * nr * pj) / (ns * nr * (nr - 1) * pj)
    kk = (pjk - pj) / (1 - pj)
    sek = math.sqrt(2 / (ns * nr * (nr - 1)))
    z = kappa / se
    cats = [{"kappa": float(k), "lower": clip(k - zc * sek), "upper": clip(k + zc * sek), "z": float(k / sek),
             "p": float(2 * stats.norm.sf(abs(k / sek))), "proportion": float(pj[i])} for i, k in enumerate(kk)]
    return {"kappa": kappa, "lower": clip(kappa - zc * se), "upper": clip(kappa + zc * se), "z": z,
            "p": float(2 * stats.norm.sf(abs(z))), "agree": agree, "chance": chance, "categories": cats}


@register("reliability.fleiss_kappa", label="Fleiss' kappa (two or more raters)", roles=_RATERS, options={})
def fleiss_kappa(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    require_two_sided(request, "Fleiss' kappa")
    level = request.ci_level
    d = _category_ratings(df, request, meta)
    codes, q = d["codes"], len(d["levels"])
    n, m = codes.shape
    res = fleiss_kappa_stats(codes, q, level)
    b = ResultBuilder(request)
    b.statistic("z", "z", "z", res["z"], [], res["p"])
    for lab, c in zip(d["level_labels"], res["categories"]):
        b.statistic("z", f"z (category {lab})", "z", c["z"], [], c["p"], term=lab)
    _agreement_effect(b, "fleiss_kappa", "Fleiss' kappa", "κ", Estimate(res["kappa"], res["lower"], res["upper"], level),
                      "kappa")
    for lab, c in zip(d["level_labels"], res["categories"]):
        _agreement_effect(b, "category_kappa", f"Kappa for category {lab}", "κ",
                          Estimate(c["kappa"], c["lower"], c["upper"], level), "kappa", term=lab)
    b.chart("category_agreement", [{"category": lab, **c} for lab, c in zip(d["level_labels"], res["categories"])])
    _common(b, n, d["n_excluded"], m)
    word = landis_koch(res["kappa"])
    s = Rich().t(f"Agreement among the {m} raters was {word}, Fleiss' ").i("κ") \
        .t(f" = {apa.no_zero(res['kappa'])}, {apa.level_text(level)} CI {apa.ci_text(res['lower'], res['upper'], 2, True)}, ") \
        .i("z").t(f" = {apa.num(res['z'])}, ").p(res["p"]).t(".")
    best = max(zip(d["level_labels"], res["categories"]), key=lambda t: t[1]["kappa"])
    worst = min(zip(d["level_labels"], res["categories"]), key=lambda t: t[1]["kappa"])
    summary = (f"Fleiss' kappa measures how often the {m} raters put the {n} cases in the same category, beyond what "
               f"chance would produce. It is {apa.no_zero(res['kappa'])}, which is {word} agreement by Landis and "
               f"Koch's (1977) benchmarks. Raters agreed most on \"{best[0]}\" (kappa {apa.no_zero(best[1]['kappa'])}) "
               f"and least on \"{worst[0]}\" (kappa {apa.no_zero(worst[1]['kappa'])}). {AGREEMENT_CAVEAT}")
    b.sentence(s).summary(summary)
    cols = [apa.column("cat", "Category", "left"), apa.column("prop", "Proportion"), apa.column("k", Rich().i("κ")),
            apa.column("ci", f"{apa.level_text(level)} CI"), apa.column("z", Rich().i("z")), apa.column("p", Rich().i("p"))]
    rows = [apa.row([apa.cell_text(lab), apa.cell_num(c["proportion"], bounded=True), apa.cell_num(c["kappa"], bounded=True),
                     apa.cell_ci(c["lower"], c["upper"], 2, True), apa.cell_num(c["z"]), apa.cell_p(c["p"])])
            for lab, c in zip(d["level_labels"], res["categories"])]
    rows.append(apa.row([apa.cell_text("Overall"), apa.cell_empty(), apa.cell_num(res["kappa"], bounded=True),
                         apa.cell_ci(res["lower"], res["upper"], 2, True), apa.cell_num(res["z"]), apa.cell_p(res["p"])]))
    note = Rich().t(f"n = {n} cases rated by all {m} raters. Proportion = share of all ratings in the category.")
    b.table(apa.table("Fleiss' Kappa by Category", cols, rows, general_note=note))
    return b.build()


# ---------------------------------------------------------------------------
# Kendall's W (agreement among raters)
# ---------------------------------------------------------------------------
def kendall_w_raters(x: np.ndarray) -> float:
    """irr::kendall(correct = TRUE): x = n subjects x m raters, ranks within each rater."""
    n, m = x.shape
    ranks = np.apply_along_axis(stats.rankdata, 0, x)
    s = float(np.sum((ranks.sum(axis=1) - m * (n + 1) / 2) ** 2))
    tj = sum(tie_sum(ranks[:, j]) for j in range(m))
    denom = m ** 2 * (n ** 3 - n) - m * tj
    return 12 * s / denom if denom > 0 else float("nan")


def kendall_w_bootstrap(x: np.ndarray, level: float, seed: int, iterations: int) -> tuple[float, float]:
    """boot::boot(x, statistic, R) resampling rows, then boot.ci(type = "perc"); all-equal -> [W, W]."""
    n = x.shape[0]
    idx = RRandom(seed).index(n, n * iterations).reshape(n, iterations).T
    t = np.array([kendall_w_raters(x[i]) for i in idx])
    fin = t[np.isfinite(t)]
    if len(fin) and np.ptp(fin) < 1e-12:
        w = kendall_w_raters(x)
        return w, w
    return _perc_ci(t, level)


@register("reliability.kendall_w", label="Kendall's W (agreement among raters)", roles=_RATERS,
          options={"bootstrap_seed": "Seed for the bootstrap CI (default 12345).",
                   "bootstrap_iterations": "Bootstrap resamples of the rated cases (default 2000)."})
def kendall_w(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    require_two_sided(request, "Kendall's W")
    level = request.ci_level
    seed = int(request.options.get("bootstrap_seed", BOOT_SEED))
    iters = int(request.options.get("bootstrap_iterations", KW_ITERATIONS))
    d = _numeric_ratings(df, request, meta)
    x = d["x"]
    n, m = x.shape
    if n < 3:
        raise InvalidParams(f"Kendall's W needs at least 3 cases rated by every rater; there are {n}.")
    w = kendall_w_raters(x)
    if not finite(w):
        raise InvalidParams("Every rater gave every case the same score, so there are no rankings to compare.")
    chi2 = m * (n - 1) * w
    p = float(stats.chi2.sf(chi2, n - 1))
    lo, hi = kendall_w_bootstrap(x, level, seed, iters)
    b = ResultBuilder(request)
    b.statistic("chi_sq", "Chi-square", "χ²", chi2, [n - 1], p)
    _agreement_effect(b, "kendall_w", "Kendall's W", "W", Estimate(w, lo, hi, level), "kappa")
    mean_rho = (m * w - 1) / (m - 1)
    b.chart("rank_sums", [{"variable": "case", "row": i + 1, "rank_sum": float(r)} for i, r in
                          enumerate(np.apply_along_axis(stats.rankdata, 0, x).sum(axis=1))])
    b.descriptives([cell(v, {}, lab, x[:, j], level, 0) for j, (v, lab) in enumerate(zip(d["names"], d["labels"]))])
    ties = any(tie_sum(stats.rankdata(x[:, j])) > 0 for j in range(m))
    if ties:
        b.warn(warning("ties_present", "info", "Some raters gave several cases the same score. W uses the tie "
                       "correction, which is standard, but many ties make rankings less informative."))
    if m < 3:
        b.warn(warning("few_raters", "info", "With two raters, W is a rescaled Spearman correlation "
                       f"(here rho = {apa.no_zero(mean_rho)})."))
    _common(b, n, d["n_excluded"], m)
    word = landis_koch(w)
    s = Rich().t(f"The {m} raters' rankings of the {n} cases showed {word} agreement, Kendall's ").i("W") \
        .t(f" = {apa.no_zero(w)}, {apa.level_text(level)} CI {apa.ci_text(lo, hi, 2, True)}, ").stat("χ²", [n - 1], chi2) \
        .t(", ").p(p).t(".")
    summary = (f"Kendall's W measures how similarly the {m} raters rank the {n} cases, from 0 (no agreement) to 1 "
               f"(identical rankings). It is {apa.no_zero(w)}, {word} agreement by Landis and Koch's (1977) benchmarks; "
               f"the average correlation between two raters' rankings is {apa.no_zero(mean_rho)}. "
               + ("This is more agreement than chance would produce" if p < request.alpha else
                  "This could easily be chance agreement") + f" ({_p_phrase(p)}). {AGREEMENT_CAVEAT}")
    b.sentence(s).summary(summary)
    cols = [apa.column("w", Rich().i("W")), apa.column("ci", f"{apa.level_text(level)} CI"),
            apa.column("chi", Rich().i("χ").sup("2")), apa.column("df", Rich().i("df")), apa.column("p", Rich().i("p")),
            apa.column("rho", Rich().t("Mean ").i("r").sub("s"))]
    rows = [apa.row([apa.cell_num(w, bounded=True), apa.cell_ci(lo, hi, 2, True), apa.cell_num(chi2), apa.cell_df(n - 1),
                     apa.cell_p(p), apa.cell_num(mean_rho, bounded=True)])]
    note = Rich().t(f"{m} raters, n = {n} cases. Tie-corrected W; CI from {iters} bootstrap resamples of the cases "
                    f"(seed {seed}).")
    b.table(apa.table("Kendall's Coefficient of Concordance", cols, rows, general_note=note))
    return b.build()
