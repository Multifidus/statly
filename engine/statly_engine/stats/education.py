"""Education-specific analyses (SPEC §8): gain scores and Hake's normalized gain.
Reference: fixtures/r/agreement_education.R.

Data: pre and post scores for the same people, wide (`measures` = [pre, post], optional `group`) or long
(`outcome`/`time`/`subject_id`, linked by ID exactly as t_test.paired: the data-linking helpers in
ttests.py are reused, so ID normalisation, duplicates and unmatched people are handled identically).
Complete pairs only; everything dropped is counted. Gain = post - pre (second minus first).

- gain_score: descriptives of pre, post and gain; paired t on the gains (t.test(post, pre, paired = TRUE),
  honours tails); mean gain with its t CI, d_av and d_z (as t_test.paired, direction post - pre).
  With a group (wide layout): per-group paired t and mean gain (term = group), then the gains are compared
  between groups with Welch's t (2 groups; + gain difference and Hedges' g of the gains) or Welch's F
  (oneway.test, 3+ groups). For standardized effects with 3+ groups run anova.welch on a gain variable.
- normalized_gain (options.max_score required; scores must lie in [0, max]):
  * g_class = Hake's (1998) class-average gain (<post> - <pre>) / (max - <pre>) - the headline, as Hake defined.
  * g_individual = the mean of each person's (post - pre) / (max - pre). People with pre = max are excluded
    (undefined) and counted. Negative individual g (losses) are kept as is. g_individual differs from g_class
    because it weights every person equally, while g_class weights by room to improve (people who started
    low dominate); a large gap means gains depended on starting level.
  * normalized_change = Marx & Cummings' (2007) c: gains / (max - pre), losses / pre, no change = 0; pre = post
    = max or 0 excluded. It treats gains and losses symmetrically (bounded in [-1, 1]).
  * CIs: percentile bootstrap resampling people (boot::boot + boot.ci "perc"), options.bootstrap_iterations
    (default 2000) and bootstrap_seed (12345; reset for every group), reproduced draw for draw via RRandom.
  * Hake's bands: g < .3 low, .3 <= g < .7 medium, >= .7 high.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats

from statly_engine.errors import InvalidParams
from statly_engine.stats import apa, assumptions as asm, effect_sizes as es, prep
from statly_engine.stats.anova import require_two_sided, welch_f
from statly_engine.stats.apa import Rich
from statly_engine.stats.core import SMALL_N, ResultBuilder, constant_warning, finite, warning
from statly_engine.stats.descriptives import cell
from statly_engine.stats.effect_sizes_rank import BOOT_SEED, RRandom, _perc_ci
from statly_engine.stats.registry import Role, register
from statly_engine.stats.ttests import SCIPY_ALT, _paired_long, _paired_wide

NG_ITERATIONS = 2000
_ROLES = {"wide": [Role("measures", 2, 2, "Pre and post score columns for the same people, pre first"),
                   Role("group", 0, 1, "Optional: compare gains between groups (e.g. class, program)")],
          "long": [Role("outcome", 1, 1, "Scores"), Role("time", 1, 1, "Time point with two levels (pre, post)"),
                   Role("subject_id", 1, 1, "Participant ID linking rows across time")]}
_LEVELS_OPT = "Long layout: the two time values, pre first (e.g. [\"pre\", \"post\"])."


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------
def prepost(df, request, meta) -> dict:
    """pre/post arrays of complete pairs (+ group codes when a group is given, wide layout only)."""
    if "measures" not in request.variables:
        d = _paired_long(df, request, meta)
        return {**d, "pre": d["x"], "post": d["y"], "group": None}
    if not request.variables.get("group"):
        d = _paired_wide(df, request, meta)
        return {**d, "pre": d["x"], "post": d["y"], "group": None}
    a, c = request.variables["measures"]
    gname = request.variables["group"][0]
    pre, post = prep.numeric(df, a, meta), prep.numeric(df, c, meta)
    g = prep.categorical(df, gname, meta)
    levels = prep.level_order(g, gname, meta, request.options.get("group_levels"))
    if len(levels) < 2:
        raise InvalidParams(f"{prep.label(meta, gname)} has only {len(levels)} group; comparing gains needs 2 or more. "
                            "Remove the group variable to analyse everyone together.")
    code = g.map(lambda v: next((i for i, lv in enumerate(levels) if prep._same(v, lv)), -1)).to_numpy(int)
    ok = (code >= 0) & pre.notna().to_numpy() & post.notna().to_numpy()
    names = [prep.label(meta, a), prep.label(meta, c)]
    per = []
    for i, lv in enumerate(levels):
        rows = code == i
        per.append({"level": lv, "label": prep.value_label(meta, gname, lv), "group": {gname: lv},
                    "pre": pre.to_numpy()[rows & ok], "post": post.to_numpy()[rows & ok],
                    "n_missing": [int(pre[rows].isna().sum()), int(post[rows].isna().sum()),
                                  int((rows & ~ok).sum())]})
    dropped = int((~ok).sum())
    notes = [f"{dropped} rows were left out because the group, {names[0]} or {names[1]} was missing"] if dropped else []
    return {"pre": pre.to_numpy()[ok], "post": post.to_numpy()[ok], "names": names, "variables": [a, c],
            "groups": [{}, {}], "n_missing": [int(pre.isna().sum()), int(post.isna().sum())], "n_excluded": dropped,
            "notes": notes, "outcome_label": f"{names[0]} and {names[1]}", "group": per, "gname": gname,
            "glabel": prep.label(meta, gname)}


def _pair_cells(d, level) -> list[dict]:
    return [cell(d["variables"][0], d["groups"][0], d["names"][0], d["pre"], level, d["n_missing"][0]),
            cell(d["variables"][1], d["groups"][1], d["names"][1], d["post"], level, d["n_missing"][1])]


def _drop_note(b: ResultBuilder, d: dict, n: int):
    if d["notes"]:
        b.warn(warning("pairs_dropped", "info", "Gains need the same person's pre and post scores, so some rows were "
                       "left out: " + "; ".join(d["notes"]) + f". {n} complete pairs were analysed."))


def _p_phrase(p) -> str:
    s = apa.p_value(p)
    return f"p {s}" if s[0] in "<>" else f"p = {s}"


def _ci_est(value, ci, level) -> es.Estimate:
    lo, hi = float(ci.low), float(ci.high)
    return es.Estimate(float(value), lo if np.isfinite(lo) else None, hi if np.isfinite(hi) else None, level)


# ---------------------------------------------------------------------------
# Gain score
# ---------------------------------------------------------------------------
@register("education.gain_score", label="Gain scores (post minus pre)", roles=_ROLES,
          options={"levels": _LEVELS_OPT, "group_levels": "Wide layout with a group: the group order."})
def gain_score(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    d = prepost(df, request, meta)
    if d["group"] is not None:
        return _gain_grouped(d, request)
    level, alt = request.ci_level, request.tails.value
    pre, post = d["pre"], d["post"]
    n = len(pre)
    if n < 2:
        raise InvalidParams(f"Gain scores need at least 2 people with both scores; there are {n}.")
    gain = post - pre
    b = ResultBuilder(request)
    b.descriptives(_pair_cells(d, level) + [cell("gain", {}, "Gain (post - pre)", gain, level, d["n_excluded"])])
    constant = np.ptp(gain) == 0
    if constant:
        t = p = None
        mg = es.Estimate(float(np.mean(gain)), None, None, level)
        b.warn(constant_warning("the gains"))
    else:
        res = stats.ttest_rel(post, pre, alternative=SCIPY_ALT[alt])
        t, p = float(res.statistic), float(res.pvalue)
        mg = _ci_est(np.mean(gain), res.confidence_interval(level), level)
    dav, dz = es.d_av(post, pre, level, alt), es.d_z(post, pre, level, alt)
    b.statistic("t", "Paired t (post - pre)", "t", t, [n - 1], p)
    b.effect("mean_gain", "Mean gain", "Mgain", mg)
    b.effect("d_av", "Cohen's d_av", "d_av", dav, "d", what="gain")
    b.effect("d_z", "Cohen's d_z", "d_z", dz, "d", what="gain")
    res_a, charts = asm.shapiro_wilk(gain, asm.scope("differences", "gain (post - pre)"), request.alpha)
    b.assumption(res_a, charts)
    b.chart("gains", [{"pre": float(a), "post": float(c), "gain": float(c - a)} for a, c in zip(pre, post)])
    if n < SMALL_N:
        b.warn(warning("small_sample", "caution", f"Only {n} people have both scores. With fewer than {SMALL_N}, the "
                       "average gain is imprecise; look at the interval."))
    _drop_note(b, d, n)
    b.inputs(n, d["n_excluded"])

    npre, npost = d["names"]
    dg = b.continuous[2]
    r = Rich().t(f"Scores changed from {npre} (").i("M").t(f" = {apa.num(b.continuous[0]['mean'])}, ").i("SD") \
        .t(f" = {apa.num(b.continuous[0]['sd'])}) to {npost} (").i("M").t(f" = {apa.num(b.continuous[1]['mean'])}, ") \
        .i("SD").t(f" = {apa.num(b.continuous[1]['sd'])}), a mean gain of {apa.num(mg.value)}")
    if constant:
        r.t("; every person's gain was the same, so no test was possible.")
        summary = f"Every person gained exactly {apa.num(mg.value)} points, so there is no variation to test."
    else:
        r.t(f", {apa.level_text(level)} CI {apa.ci_text(mg.lower, mg.upper)}, ").stat("t", [n - 1], t).t(", ").p(p) \
            .t(", ").extend(Rich().i("d").sub("av")).t(f" = {apa.num(dav.value)}.")
        sig = p < request.alpha
        direction = "went up" if mg.value > 0 else "went down"
        summary = (f"On average, scores {direction} by {apa.num(abs(mg.value))} points from {npre} to {npost} "
                   f"(the {n} people with both scores). " +
                   ("This change is unlikely to be due to chance alone" if sig else
                    "This change could easily be due to chance") + f" ({_p_phrase(p)}).")
        if dav.value is not None:
            summary += f" The standardized gain (d_av = {apa.num(dav.value)}) is {b.effect_sizes[1]['interpretation']['magnitude']}."
        summary += f" Gains ranged from {apa.num(dg['min'])} to {apa.num(dg['max'])}."
    b.sentence(r).summary(summary)
    cols = [apa.column("m", "Measure", "left"), apa.column("n", Rich().i("n")), apa.column("mean", Rich().i("M")),
            apa.column("sd", Rich().i("SD")), apa.column("ci", f"{apa.level_text(level)} CI of M")]
    rows = [apa.row([apa.cell_text(lab), apa.cell_int(c["n"]), apa.cell_num(c["mean"]), apa.cell_num(c["sd"]),
                     apa.cell_ci((c["ci"] or {}).get("lower"), (c["ci"] or {}).get("upper"))])
            for lab, c in zip([npre, npost, "Gain"], b.continuous)]
    note = Rich().t("Gain = post minus pre for each person. ")
    if not constant:
        note.stat("t", [n - 1], t).t(", ").p(p).t("; ").extend(Rich().i("d").sub("av")).t(f" = {apa.num(dav.value)}, ") \
            .extend(Rich().i("d").sub("z")).t(f" = {apa.num(dz.value)}.")
    b.table(apa.table("Pre, Post and Gain Scores", cols, rows, general_note=note))
    return b.build()


def _gain_grouped(d: dict, request) -> dict:
    level, alt = request.ci_level, request.tails.value
    per = d["group"]
    b = ResultBuilder(request)
    for gr in per:
        if len(gr["pre"]) < 2:
            raise InvalidParams(f"Group {gr['label']} has {len(gr['pre'])} people with both scores; each group needs 2 or more.")
    gains = [gr["post"] - gr["pre"] for gr in per]
    head_rows = []
    if len(per) == 2:
        a, c = gains
        res = stats.ttest_ind(a, c, equal_var=False, alternative=SCIPY_ALT[alt])
        b.statistic("welch_t", "Welch's t (gains)", "t", res.statistic, [res.df], res.pvalue)
        diff = _ci_est(np.mean(a) - np.mean(c), res.confidence_interval(level), level)
        b.effect("gain_difference", f"Difference in mean gain ({per[0]['label']} - {per[1]['label']})", "Mdiff", diff)
        g = es.hedges_g(a, c, True, level, alt)
        b.effect("hedges_g", "Hedges' g (gains)", "g", g, "d", what="difference in gains")
        head = ("t", [float(res.df)], float(res.statistic), float(res.pvalue))
    else:
        f, df1, df2, p = welch_f(gains)
        if request.tails.value != "two_sided":
            require_two_sided(request, "Comparing gains across 3 or more groups")
        b.statistic("welch_F", "Welch's F (gains)", "F", f, [df1, df2], p)
        head = ("F", [df1, df2], f, p)
    for gr, gn in zip(per, gains):
        n = len(gn)
        if np.ptp(gn) == 0:
            b.statistic("t", f"Paired t ({gr['label']})", "t", None, [n - 1], None, term=gr["label"])
            b.effect("mean_gain", f"Mean gain ({gr['label']})", "Mgain", es.Estimate(float(np.mean(gn)), None, None, level),
                     term=gr["label"])
            b.warn(constant_warning(f"the gains in {gr['label']}"))
            head_rows.append((gr, gn, None, None, None))
            continue
        res = stats.ttest_rel(gr["post"], gr["pre"], alternative=SCIPY_ALT[alt])
        b.statistic("t", f"Paired t ({gr['label']})", "t", res.statistic, [n - 1], res.pvalue, term=gr["label"])
        mg = _ci_est(np.mean(gn), res.confidence_interval(level), level)
        b.effect("mean_gain", f"Mean gain ({gr['label']})", "Mgain", mg, term=gr["label"])
        head_rows.append((gr, gn, float(res.statistic), float(res.pvalue), mg))
    cells = []
    for gr, gn in zip(per, gains):
        cells += [cell(d["variables"][0], gr["group"], f"{d['names'][0]} ({gr['label']})", gr["pre"], level, gr["n_missing"][0]),
                  cell(d["variables"][1], gr["group"], f"{d['names'][1]} ({gr['label']})", gr["post"], level, gr["n_missing"][1]),
                  cell("gain", gr["group"], f"Gain ({gr['label']})", gn, level, gr["n_missing"][2])]
        res_a, charts = asm.shapiro_wilk(gn, asm.scope("group", gr["label"], gr["group"]), request.alpha,
                                         chart_prefix=f"{gr['label']}_")
        b.assumption(res_a, charts)
    b.descriptives(cells)
    counts = {gr["label"]: len(gn) for gr, gn in zip(per, gains)}
    small = {k: v for k, v in counts.items() if v < SMALL_N}
    if small:
        b.warn(warning("small_sample", "caution", "Some groups have fewer than 30 people with both scores: " +
                       ", ".join(f"{k} (n = {v})" for k, v in small.items()) + ". Their mean gains are imprecise."))
    _drop_note(b, d, int(sum(counts.values())))
    b.inputs(int(sum(counts.values())), d["n_excluded"], [(gr["group"], len(gn)) for gr, gn in zip(per, gains)])

    sym, dfs, stat, p = head
    means = ", ".join(f"{gr['label']} {apa.num(float(np.mean(gn)))}" for gr, gn in zip(per, gains))
    sig = finite(p) and p < request.alpha
    r = Rich().t(f"Mean gains were {means}. The groups' gains ") \
        .t("differed significantly, " if sig else "did not differ significantly, ").stat(sym, dfs, stat).t(", ").p(p).t(".")
    best = max(zip(per, gains), key=lambda t: np.mean(t[1]))
    summary = (f"Everyone's gain is their post score minus their pre score. Average gains by {d['glabel']}: {means} "
               f"points. {best[0]['label']} gained the most. " +
               ("The difference between the groups' gains is unlikely to be due to chance alone" if sig else
                "The differences between the groups' gains could easily be due to chance") + f" ({_p_phrase(p)}).")
    b.sentence(r).summary(summary)
    cols = [apa.column("g", d["glabel"], "left"), apa.column("n", Rich().i("n")), apa.column("pre", Rich().i("M").t(" pre")),
            apa.column("post", Rich().i("M").t(" post")), apa.column("gain", Rich().i("M").t(" gain")),
            apa.column("ci", f"{apa.level_text(level)} CI"), apa.column("t", Rich().i("t")), apa.column("p", Rich().i("p"))]
    rows = [apa.row([apa.cell_text(gr["label"]), apa.cell_int(len(gn)), apa.cell_num(float(np.mean(gr["pre"]))),
                     apa.cell_num(float(np.mean(gr["post"]))), apa.cell_num(float(np.mean(gn))),
                     apa.cell_ci(mg.lower if mg else None, mg.upper if mg else None), apa.cell_num(t), apa.cell_p(pp)])
            for gr, gn, t, pp, mg in head_rows]
    note = Rich().t("Gain = post minus pre; t = paired t within each group. Gains compared between groups: ") \
        .stat(sym, dfs, stat).t(", ").p(p).t(" (Welch).")
    b.table(apa.table(f"Gains by {d['glabel']}", cols, rows, general_note=note))
    return b.build()


# ---------------------------------------------------------------------------
# Normalized gain
# ---------------------------------------------------------------------------
def hake_band(g) -> str | None:
    if not finite(g):
        return None
    return "low" if g < 0.3 else "medium" if g < 0.7 else "high"


def normalized_gains(pre: np.ndarray, post: np.ndarray, mx: float) -> np.ndarray:
    """[g_class, g_individual, normalized_change] for one sample (vectorised over leading axes)."""
    with np.errstate(all="ignore"):
        mpre, mpost = pre.mean(axis=-1), post.mean(axis=-1)
        gc = (mpost - mpre) / (mx - mpre)
        ok = pre < mx
        gi_each = np.where(ok, (post - pre) / np.where(ok, mx - pre, 1.0), 0.0)
        cnt = ok.sum(axis=-1)
        gi = np.where(cnt > 0, gi_each.sum(axis=-1) / np.maximum(cnt, 1), np.nan)
        c = np.where(post > pre, (post - pre) / np.where(mx - pre == 0, 1.0, mx - pre),
                     np.where(post < pre, (post - pre) / np.where(pre == 0, 1.0, pre), 0.0))
        keep = ~((post == pre) & ((pre == mx) | (pre == 0)))
        kc = keep.sum(axis=-1)
        cm = np.where(kc > 0, np.where(keep, c, 0.0).sum(axis=-1) / np.maximum(kc, 1), np.nan)
    return np.stack([gc, gi, cm], axis=-1)


def normalized_gain_block(pre, post, mx, level, seed, iterations) -> list[es.Estimate]:
    """Estimates + boot::boot ordinary percentile CIs (index matrix R x n, column-major, as boot)."""
    n = len(pre)
    t0 = normalized_gains(pre, post, mx)
    idx = RRandom(seed).index(n, n * iterations).reshape(n, iterations).T
    tb = normalized_gains(pre[idx], post[idx], mx)
    out = []
    for j in range(3):
        if not finite(float(t0[j])):
            out.append(es.Estimate(None, None, None, level))
            continue
        lo, hi = _perc_ci(tb[:, j], level)
        out.append(es.Estimate(float(t0[j]), lo, hi, level))
    return out


_NG_KEYS = [("g_class", "Normalized gain, class average (Hake's g)", "g"),
            ("g_individual", "Average of individual normalized gains", "g_ind"),
            ("normalized_change", "Normalized change (Marx & Cummings c)", "c")]


def _ng_effect(b: ResultBuilder, key, label, sym, est, term=None):
    b.effect(key, label, sym, est, None, term)
    band = hake_band(est.value)
    if band and key != "normalized_change":
        mag = "negligible" if est.value < 0 else {"low": "small", "medium": "medium", "high": "large"}[band]
        b.effect_sizes[-1]["interpretation"] = {
            "magnitude": mag, "benchmark": "Hake (1998)",
            "text": f"By Hake's (1998) bands this is a {band} normalized gain (low < .30, medium .30-.70, high >= .70). "
                    "The bands come from physics courses; compare with similar courses and tests in your field."}


@register("education.normalized_gain", label="Normalized gain (Hake's g)", roles=_ROLES,
          options={"max_score": "Required: the highest possible score (e.g. 100).", "levels": _LEVELS_OPT,
                   "group_levels": "Wide layout with a group: the group order.",
                   "bootstrap_seed": "Seed for the bootstrap CIs (default 12345).",
                   "bootstrap_iterations": "Bootstrap resamples of people (default 2000)."})
def normalized_gain(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    require_two_sided(request, "The normalized gain interval")
    mx = request.options.get("max_score")
    if mx is None or not finite(float(mx)) or float(mx) <= 0:
        raise InvalidParams("Normalized gain needs the highest possible score (options.max_score), e.g. 100.")
    mx = float(mx)
    level = request.ci_level
    seed = int(request.options.get("bootstrap_seed", BOOT_SEED))
    iters = int(request.options.get("bootstrap_iterations", NG_ITERATIONS))
    d = prepost(df, request, meta)
    pre, post = d["pre"], d["post"]
    n = len(pre)
    if n < 2:
        raise InvalidParams(f"Normalized gain needs at least 2 people with both scores; there are {n}.")
    both = np.concatenate([pre, post])
    if np.any(both > mx) or np.any(both < 0):
        raise InvalidParams(f"Some scores are outside 0 to {apa.num(mx, 0) if mx.is_integer() else mx} (the maximum "
                            "score). Normalized gain assumes scores from 0 to the maximum; check max_score.")
    if np.mean(pre) >= mx:
        raise InvalidParams("Everyone started at the maximum score, so there was no room to gain.")
    b = ResultBuilder(request)
    ests = normalized_gain_block(pre, post, mx, level, seed, iters)
    for (key, lab, sym), est in zip(_NG_KEYS, ests):
        _ng_effect(b, key, lab, sym, est)
    groups = d["group"] or []
    rows_by = [("All", pre, post, ests)]
    for gr in groups:
        if len(gr["pre"]) < 2:
            raise InvalidParams(f"Group {gr['label']} has {len(gr['pre'])} people with both scores; each group needs 2 or more.")
        ge = normalized_gain_block(gr["pre"], gr["post"], mx, level, seed, iters)
        for (key, lab, sym), est in zip(_NG_KEYS, ge):
            _ng_effect(b, key, f"{lab} ({gr['label']})", sym, est, term=gr["label"])
        rows_by.append((gr["label"], gr["pre"], gr["post"], ge))
    if groups:
        cells = []
        for gr in groups:
            cells += [cell(d["variables"][0], gr["group"], f"{d['names'][0]} ({gr['label']})", gr["pre"], level, gr["n_missing"][0]),
                      cell(d["variables"][1], gr["group"], f"{d['names'][1]} ({gr['label']})", gr["post"], level, gr["n_missing"][1])]
        b.descriptives(cells)
    else:
        b.descriptives(_pair_cells(d, level))
    at_max = int(np.sum(pre >= mx))
    losses = int(np.sum(post < pre))
    with np.errstate(all="ignore"):
        g_each = np.where(pre < mx, (post - pre) / np.where(pre < mx, mx - pre, 1.0), np.nan)
    b.chart("individual_gains", [{"pre": float(a), "post": float(c), "g": float(g) if np.isfinite(g) else None}
                                 for a, c, g in zip(pre, post, g_each)])
    b.chart("normalized_gain_counts", [{"n_pairs": n, "n_pre_at_max": at_max, "n_losses": losses,
                                        "n_change_excluded": int(np.sum((post == pre) & ((pre == mx) | (pre == 0))))}])
    if at_max:
        b.warn(warning("pre_at_maximum", "info", f"{at_max} {'person' if at_max == 1 else 'people'} started at the maximum "
                       "score, so their individual normalized gain is undefined and they are left out of the average of "
                       "individual gains (they still count in the class-average g)."))
    if losses:
        b.warn(warning("negative_gains", "info", f"{losses} {'person' if losses == 1 else 'people'} scored lower after. "
                       "Hake's g divides a loss by the room to gain, so a small drop near the top can look like a large "
                       "negative g; Marx and Cummings' normalized change c divides losses by the pre score instead."))
    if n < SMALL_N:
        b.warn(warning("small_sample", "caution", f"Only {n} people have both scores, so the normalized gain is imprecise; "
                       "look at the interval."))
    _drop_note(b, d, n)
    b.inputs(n, d["n_excluded"], [(gr["group"], len(gr["pre"])) for gr in groups])

    gc, gi, cc = ests
    band = hake_band(gc.value)
    s = Rich().t(f"The class-average normalized gain was ").i("g").t(f" = {apa.no_zero(gc.value)}, "
                                                                      f"{apa.level_text(level)} CI {apa.ci_text(gc.lower, gc.upper, 2, True)}"
                                                                      f", a {band} gain (Hake, 1998); the average of individual gains was ") \
        .i("g").t(f" = {apa.no_zero(gi.value)} {apa.ci_text(gi.lower, gi.upper, 2, True)}.")
    gap = (gi.value - gc.value) if (gi.value is not None and gc.value is not None) else None
    summary = (f"Normalized gain asks what share of the possible improvement was achieved. The class moved from an "
               f"average of {apa.num(float(np.mean(pre)))} to {apa.num(float(np.mean(post)))} out of "
               f"{apa.num(mx, 0) if mx.is_integer() else mx}, which is {apa.num(100 * gc.value, 0)}% of the room it had to "
               f"improve (g = {apa.no_zero(gc.value)}, a {band} gain by Hake's bands).")
    if gap is not None and abs(gap) >= 0.05:
        summary += (f" The average of each person's own gain is {apa.no_zero(gi.value)}: "
                    + ("people who started higher tended to capture more of their room to improve."
                       if gap > 0 else "people who started lower tended to capture more of their room to improve."))
    for lab, *_rest, ge in rows_by[1:]:
        summary += f" {lab}: g = {apa.no_zero(ge[0].value)}."
    b.sentence(s).summary(summary)
    cols = [apa.column("g", "Group", "left"), apa.column("n", Rich().i("n")), apa.column("pre", Rich().i("M").t(" pre")),
            apa.column("post", Rich().i("M").t(" post")), apa.column("gc", Rich().i("g").t(" (class)")),
            apa.column("gcci", f"{apa.level_text(level)} CI"), apa.column("gi", Rich().i("g").t(" (individual)")),
            apa.column("gici", f"{apa.level_text(level)} CI"), apa.column("c", Rich().i("c")),
            apa.column("band", "Hake band", "left")]
    rows = [apa.row([apa.cell_text(lab), apa.cell_int(len(a)), apa.cell_num(float(np.mean(a))), apa.cell_num(float(np.mean(c))),
                     apa.cell_num(e[0].value, bounded=True), apa.cell_ci(e[0].lower, e[0].upper, 2, True),
                     apa.cell_num(e[1].value, bounded=True), apa.cell_ci(e[1].lower, e[1].upper, 2, True),
                     apa.cell_num(e[2].value, bounded=True), apa.cell_text(hake_band(e[0].value) or "")])
            for lab, a, c, e in rows_by]
    note = Rich().t(f"Maximum score = {apa.num(mx, 0) if mx.is_integer() else mx}. ").i("g").t(" (class) = (mean post - mean pre) / "
                                                                                             "(max - mean pre); ").i("g") \
        .t(f" (individual) = mean of each person's gain / (max - pre), excluding {at_max} at the maximum; ").i("c") \
        .t(f" = Marx and Cummings' (2007) normalized change. Percentile bootstrap CIs, {iters} resamples (seed {seed}).")
    b.table(apa.table("Normalized Gain", cols, rows, general_note=note))
    return b.build()
