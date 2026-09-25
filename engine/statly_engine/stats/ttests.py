"""t tests (SPEC §8): the worked exemplar for every analysis module.

Conventions (fixtures/r/ttests.R):
- Two-sample direction follows R: x - y, x = the first group level / first measure listed.
  Group order: options.levels > the variable's value-label order > sorted values.
- t_test.independent reports Welch's and Student's t; options.variant ("welch" default, or
  "student") picks the headline (first statistic, used in the APA sentence and table).
- Effect sizes: Hedges' g (headline), Cohen's d (pooled SD), Glass's delta (SD of the reference
  group = second level unless options.reference_group), r from the headline t, and the raw mean
  difference with the t.test CI. Paired: d_av (headline; comparable to between-group d) and d_z.
- Missing data: pairwise per analysis; paired uses complete pairs and reports what was dropped.
"""

from __future__ import annotations

import warnings

import numpy as np
import pandas as pd
from scipy import stats

from statly_engine.data.linking import normalize_id
from statly_engine.errors import InvalidParams
from statly_engine.stats import apa, assumptions as asm, effect_sizes as es, prep
from statly_engine.stats.apa import Rich
from statly_engine.stats.core import (SMALL_N, ResultBuilder, constant_warning, finite, magnitude, missing_warning,
                                      small_sample_warning, ties_warning, unequal_groups_warning, warning)
from statly_engine.stats.descriptives import cell
from statly_engine.stats.registry import Role, register

SCIPY_ALT = {"two_sided": "two-sided", "greater": "greater", "less": "less"}
_SIZE = {"negligible": "negligible", "small": "small", "medium": "medium", "large": "large"}


def _alt(request) -> str:
    return request.tails.value


def _estimate_from_ci(value, ci, level) -> es.Estimate:
    lo, hi = float(ci.low), float(ci.high)
    return es.Estimate(float(value), lo if np.isfinite(lo) else None, hi if np.isfinite(hi) else None, level)


def _p_phrase(p) -> str:
    s = apa.p_value(p)
    return f"p {s}" if s[0] in "<>" else f"p = {s}"


def _tail_note(request, first: str, second: str | None = None) -> str | None:
    alt = _alt(request)
    if alt == "two_sided":
        return None
    rel = ">" if alt == "greater" else "<"
    rhs = second if second is not None else "the test value"
    return f"One-tailed test (alternative: {first} {rel} {rhs})."


def _stats_clause(r: Rich, sym, df, t, p, es_sym, est: es.Estimate) -> Rich:
    if not finite(t):
        return r
    r.stat(sym, df, t).t(", ").p(p)
    if est.value is not None:
        r.t(", ").es(es_sym, est.value, est.lower, est.upper, est.level)
    return r


def _size_sentence(est: es.Estimate) -> str:
    mag = magnitude(est.value, "d")
    return f" The size of the difference was {_SIZE[mag]} by common benchmarks." if mag else ""


# ---------------------------------------------------------------------------
# One-sample t
# ---------------------------------------------------------------------------
@register("t_test.one_sample", label="One-sample t test",
          roles=[Role("outcome", 1, 1, "Scores to compare with a fixed value")],
          options={"test_value": "Value the mean is compared with (default 0)."})
def one_sample(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    name = request.variables["outcome"][0]
    vl = prep.label(meta, name)
    mu = float(request.options.get("test_value", request.options.get("mu", 0.0)))
    level, alt, alpha = request.ci_level, _alt(request), request.alpha
    x_all = prep.numeric(df, name, meta)
    x = x_all.dropna().to_numpy()
    n = len(x)
    if n < 2:
        raise InvalidParams(f"A one-sample t test needs at least 2 scores; {vl} has {n}.")

    b = ResultBuilder(request)
    desc = cell(name, {}, vl, x_all.to_numpy(), level)
    b.descriptives([desc])
    constant = np.ptp(x) == 0
    if constant:
        t = p = None
        md = es.Estimate(float(np.mean(x) - mu), None, None, level)
        b.warn(constant_warning(vl))
    else:
        res = stats.ttest_1samp(x, mu, alternative=SCIPY_ALT[alt])
        t, p = float(res.statistic), float(res.pvalue)
        ci = res.confidence_interval(confidence_level=level)
        md = es.Estimate(float(np.mean(x) - mu), *(float(v) - mu if np.isfinite(v) else None
                                                   for v in (ci.low, ci.high)), level)
    d = es.cohens_d_one_sample(x, mu, level, alt)
    g = es.cohens_d_one_sample(x, mu, level, alt, adjust=True)
    b.statistic("t", "One-sample t", "t", t, [n - 1], p)
    b.effect("cohens_d", "Cohen's d", "d", d, "d")
    b.effect("hedges_g", "Hedges' g", "g", g, "d")
    b.effect("mean_difference", "Mean difference", "Mdiff", md)

    res_a, charts = asm.shapiro_wilk(x, asm.scope("overall", vl), alpha)
    b.assumption(res_a, charts)
    b.warn(small_sample_warning({vl: n})).warn(ties_warning(x, vl))
    b.warn(missing_warning(int(x_all.isna().sum())))
    b.inputs(n, int(x_all.isna().sum()))

    # APA + plain language
    mu_txt = apa.num(mu) if not float(mu).is_integer() else str(int(mu))
    r = Rich().t(f"{vl} scores (").i("M").t(f" = {apa.num(desc['mean'])}, ").i("SD").t(f" = {apa.num(desc['sd'])}) ")
    if constant:
        r.t(f"could not be compared with the test value of {mu_txt} because every score was the same.")
        summary = f"Every {vl} score was the same, so the average can't be tested against {mu_txt}."
    else:
        sig = p < alpha
        if sig:
            r.t(f"were significantly {'higher' if t > 0 else 'lower'} than the test value of {mu_txt}, ")
        else:
            r.t(f"did not differ significantly from the test value of {mu_txt}, ")
        _stats_clause(r, "t", [n - 1], t, p, "d", d).t(".")
        direction = "higher" if t > 0 else "lower"
        summary = (f"On average, {vl} scores ({apa.num(desc['mean'])}) were {direction} than {mu_txt}. "
                   + ("This difference is unlikely to be due to chance alone" if sig else
                      "This difference could easily be due to chance, so there is no strong evidence the "
                      "true average differs from " + mu_txt) + f" ({_p_phrase(p)})." + _size_sentence(d))
    b.sentence(r).summary(summary)

    cols = [apa.column("variable", "Variable", "left"), apa.column("n", Rich().i("n")),
            apa.column("m", Rich().i("M")), apa.column("sd", Rich().i("SD")), apa.column("t", Rich().i("t")),
            apa.column("df", Rich().i("df")), apa.column("p", Rich().i("p")), apa.column("d", Rich().i("d")),
            apa.column("ci", f"{apa.level_text(level)} CI")]
    row = apa.row([apa.cell_text(vl), apa.cell_int(n), apa.cell_num(desc["mean"]), apa.cell_num(desc["sd"]),
                   apa.cell_num(t), apa.cell_df(n - 1), apa.cell_p(p), apa.cell_num(d.value),
                   apa.cell_ci(d.lower, d.upper)])
    note = Rich().t(f"Test value = {mu_txt}. ").i("d").t(" = Cohen's d; CI = confidence interval for ").i("d").t(".")
    tail = _tail_note(request, "mean", mu_txt)
    if tail:
        note.t(" " + tail)
    b.table(apa.table(f"One-Sample t Test for {vl}", cols, [row], general_note=note))
    return b.build()


# ---------------------------------------------------------------------------
# Independent-samples t
# ---------------------------------------------------------------------------
@register("t_test.independent", label="Independent-samples t test",
          roles=[Role("outcome", 1, 1, "Scores to compare"),
                 Role("group", 1, 1, "Grouping variable with exactly two groups")],
          options={"variant": "\"welch\" (default) or \"student\": which t is the headline; both are reported.",
                   "levels": "Two group values, in the order to compare (first minus second).",
                   "reference_group": "Group whose SD standardizes Glass's delta (default: the second)."})
def independent(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    yname, gname = request.variables["outcome"][0], request.variables["group"][0]
    vl, gl = prep.label(meta, yname), prep.label(meta, gname)
    level, alt, alpha = request.ci_level, _alt(request), request.alpha
    opts = request.options
    variant = opts.get("variant") or ("student" if opts.get("welch") is False else "welch")
    if variant not in ("welch", "student"):
        raise InvalidParams("options.variant must be \"welch\" or \"student\".")

    y = prep.numeric(df, yname, meta)
    g = prep.categorical(df, gname, meta)
    levels = prep.level_order(g, gname, meta, opts.get("levels"))
    if len(levels) != 2:
        found = ", ".join(prep.value_label(meta, gname, lv) for lv in levels) or "none"
        raise InvalidParams(f"An independent-samples t test compares exactly two groups, but {gl} has "
                            f"{len(levels)} ({found}). Filter to two groups or choose them in the options.")
    names = [prep.value_label(meta, gname, lv) for lv in levels]
    in_level = [g.map(lambda v, lv=lv: prep._same(v, lv)).to_numpy(bool) for lv in levels]
    ya = [y[m].to_numpy() for m in in_level]
    x1, x2 = (a[np.isfinite(a)] for a in ya)
    n1, n2 = len(x1), len(x2)
    if n1 < 2 or n2 < 2:
        raise InvalidParams(f"Each group needs at least 2 scores (n = {n1} and {n2}).")

    b = ResultBuilder(request)
    d1 = cell(yname, {gname: levels[0]}, names[0], ya[0], level)
    d2 = cell(yname, {gname: levels[1]}, names[1], ya[1], level)
    b.descriptives([d1, d2])

    with warnings.catch_warnings(), np.errstate(all="ignore"):
        warnings.simplefilter("ignore")
        welch = stats.ttest_ind(x1, x2, equal_var=False, alternative=SCIPY_ALT[alt])
        student = stats.ttest_ind(x1, x2, equal_var=True, alternative=SCIPY_ALT[alt])
    tests = {"welch": (welch, "welch_t", "Welch's t"), "student": (student, "student_t", "Student's t")}
    order = ["welch", "student"] if variant == "welch" else ["student", "welch"]
    for k in order:
        res, key, lab = tests[k]
        b.statistic(key, lab, "t", float(res.statistic), [float(res.df)], float(res.pvalue))
    head = tests[order[0]][0]
    t, p, dfh = float(head.statistic), float(head.pvalue), float(head.df)
    if not finite(t):
        b.warn(constant_warning(vl))

    hg = es.hedges_g(x1, x2, True, level, alt)
    cd = es.cohens_d(x1, x2, True, level, alt)
    ref = opts.get("reference_group")
    if ref is not None and prep._same(ref, levels[0]):
        rev = es.glass_delta(x2, x1, level, alt if alt == "two_sided" else ("less" if alt == "greater" else "greater"))
        gd = es.Estimate(-rev.value if rev.value is not None else None,
                         -rev.upper if rev.upper is not None else None,
                         -rev.lower if rev.lower is not None else None, level)
        ref_name = names[0]
    else:
        gd = es.glass_delta(x1, x2, level, alt)
        ref_name = names[1]
    rr = es.r_from_t(t, dfh, level, alt)
    md = (_estimate_from_ci(np.mean(x1) - np.mean(x2), head.confidence_interval(level), level) if finite(t)
          else es.Estimate(float(np.mean(x1) - np.mean(x2)), None, None, level))
    b.effect("hedges_g", "Hedges' g", "g", hg, "d")
    b.effect("cohens_d", "Cohen's d", "d", cd, "d")
    b.effect("glass_delta", f"Glass's delta (SD of {ref_name})", "Δ", gd, "d")
    b.effect("r", "r (from t)", "r", rr, "r", what="association")
    b.effect("mean_difference", "Mean difference", "Mdiff", md)

    for arr, nm, lv in ((x1, names[0], levels[0]), (x2, names[1], levels[1])):
        res_a, charts = asm.shapiro_wilk(arr, asm.scope("group", nm, {gname: lv}), alpha)
        b.assumption(res_a, charts)
    note = ("Welch's t test, the default here, does not assume equal spread, so it is still appropriate."
            if variant == "welch" else
            "Student's t test assumes equal spread, so Welch's t test (also reported) is the safer choice.")
    lev, _ = asm.levene_brown_forsythe({names[0]: x1, names[1]: x2}, asm.scope("overall", f"{names[0]} vs {names[1]}"),
                                       alpha, failed_note=note)
    b.assumption(lev)

    counts = {names[0]: n1, names[1]: n2}
    b.warn(small_sample_warning(counts)).warn(unequal_groups_warning(counts))
    b.warn(ties_warning(np.concatenate([x1, x2]), vl))
    n_excluded = int(len(df) - n1 - n2)
    b.warn(missing_warning(n_excluded))
    b.inputs(n1 + n2, n_excluded, [({gname: levels[0]}, n1), ({gname: levels[1]}, n2)])

    # APA sentence + plain-language summary
    lab = tests[order[0]][2]
    r = Rich().t(f"An independent-samples {'Welch' if variant == 'welch' else 'Student'} ").i("t").t(" test ")
    desc_run = lambda d, nm: Rich().t(f"{nm} (").i("M").t(f" = {apa.num(d['mean'])}, ").i("SD").t(f" = {apa.num(d['sd'])})")  # noqa: E731
    if not finite(t):
        r.t(f"could not be computed because {vl} scores do not vary within either group.")
        summary = f"{vl} scores did not vary within the groups, so the groups can't be compared with a t test."
    else:
        sig = p < alpha
        higher = "higher" if t > 0 else "lower"
        if sig:
            r.t(f"showed that {vl} scores were significantly {higher} for ").extend(desc_run(d1, names[0])) \
                .t(" than for ").extend(desc_run(d2, names[1])).t(", ")
        else:
            r.t(f"showed no significant difference in {vl} scores between ").extend(desc_run(d1, names[0])) \
                .t(" and ").extend(desc_run(d2, names[1])).t(", ")
        _stats_clause(r, "t", [dfh], t, p, "g", hg).t(".")
        hi_name, lo_name = (names[0], names[1]) if t > 0 else (names[1], names[0])
        hi_m, lo_m = (d1["mean"], d2["mean"]) if t > 0 else (d2["mean"], d1["mean"])
        summary = (f"The {hi_name} group scored higher on average ({apa.num(hi_m)}) than the {lo_name} group "
                   f"({apa.num(lo_m)}). " +
                   ("This difference is unlikely to be due to chance alone" if sig else
                    "This difference could easily be due to chance, so there is no strong evidence of a real "
                    "difference between the groups") + f" ({_p_phrase(p)})." + _size_sentence(hg))
    b.sentence(r).summary(summary)

    cols = [apa.column("variable", "Variable", "left")]
    for k in (1, 2):
        cols += [apa.column(f"n{k}", Rich().i("n")), apa.column(f"m{k}", Rich().i("M")),
                 apa.column(f"sd{k}", Rich().i("SD"))]
    cols += [apa.column("t", Rich().i("t")), apa.column("df", Rich().i("df")), apa.column("p", Rich().i("p")),
             apa.column("g", Rich().i("g")), apa.column("ci", f"{apa.level_text(level)} CI")]
    row = apa.row([apa.cell_text(vl), apa.cell_int(n1), apa.cell_num(d1["mean"]), apa.cell_num(d1["sd"]),
                   apa.cell_int(n2), apa.cell_num(d2["mean"]), apa.cell_num(d2["sd"]), apa.cell_num(t),
                   apa.cell_df(dfh), apa.cell_p(p), apa.cell_num(hg.value), apa.cell_ci(hg.lower, hg.upper)])
    other = tests[order[1]]
    note = Rich().t(f"{lab} test ({'equal variances not assumed' if variant == 'welch' else 'equal variances assumed'}). ") \
        .i("g").t(" = Hedges' g; CI = confidence interval for ").i("g").t(f". {other[2]} test: ") \
        .stat("t", [float(other[0].df)], float(other[0].statistic)).t(", ").p(float(other[0].pvalue)).t(".")
    tail = _tail_note(request, names[0], names[1])
    if tail:
        note.t(" " + tail)
    b.table(apa.table(f"Comparison of {vl} by {gl}", cols, [row],
                      column_groups=[apa.column_group(names[0], 1, 3), apa.column_group(names[1], 4, 3)],
                      general_note=note))
    return b.build()


# ---------------------------------------------------------------------------
# Paired-samples t
# ---------------------------------------------------------------------------
def _paired_wide(df, request, meta):
    a, c = request.variables["measures"]
    xa, xb = prep.numeric(df, a, meta), prep.numeric(df, c, meta)
    cc = (xa.notna() & xb.notna()).to_numpy()
    names = [prep.label(meta, a), prep.label(meta, c)]
    dropped = int((~cc).sum())
    notes = []
    if dropped:
        notes.append(f"{dropped} people were left out because they are missing {names[0]} or {names[1]}")
    return dict(x=xa[cc].to_numpy(), y=xb[cc].to_numpy(), names=names, variables=[a, c], groups=[{}, {}],
                n_missing=[int(xa.isna().sum()), int(xb.isna().sum())], n_excluded=dropped, notes=notes,
                outcome_label=f"{names[0]} and {names[1]}")


def _paired_long(df, request, meta):
    yname = request.variables["outcome"][0]
    tname = request.variables["time"][0]
    sname = request.variables["subject_id"][0]
    y = prep.numeric(df, yname, meta)
    tcol = prep.categorical(df, tname, meta)
    levels = prep.level_order(tcol, tname, meta, request.options.get("levels"))
    if len(levels) != 2:
        raise InvalidParams(f"A paired t test compares exactly two time points, but {prep.label(meta, tname)} has "
                            f"{len(levels)}. Filter to two or choose them in the options.")
    link = (meta or {}).get("link") or {}
    norm = (link.get("normalization") if link.get("mode") == "linked" and link.get("id_variable") == sname
            else None) or {"trim_whitespace": True, "case_insensitive": False}
    ids = prep.categorical(df, sname, meta).map(
        lambda v: None if v is None else normalize_id(v, norm["trim_whitespace"], norm["case_insensitive"]))
    at = [tcol.map(lambda v, lv=lv: prep._same(v, lv)).to_numpy(bool) for lv in levels]
    in_levels = at[0] | at[1]
    frame = pd.DataFrame({"id": ids, "lvl": np.where(at[0], 0, np.where(at[1], 1, -1)), "y": y})[in_levels]
    no_id = int(frame["id"].isna().sum())
    frame = frame[frame["id"].notna()]
    counts = frame.groupby(["id", "lvl"]).size().unstack(fill_value=0).reindex(columns=[0, 1], fill_value=0)
    dup = counts[(counts[0] > 1) | (counts[1] > 1)].index
    one_side = counts[((counts[0] == 0) | (counts[1] == 0)) & ~counts.index.isin(dup)].index
    ok = counts[(counts[0] == 1) & (counts[1] == 1)].index
    wide = frame[frame["id"].isin(ok)].pivot(index="id", columns="lvl", values="y")
    wide = wide.sort_index()
    cc = wide[0].notna() & wide[1].notna()
    names = [prep.value_label(meta, tname, lv) for lv in levels]
    notes = []
    if len(one_side):
        notes.append(f"{len(one_side)} people have a score at only one of the two time points")
    if len(dup):
        notes.append(f"{len(dup)} IDs appear more than once at the same time point, so their scores can't be paired")
    if int((~cc).sum()):
        notes.append(f"{int((~cc).sum())} matched people are missing a {prep.label(meta, yname)} score")
    if no_id:
        notes.append(f"{no_id} rows have no ID")
    n_pairs = int(cc.sum())
    return dict(x=wide.loc[cc, 0].to_numpy(), y=wide.loc[cc, 1].to_numpy(), names=names, variables=[yname, yname],
                groups=[{tname: levels[0]}, {tname: levels[1]}],
                n_missing=[int(y[at[0]].isna().sum()), int(y[at[1]].isna().sum())],
                n_excluded=int(in_levels.sum() - 2 * n_pairs), notes=notes, outcome_label=prep.label(meta, yname))


@register("t_test.paired", label="Paired-samples t test",
          roles={"wide": [Role("measures", 2, 2, "Two score columns for the same people (e.g. pre, post)")],
                 "long": [Role("outcome", 1, 1, "Scores"), Role("time", 1, 1, "Time point with two levels"),
                          Role("subject_id", 1, 1, "Participant ID linking rows across time")]},
          options={"levels": "Long layout: the two time values, in the order to compare (first minus second)."})
def paired(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    level, alt, alpha = request.ci_level, _alt(request), request.alpha
    data = _paired_wide(df, request, meta) if "measures" in request.variables else _paired_long(df, request, meta)
    x, y, names = data["x"], data["y"], data["names"]
    n = len(x)
    if n < 2:
        raise InvalidParams(f"A paired t test needs at least 2 people with both scores; there are {n}.")
    diffs = x - y
    dlabel = f"{names[0]} - {names[1]}"

    b = ResultBuilder(request)
    d1 = cell(data["variables"][0], data["groups"][0], names[0], x, level, data["n_missing"][0])
    d2 = cell(data["variables"][1], data["groups"][1], names[1], y, level, data["n_missing"][1])
    b.descriptives([d1, d2])

    constant = np.ptp(diffs) == 0
    if constant:
        t = p = None
        md = es.Estimate(float(np.mean(diffs)), None, None, level)
        b.warn(constant_warning(f"the differences ({dlabel})"))
    else:
        res = stats.ttest_rel(x, y, alternative=SCIPY_ALT[alt])
        t, p = float(res.statistic), float(res.pvalue)
        md = _estimate_from_ci(np.mean(diffs), res.confidence_interval(level), level)
    dav = es.d_av(x, y, level, alt)
    dz = es.d_z(x, y, level, alt)
    b.statistic("t", "Paired t", "t", t, [n - 1], p)
    dav_sym = Rich().i("d").sub("av")
    b.effect("d_av", "Cohen's d_av", "d_av", dav, "d")
    b.effect("d_z", "Cohen's d_z", "d_z", dz, "d")
    b.effect("mean_difference", "Mean difference", "Mdiff", md)

    res_a, charts = asm.shapiro_wilk(diffs, asm.scope("differences", dlabel), alpha)
    b.assumption(res_a, charts)
    if n < SMALL_N:
        b.warn(warning("small_sample", "caution", f"Only {n} people have both scores. With fewer than {SMALL_N}, "
                       "results are less precise and depend more on the differences being roughly "
                       "bell-shaped, so check the plots."))
    b.warn(ties_warning(np.concatenate([x, y]), data["outcome_label"]))
    if data["notes"]:
        b.warn(warning("pairs_dropped", "info", "Paired tests need the same person at both times, so some "
                       "people were left out: " + "; ".join(data["notes"]) + f". {n} complete pairs were analysed."))
    b.inputs(n, data["n_excluded"], [(data["groups"][0], n), (data["groups"][1], n)] if data["groups"][0] else [])

    r = Rich().t("A paired-samples ").i("t").t(" test ")
    desc_run = lambda d, nm: Rich().t(f"{nm} (").i("M").t(f" = {apa.num(d['mean'])}, ").i("SD").t(f" = {apa.num(d['sd'])})")  # noqa: E731
    if constant:
        r.t(f"could not be computed because every difference ({dlabel}) was the same.")
        summary = "Every person's change was exactly the same, so there is no variation to test."
    else:
        sig = p < alpha
        if sig:
            r.t(f"showed that scores were significantly {'higher' if t > 0 else 'lower'} at ") \
                .extend(desc_run(d1, names[0])).t(" than at ").extend(desc_run(d2, names[1])).t(", ")
        else:
            r.t("showed no significant difference between ").extend(desc_run(d1, names[0])).t(" and ") \
                .extend(desc_run(d2, names[1])).t(", ")
        _stats_clause(r, "t", [n - 1], t, p, dav_sym, dav).t(".")
        hi, lo = (names[0], names[1]) if t > 0 else (names[1], names[0])
        summary = (f"For the {n} people with both scores, scores were higher at {hi} than at {lo} on average "
                   f"(a difference of {apa.num(abs(md.value))} points). " +
                   ("This change is unlikely to be due to chance alone" if sig else
                    "This change could easily be due to chance, so there is no strong evidence of a real change")
                   + f" ({_p_phrase(p)})." + _size_sentence(dav))
    b.sentence(r).summary(summary)

    cols = [apa.column("variable", "Variable", "left")]
    for k in (1, 2):
        cols += [apa.column(f"m{k}", Rich().i("M")), apa.column(f"sd{k}", Rich().i("SD"))]
    cols += [apa.column("t", Rich().i("t")), apa.column("df", Rich().i("df")), apa.column("p", Rich().i("p")),
             apa.column("d_av", Rich().i("d").sub("av")), apa.column("ci", f"{apa.level_text(level)} CI")]
    row = apa.row([apa.cell_text(data["outcome_label"]), apa.cell_num(d1["mean"]), apa.cell_num(d1["sd"]),
                   apa.cell_num(d2["mean"]), apa.cell_num(d2["sd"]), apa.cell_num(t), apa.cell_df(n - 1),
                   apa.cell_p(p), apa.cell_num(dav.value), apa.cell_ci(dav.lower, dav.upper)])
    note = Rich().i("n").t(f" = {n} people with both scores. ").i("d").sub("av") \
        .t(" = mean difference divided by the average of the two standard deviations; CI = confidence interval for ") \
        .i("d").sub("av").t(". ").i("d").sub("z").t(" = ").t(apa.num(dz.value)).t(".")
    tail = _tail_note(request, names[0], names[1])
    if tail:
        note.t(" " + tail)
    b.table(apa.table(f"Paired Comparison of {names[0]} and {names[1]}", cols, [row],
                      column_groups=[apa.column_group(names[0], 1, 2), apa.column_group(names[1], 3, 2)],
                      general_note=note))
    return b.build()
