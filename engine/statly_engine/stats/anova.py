"""One-way, Welch and repeated-measures ANOVA (SPEC §8). Reference: fixtures/r/anova.R.

Conventions (see also stats/README.md, "ANOVA"):
- anova.one_way: the classical F with Type III sums of squares and sum-to-zero contrasts
  (car::Anova(lm(y ~ g), type = 3) under contr.sum). With a single factor, Type I, II and III sums of
  squares are identical (SS_between = sum n_i (M_i - M)²), so the closed form is used. Welch's F
  (oneway.test(var.equal = FALSE)) is reported second. Effect sizes: eta² (headline; equal to partial
  eta² for one factor), omega², Cohen's f (effect_sizes_anova.one_way).
- anova.welch: Welch's F headline (oneway.test(var.equal = FALSE)), classical F second. Effect sizes
  from Welch's F and df as effectsize::effectsize(oneway.test(...)) does (F_to_eta2 / F_to_omega2 /
  F_to_f). A group with zero variance makes Welch's weights n / s² infinite: R returns NaN, Statly
  returns a null statistic with a constant_variable warning.
- Both: Levene's test (Brown-Forsythe, median-centred) and Shapiro-Wilk per group; descriptives per
  group; missing data pairwise (rows missing the outcome or the group are dropped and counted);
  groups with no scores are dropped with a warning.
- anova.repeated_measures: afex::aov_ez(within = time, type = 3) for one within factor. Complete
  cases only (wide: people with every measure; long: IDs with exactly one row at every level and no
  missing score), counts reported. Statistics: uncorrected F, Greenhouse-Geisser F and Huynh-Feldt F
  (HF epsilon capped at 1, as afex/SPSS do; see sphericity.py), plus epsilon_gg / epsilon_hf.
  Headline (options.correction = "auto", default): GG when Mauchly's p < alpha, otherwise the
  uncorrected F ("none", "gg", "hf" force one). Effect sizes: partial eta² (headline, SPSS), generalized
  eta² (afex `ges`), partial omega², Cohen's f (effect_sizes_anova.repeated_measures).
- All effect-size CIs are two-sided at ci_level (SPEC 95%); ANOVA F tests have no one-tailed form,
  so tails other than two_sided are rejected.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy import stats

from statly_engine.data.linking import normalize_id
from statly_engine.errors import InvalidParams
from statly_engine.stats import apa, assumptions as asm, effect_sizes_anova as esa, prep, sphericity as sph
from statly_engine.stats.apa import Rich
from statly_engine.stats.core import (SMALL_N, ResultBuilder, constant_warning, finite, magnitude, missing_warning,
                                      small_sample_warning, ties_warning, unequal_groups_warning, warning)
from statly_engine.stats.descriptives import cell
from statly_engine.stats.registry import Role, register

ETA = Rich().t("η").sup("2")
ETA_P = Rich().t("η").sup("2").sub("p")
ETA_G = Rich().t("η").sup("2").sub("G")
OMEGA = Rich().t("ω").sup("2")

BETWEEN_ROLES = [Role("outcome", 1, 1, "Scores to compare"),
                 Role("group", 1, 1, "Grouping variable with two or more groups")]
RM_ROLES = {"wide": [Role("measures", 2, None, "Score columns for the same people, in time order")],
            "long": [Role("outcome", 1, 1, "Scores"), Role("time", 1, 1, "Time point (two or more levels)"),
                     Role("subject_id", 1, 1, "Participant ID linking rows across time")]}
LEVELS_OPT = {"levels": "Group (or long-layout time) values to include, in display order."}


def p_phrase(p) -> str:
    s = apa.p_value(p)
    return f"p {s}" if s[0] in "<>" else f"p = {s}"


def require_two_sided(request, what: str) -> None:
    if request.tails.value != "two_sided":
        raise InvalidParams(f"{what} is always two-sided (it asks whether any means differ, in either "
                            "direction). Set tails to two-sided.")


# ---------------------------------------------------------------------------
# Between-subjects data
# ---------------------------------------------------------------------------
def between_data(df: pd.DataFrame, request, meta) -> dict:
    """Outcome split by group level. Pairwise missing: rows missing y or group are excluded."""
    yname, gname = request.variables["outcome"][0], request.variables["group"][0]
    vl, gl = prep.label(meta, yname), prep.label(meta, gname)
    y = prep.numeric(df, yname, meta)
    g = prep.categorical(df, gname, meta)
    levels = prep.level_order(g, gname, meta, request.options.get("levels"))
    raw, empty = [], []
    for lv in levels:
        vals = y[g.map(lambda v, lv=lv: prep._same(v, lv)).to_numpy(bool)].to_numpy()
        if np.isfinite(vals).any():
            raw.append(vals)
        else:
            empty.append(lv)
    levels = [lv for lv in levels if lv not in empty]
    if len(levels) < 2:
        found = ", ".join(prep.value_label(meta, gname, lv) for lv in levels) or "none"
        raise InvalidParams(f"Comparing groups needs at least two groups with scores, but {gl} has "
                            f"{len(levels)} ({found}).")
    xs = [a[np.isfinite(a)] for a in raw]
    n_used = int(sum(len(x) for x in xs))
    return dict(yname=yname, gname=gname, vl=vl, gl=gl, levels=levels,
                names=[prep.value_label(meta, gname, lv) for lv in levels], raw=raw, xs=xs,
                n_used=n_used, n_excluded=int(len(df) - n_used),
                empty=[prep.value_label(meta, gname, lv) for lv in empty])


def between_descriptives(b: ResultBuilder, d: dict, level: float) -> list[dict]:
    rows = [cell(d["yname"], {d["gname"]: lv}, nm, raw, level)
            for lv, nm, raw in zip(d["levels"], d["names"], d["raw"])]
    b.descriptives(rows)
    return rows


def between_warnings(b: ResultBuilder, d: dict) -> None:
    counts = dict(zip(d["names"], (len(x) for x in d["xs"])))
    b.warn(small_sample_warning(counts)).warn(unequal_groups_warning(counts))
    b.warn(ties_warning(np.concatenate(d["xs"]), d["vl"]))
    b.warn(missing_warning(d["n_excluded"]))
    if d["empty"]:
        b.warn(warning("empty_groups", "info", f"These groups have no {d['vl']} scores and were left out: "
                       + ", ".join(d["empty"]) + "."))


def classical_f(xs: list[np.ndarray]) -> dict:
    """One-way ANOVA table. Type I = II = III for a single factor."""
    n = np.array([len(x) for x in xs], float)
    means = np.array([np.mean(x) for x in xs])
    grand = float(np.sum(n * means) / np.sum(n))
    ss_b = float(np.sum(n * (means - grand) ** 2))
    ss_w = float(sum(np.sum((x - np.mean(x)) ** 2) for x in xs))
    df1, df2 = len(xs) - 1, int(np.sum(n)) - len(xs)
    f = p = None
    if df2 > 0 and ss_w > 0:
        f = (ss_b / df1) / (ss_w / df2)
        p = float(stats.f.sf(f, df1, df2))
    return dict(ss_b=ss_b, ss_w=ss_w, df1=df1, df2=df2, ms_b=ss_b / df1,
                ms_w=ss_w / df2 if df2 > 0 else None, f=f, p=p)


def welch_f(xs: list[np.ndarray]) -> tuple[float | None, float, float | None, float | None]:
    """Welch's F exactly as stats::oneway.test(var.equal = FALSE): (F, df1, df2, p)."""
    k = len(xs)
    n = np.array([len(x) for x in xs], float)
    if np.any(n < 2):
        return None, k - 1, None, None
    m = np.array([np.mean(x) for x in xs])
    v = np.array([np.var(x, ddof=1) for x in xs])
    if np.any(v <= 0):
        return None, k - 1, None, None
    w = n / v
    sw = float(np.sum(w))
    tmp = float(np.sum((1 - w / sw) ** 2 / (n - 1))) / (k * k - 1)
    mw = float(np.sum(w * m)) / sw
    f = float(np.sum(w * (m - mw) ** 2)) / ((k - 1) * (1 + 2 * (k - 2) * tmp))
    df2 = 1 / (3 * tmp)
    return f, k - 1, df2, float(stats.f.sf(f, k - 1, df2))


def between_assumptions(b: ResultBuilder, d: dict, alpha: float, failed_note: str) -> None:
    for x, nm, lv in zip(d["xs"], d["names"], d["levels"]):
        res, charts = asm.shapiro_wilk(x, asm.scope("group", nm, {d["gname"]: lv}), alpha)
        b.assumption(res, charts)
    lev, _ = asm.levene_brown_forsythe(dict(zip(d["names"], d["xs"])), asm.scope("overall", "all groups"),
                                       alpha, failed_note=failed_note)
    b.assumption(lev)


def descriptives_table(title: str, rows: list[dict], first_header: str, level: float, number: int = 2) -> dict:
    cols = [apa.column("group", first_header, "left"), apa.column("n", Rich().i("n")),
            apa.column("m", Rich().i("M")), apa.column("sd", Rich().i("SD")),
            apa.column("ci", f"{apa.level_text(level)} CI of the mean")]
    body = [apa.row([apa.cell_text(r["label"]), apa.cell_int(r["n"]), apa.cell_num(r["mean"]),
                     apa.cell_num(r["sd"]), apa.cell_ci(*((r["ci"]["lower"], r["ci"]["upper"]) if r["ci"]
                                                          else (None, None)))]) for r in rows]
    return apa.table(title, cols, body, number=number)


def _size_sentence(est, family: str = "eta_sq") -> str:
    mag = magnitude(est.value, family)
    return f" The size of the effect was {mag} by common benchmarks." if mag else ""


def _range_phrase(rows: list[dict]) -> str:
    valid = [r for r in rows if r["mean"] is not None]
    hi = max(valid, key=lambda r: r["mean"])
    lo = min(valid, key=lambda r: r["mean"])
    return f"highest: {hi['label']}, {apa.num(hi['mean'])}; lowest: {lo['label']}, {apa.num(lo['mean'])}"


# ---------------------------------------------------------------------------
# One-way and Welch ANOVA
# ---------------------------------------------------------------------------
def _oneway(df: pd.DataFrame, request, meta, variant: str) -> dict:
    require_two_sided(request, "An ANOVA")
    level, alpha = request.ci_level, request.alpha
    d = between_data(df, request, meta)
    xs, k = d["xs"], len(d["xs"])
    b = ResultBuilder(request)
    rows = between_descriptives(b, d, level)
    cf = classical_f(xs)
    wf, wdf1, wdf2, wp = welch_f(xs)
    classic = ("F", "F (equal variances assumed)", "F", cf["f"], [cf["df1"], cf["df2"]], cf["p"])
    welch = ("welch_F", "Welch's F", "F", wf, [wdf1, wdf2] if wf is not None else [], wp)
    order = [classic, welch] if variant == "classic" else [welch, classic]
    for key, lab, sym, v, dfs, p in order:
        b.statistic(key, lab, sym, v, dfs if v is not None else [], p)
    head = order[0]
    f, dfs, p = head[3], head[4], head[5]

    if variant == "classic":
        effects = esa.one_way(cf["ss_b"], cf["ss_w"], cf["df1"], cf["df2"], level) if cf["f"] is not None \
            else esa.from_f(None, cf["df1"], None, level)
    else:
        effects = esa.from_f(wf, wdf1, wdf2, level)
    b.effect("eta_sq", "Eta squared", "η²", effects["eta_sq"], "eta_sq", what="effect")
    b.effect("omega_sq", "Omega squared", "ω²", effects["omega_sq"], "eta_sq", what="effect")
    b.effect("cohens_f", "Cohen's f", "f", effects["cohens_f"], "cohens_f", what="effect")

    note = ("Welch's ANOVA does not assume equal spread, so it is still appropriate." if variant == "welch" else
            "The standard ANOVA assumes equal spread; Welch's ANOVA (also reported) does not and is the "
            "safer result here.")
    between_assumptions(b, d, alpha, note)
    between_warnings(b, d)
    if f is None:
        if variant == "welch" and cf["f"] is not None:
            b.warn(warning("constant_variable", "serious",
                           "At least one group's scores are all the same (or it has fewer than 2 scores), so "
                           "Welch's F can't be calculated: it weights each group by 1 / its variance. The "
                           "standard F test is shown instead, but read it with care."))
        else:
            b.warn(constant_warning(f"{d['vl']} within every group"))
    b.inputs(d["n_used"], d["n_excluded"], [({d["gname"]: lv}, len(x)) for lv, x in zip(d["levels"], xs)])

    test_name = "one-way ANOVA" if variant == "classic" else "Welch's one-way ANOVA"
    eta = effects["eta_sq"]
    r = Rich().t(f"{'A one-way ANOVA' if variant == 'classic' else 'Welch' + chr(39) + 's one-way ANOVA'} ")
    if f is None:
        r.t(f"could not be computed for {d['vl']} across the groups of {d['gl']}.")
        summary = (f"The {test_name} could not be calculated because {d['vl']} scores do not vary within the "
                   "groups" + (" (at least one group has identical scores)." if variant == "welch" else "."))
    else:
        sig = p < alpha
        r.t(f"showed that {d['vl']} scores {'differed significantly' if sig else 'did not differ significantly'} "
            f"across the {k} groups of {d['gl']}, ").stat("F", dfs, f).t(", ").p(p)
        if eta.value is not None:
            r.t(", ").es(ETA, eta.value, eta.lower, eta.upper, level, bounded=True)
        r.t(".")
        summary = (f"Average {d['vl']} scores were compared across the {k} groups of {d['gl']} ({_range_phrase(rows)}). "
                   + ("Differences this large are unlikely to be due to chance alone" if sig else
                      "The differences could easily be due to chance, so there is no strong evidence that the "
                      "groups really differ") + f" ({p_phrase(p)})." + _size_sentence(eta)
                   + (" A post hoc test shows which groups differ." if sig and k > 2 else ""))
    b.sentence(r).summary(summary)

    if variant == "classic":
        cols = [apa.column("source", "Source", "left"), apa.column("ss", Rich().i("SS")),
                apa.column("df", Rich().i("df")), apa.column("ms", Rich().i("MS")), apa.column("f", Rich().i("F")),
                apa.column("p", Rich().i("p")), apa.column("eta", ETA), apa.column("ci", f"{apa.level_text(level)} CI")]
        body = [apa.row([apa.cell_text(d["gl"]), apa.cell_num(cf["ss_b"]), apa.cell_df(cf["df1"]),
                         apa.cell_num(cf["ms_b"]), apa.cell_num(cf["f"]), apa.cell_p(cf["p"]),
                         apa.cell_num(eta.value, bounded=True), apa.cell_ci(eta.lower, eta.upper, bounded=True)]),
                apa.row([apa.cell_text("Within groups"), apa.cell_num(cf["ss_w"]), apa.cell_df(cf["df2"]),
                         apa.cell_num(cf["ms_w"]), apa.cell_empty(), apa.cell_empty(), apa.cell_empty(),
                         apa.cell_empty()]),
                apa.row([apa.cell_text("Total"), apa.cell_num(cf["ss_b"] + cf["ss_w"]),
                         apa.cell_df(cf["df1"] + cf["df2"]), apa.cell_empty(), apa.cell_empty(), apa.cell_empty(),
                         apa.cell_empty(), apa.cell_empty()])]
        gnote = Rich().t("Type III sums of squares. ").extend(ETA).t(" = eta squared. Welch's test: ")
        if wf is not None:
            gnote.stat("F", [wdf1, wdf2], wf).t(", ").p(wp).t(".")
        else:
            gnote.t("not available (a group has no spread).")
        b.table(apa.table(f"One-Way ANOVA of {d['vl']} by {d['gl']}", cols, body, general_note=gnote))
    else:
        cols = [apa.column("test", "Test", "left"), apa.column("f", Rich().i("F")),
                apa.column("df1", Rich().i("df").sub("1")), apa.column("df2", Rich().i("df").sub("2")),
                apa.column("p", Rich().i("p"))]
        body = [apa.row([apa.cell_text(lab if key != "F" else "Standard F"), apa.cell_num(v),
                         apa.cell_df(dd[0] if dd else None), apa.cell_df(dd[1] if dd else None), apa.cell_p(pp)])
                for key, lab, _, v, dd, pp in order]
        gnote = Rich().t("Welch's F does not assume equal variances. ").extend(ETA).t(" computed from Welch's ") \
            .i("F").t(": ").t(apa.no_zero(eta.value)) \
            .t(f", {apa.level_text(level)} CI {apa.ci_text(eta.lower, eta.upper, bounded=True)}.")
        b.table(apa.table(f"Welch's ANOVA of {d['vl']} by {d['gl']}", cols, body, general_note=gnote))
    b.extra_table(descriptives_table(f"Descriptive Statistics for {d['vl']} by {d['gl']}", rows, d["gl"], level))
    return b.build()


@register("anova.one_way", label="One-way ANOVA", roles=BETWEEN_ROLES, options=LEVELS_OPT)
def one_way(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    return _oneway(df, request, meta, "classic")


@register("anova.welch", label="Welch's ANOVA", roles=BETWEEN_ROLES, options=LEVELS_OPT)
def welch(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    return _oneway(df, request, meta, "welch")


# ---------------------------------------------------------------------------
# Repeated-measures data (wide or long; complete cases)
# ---------------------------------------------------------------------------
def _rm_wide(df, request, meta) -> dict:
    cols = request.variables["measures"]
    if len(set(cols)) != len(cols):
        raise InvalidParams("Each measure can be chosen only once.")
    xs = [prep.numeric(df, c, meta) for c in cols]
    cc = np.all([x.notna().to_numpy() for x in xs], axis=0)
    names = [prep.label(meta, c) for c in cols]
    dropped = int((~cc).sum())
    notes = [f"{dropped} people were left out because they are missing at least one of the measures"] if dropped else []
    return dict(y=np.column_stack([x[cc].to_numpy() for x in xs]), names=names, variables=list(cols),
                groups=[{} for _ in cols], n_missing=[int(x.isna().sum()) for x in xs], n_excluded=dropped,
                notes=notes, outcome_label=", ".join(names), time_label="time point")


def _rm_long(df, request, meta) -> dict:
    yname = request.variables["outcome"][0]
    tname = request.variables["time"][0]
    sname = request.variables["subject_id"][0]
    y = prep.numeric(df, yname, meta)
    tcol = prep.categorical(df, tname, meta)
    levels = prep.level_order(tcol, tname, meta, request.options.get("levels"))
    k = len(levels)
    if k < 2:
        raise InvalidParams(f"A repeated-measures comparison needs at least two time points, but "
                            f"{prep.label(meta, tname)} has {k}.")
    link = (meta or {}).get("link") or {}
    norm = (link.get("normalization") if link.get("mode") == "linked" and link.get("id_variable") == sname
            else None) or {"trim_whitespace": True, "case_insensitive": False}
    ids = prep.categorical(df, sname, meta).map(
        lambda v: None if v is None else normalize_id(v, norm["trim_whitespace"], norm["case_insensitive"]))
    at = [tcol.map(lambda v, lv=lv: prep._same(v, lv)).to_numpy(bool) for lv in levels]
    lvl = np.full(len(df), -1)
    for j, m in enumerate(at):
        lvl[m] = j
    in_levels = lvl >= 0
    frame = pd.DataFrame({"id": ids.to_numpy(), "lvl": lvl, "y": y.to_numpy()})[in_levels]
    no_id = int(frame["id"].isna().sum())
    frame = frame[frame["id"].notna()]
    counts = frame.groupby(["id", "lvl"]).size().unstack(fill_value=0).reindex(columns=range(k), fill_value=0)
    dup = counts[(counts > 1).any(axis=1)].index
    partial = counts[(counts == 0).any(axis=1) & ~counts.index.isin(dup)].index
    ok = counts[(counts == 1).all(axis=1)].index
    wide = frame[frame["id"].isin(ok)].pivot(index="id", columns="lvl", values="y").sort_index()
    wide = wide.reindex(columns=range(k))
    cc = wide.notna().all(axis=1)
    n = int(cc.sum())
    notes = []
    if len(partial):
        notes.append(f"{len(partial)} people do not have a row at every time point")
    if len(dup):
        notes.append(f"{len(dup)} IDs appear more than once at the same time point, so their scores can't be matched")
    if int((~cc).sum()):
        notes.append(f"{int((~cc).sum())} matched people are missing a {prep.label(meta, yname)} score")
    if no_id:
        notes.append(f"{no_id} rows have no ID")
    return dict(y=wide.loc[cc].to_numpy(float), names=[prep.value_label(meta, tname, lv) for lv in levels],
                variables=[yname] * k, groups=[{tname: lv} for lv in levels],
                n_missing=[int(y[m].isna().sum()) for m in at], n_excluded=int(in_levels.sum() - k * n),
                notes=notes, outcome_label=prep.label(meta, yname), time_label=prep.label(meta, tname))


def rm_data(df: pd.DataFrame, request, meta) -> dict:
    d = _rm_wide(df, request, meta) if "measures" in request.variables else _rm_long(df, request, meta)
    n = d["y"].shape[0]
    if n < 2:
        raise InvalidParams(f"A repeated-measures comparison needs at least 2 people with every score; there are {n}.")
    return d


def rm_descriptives(b: ResultBuilder, d: dict, level: float) -> list[dict]:
    rows = [cell(v, g, nm, d["y"][:, j], level, d["n_missing"][j])
            for j, (v, g, nm) in enumerate(zip(d["variables"], d["groups"], d["names"]))]
    b.descriptives(rows)
    return rows


def rm_warnings(b: ResultBuilder, d: dict) -> None:
    n = d["y"].shape[0]
    if n < SMALL_N:
        b.warn(warning("small_sample", "caution", f"Only {n} people have every score. With fewer than {SMALL_N}, "
                       "results are less precise and depend more on the scores being roughly bell-shaped, so "
                       "check the plots."))
    b.warn(ties_warning(d["y"].ravel(), d["outcome_label"]))
    if d["notes"]:
        b.warn(warning("pairs_dropped", "info", "Repeated-measures tests need the same person at every time point, "
                       "so some people were left out: " + "; ".join(d["notes"]) + f". {n} complete people were analysed."))


def rm_inputs(b: ResultBuilder, d: dict) -> None:
    n = d["y"].shape[0]
    b.inputs(n, d["n_excluded"], [(g, n) for g in d["groups"]] if d["groups"][0] else [])


def rm_anova_table(y: np.ndarray) -> dict:
    """Sums of squares for one within factor (identical under Type I/II/III)."""
    n, k = y.shape
    grand = float(np.mean(y))
    ss_time = float(n * np.sum((y.mean(axis=0) - grand) ** 2))
    ss_subj = float(k * np.sum((y.mean(axis=1) - grand) ** 2))
    ss_tot = float(np.sum((y - grand) ** 2))
    ss_err = max(0.0, ss_tot - ss_time - ss_subj)
    df1, df2 = k - 1, (n - 1) * (k - 1)
    f = p = None
    if ss_err > 1e-12 * max(1.0, ss_tot):
        f = (ss_time / df1) / (ss_err / df2)
        p = float(stats.f.sf(f, df1, df2))
    return dict(ss_time=ss_time, ss_subj=ss_subj, ss_err=ss_err, df1=df1, df2=df2, f=f, p=p)


CORRECTIONS = {"auto", "none", "gg", "hf"}


@register("anova.repeated_measures", label="Repeated-measures ANOVA", roles=RM_ROLES,
          options={"correction": "\"auto\" (default: Greenhouse-Geisser when Mauchly's test is significant), "
                                 "\"none\", \"gg\" or \"hf\": which F is the headline; all are reported.",
                   **LEVELS_OPT})
def repeated_measures(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    require_two_sided(request, "A repeated-measures ANOVA")
    level, alpha = request.ci_level, request.alpha
    correction = str(request.options.get("correction") or "auto").lower()
    if correction not in CORRECTIONS:
        raise InvalidParams("options.correction must be \"auto\", \"none\", \"gg\" or \"hf\".")
    d = rm_data(df, request, meta)
    y = d["y"]
    n, k = y.shape
    b = ResultBuilder(request)
    rows = rm_descriptives(b, d, level)
    t = rm_anova_table(y)
    s = sph.sphericity(y)
    used = correction
    if correction == "auto":
        used = "gg" if (s.p is not None and s.p < alpha) else "none"
    f, df1, df2 = t["f"], t["df1"], t["df2"]
    ok = f is not None and math.isfinite(s.gg)

    def corrected(eps):
        if not ok:
            return None, []
        return float(stats.f.sf(f, df1 * eps, df2 * eps)), [df1 * eps, df2 * eps]

    p_gg, df_gg = corrected(s.gg)
    p_hf, df_hf = corrected(s.hf)
    recs = {"none": ("F", "F (sphericity assumed)", t["p"], [df1, df2] if f is not None else []),
            "gg": ("F_gg", "F (Greenhouse-Geisser)", p_gg, df_gg),
            "hf": ("F_hf", "F (Huynh-Feldt)", p_hf, df_hf)}
    for c in [used] + [c for c in ("none", "gg", "hf") if c != used]:
        key, lab, p, dfs = recs[c]
        b.statistic(key, lab, "F", f, dfs, p)
    b.statistic("epsilon_gg", "Greenhouse-Geisser epsilon", "ε", s.gg)
    b.statistic("epsilon_hf", "Huynh-Feldt epsilon (capped at 1)", "ε", s.hf)
    _, _, p_head, df_head = recs[used]

    es = esa.repeated_measures(t["ss_time"], t["ss_subj"], t["ss_err"], df1, df2, n, level) if f is not None \
        else esa.repeated_measures(0.0, 0.0, 0.0, df1, df2, 0, level)
    b.effect("partial_eta_sq", "Partial eta squared", "η²p", es["partial_eta_sq"], "eta_sq", what="effect")
    b.effect("generalized_eta_sq", "Generalized eta squared", "η²G", es["generalized_eta_sq"], "eta_sq", what="effect")
    b.effect("omega_sq", "Partial omega squared", "ω²p", es["omega_sq"], "eta_sq", what="effect")
    b.effect("cohens_f", "Cohen's f", "f", es["cohens_f"], "cohens_f", what="effect")

    b.assumption(sph.assumption(s, k, n, alpha, used))
    for j, (nm, g) in enumerate(zip(d["names"], d["groups"])):
        res, charts = asm.shapiro_wilk(y[:, j], asm.scope("group", nm, g or None), alpha)
        b.assumption(res, charts)
    rm_warnings(b, d)
    if f is None:
        b.warn(constant_warning("the changes between time points"))
    rm_inputs(b, d)

    corr_txt = {"none": "", "gg": "with a Greenhouse-Geisser correction ",
                "hf": "with a Huynh-Feldt correction "}[used]
    pes = es["partial_eta_sq"]
    r = Rich().t(f"A repeated-measures ANOVA {corr_txt}")
    if f is None:
        r.t("could not be computed because every person changed by exactly the same amount.")
        summary = "Every person's scores changed in exactly the same way, so there is no variation to test."
    else:
        sig = p_head < alpha
        r.t(f"showed that {d['outcome_label']} scores {'differed significantly' if sig else 'did not differ significantly'} "
            f"across the {k} {'measures' if not d['groups'][0] else d['time_label'] + ' points'}, ") \
            .stat("F", df_head, f).t(", ").p(p_head)
        if pes.value is not None:
            r.t(", ").es(ETA_P, pes.value, pes.lower, pes.upper, level, bounded=True)
        r.t(".")
        summary = (f"The same {n} people were measured {k} times ({_range_phrase(rows)}). "
                   + ("The changes over time are unlikely to be due to chance alone" if sig else
                      "The differences could easily be due to chance, so there is no strong evidence of real "
                      "change over time") + f" ({p_phrase(p_head)})." + _size_sentence(pes)
                   + (" Pairwise comparisons show which time points differ." if sig and k > 2 else ""))
        if used == "gg" and correction == "auto":
            summary += (" Because the spread of changes differed between time points, a correction "
                        "(Greenhouse-Geisser) was applied.")
    b.sentence(r).summary(summary)

    cols = [apa.column("source", "Source", "left"), apa.column("ss", Rich().i("SS")), apa.column("df", Rich().i("df")),
            apa.column("ms", Rich().i("MS")), apa.column("f", Rich().i("F")), apa.column("p", Rich().i("p")),
            apa.column("eta", ETA_P), apa.column("ci", f"{apa.level_text(level)} CI")]
    src = d["time_label"].capitalize() if d["groups"][0] else "Time"
    blank = apa.cell_empty
    body = [apa.row([apa.cell_text(src), apa.cell_num(t["ss_time"]), apa.cell_df(df1), apa.cell_num(t["ss_time"] / df1),
                     apa.cell_num(f), apa.cell_p(t["p"]), apa.cell_num(pes.value, bounded=True),
                     apa.cell_ci(pes.lower, pes.upper, bounded=True)])]
    for c, lab, p, dfs in (("gg", "Greenhouse-Geisser", p_gg, df_gg), ("hf", "Huynh-Feldt", p_hf, df_hf)):
        body.append(apa.row([apa.cell_text(lab), blank(), apa.cell_df(dfs[0] if dfs else None), blank(), apa.cell_num(f),
                             apa.cell_p(p), blank(), blank()], indent=1))
    body.append(apa.row([apa.cell_text("Error"), apa.cell_num(t["ss_err"]), apa.cell_df(df2),
                         apa.cell_num(t["ss_err"] / df2 if df2 else None), blank(), blank(), blank(), blank()]))
    gnote = Rich().t("Type III sums of squares. ").extend(ETA_P).t(" = partial eta squared; generalized ") \
        .extend(ETA_G).t(f" = {apa.no_zero(es['generalized_eta_sq'].value)}. ")
    if s.w is not None:
        gnote.t("Mauchly's ").i("W").t(f" = {apa.num(s.w)}, ").p(s.p).t("; ")
    gnote.i("ε").t(f" (Greenhouse-Geisser) = {apa.num(s.gg)}, ").i("ε").t(f" (Huynh-Feldt) = {apa.num(s.hf)}.")
    b.table(apa.table(f"Repeated-Measures ANOVA of {d['outcome_label']}", cols, body, general_note=gnote))
    b.extra_table(descriptives_table(f"Descriptive Statistics for {d['outcome_label']} at Each Time Point", rows,
                                     "Time point", level))
    return b.build()
