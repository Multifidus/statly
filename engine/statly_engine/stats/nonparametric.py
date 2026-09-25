"""Nonparametric tests (SPEC §8): Mann-Whitney U, Wilcoxon signed-rank (paired and one-sample),
sign test, Kruskal-Wallis and Friedman. Reference: fixtures/r/nonparametric.R.

Conventions (see also stats/README.md, "Nonparametric"):
- p-values follow R 4.6 `wilcox.test` defaults: exact when n < 50 (Mann-Whitney: both groups < 50),
  using the exact *conditional* distribution when there are ties or zeros (R >= 4.4); otherwise the
  normal approximation with tie-corrected variance and continuity correction. The first statistic's
  label says which was used.
- U is R's W for the first group (group order: options.levels > value labels > sorted values);
  V is the sum of positive signed ranks of x - y (or x - test_value).
- Zero differences: the normal approximation drops them before ranking (R). The exact path ranks
  |d| including zeros and leaves zeros out of the null distribution, exactly as R's exact code does.
- z (reported next to U / V) is the normal approximation without continuity correction, zeros
  dropped; r = z / sqrt(N) with N = n1 + n2 (Mann-Whitney) or the number of nonzero differences.
- Sign test: exact binomial on the number of positive differences among the nonzero ones
  (binom.test(k, n, 0.5)); effect size = proportion positive with the Clopper-Pearson CI.
- Kruskal-Wallis / Friedman: tie-corrected chi-square statistics (kruskal.test / friedman.test).
  Friedman uses complete cases, wide (`measures`) or long (`outcome` + `time` + `subject_id`).
- Effect sizes: see effect_sizes_rank.py (rank-biserial, r, epsilon², Kendall's W).
- Missing data: pairwise for independent groups; paired / repeated designs use complete cases.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats

from statly_engine.data.linking import normalize_id
from statly_engine.errors import InvalidParams
from statly_engine.stats import apa, effect_sizes_rank as esr, prep
from statly_engine.stats.apa import Rich
from statly_engine.stats.core import (SMALL_N, ResultBuilder, constant_warning, finite, magnitude, missing_warning,
                                      small_sample_warning, unequal_groups_warning, warning)
from statly_engine.stats.descriptives import cell
from statly_engine.stats.effect_sizes import Estimate
from statly_engine.stats.registry import Role, register

_SIZE = {"negligible": "negligible", "small": "small", "medium": "medium", "large": "large"}
PAIRED_ROLES = {"wide": [Role("measures", 2, 2, "Two score columns for the same people (e.g. pre, post)")],
                "long": [Role("outcome", 1, 1, "Scores"), Role("time", 1, 1, "Time point with two levels"),
                         Role("subject_id", 1, 1, "Participant ID linking rows across time")]}
REPEATED_ROLES = {"wide": [Role("measures", 2, None, "Score columns for the same people (e.g. three time points)")],
                  "long": [Role("outcome", 1, 1, "Scores"), Role("time", 1, 1, "Time point / condition"),
                           Role("subject_id", 1, 1, "Participant ID linking rows across time")]}
BOOT_OPTIONS = {"bootstrap_seed": f"Seed for the bootstrap CI (default {esr.BOOT_SEED}; R: set.seed).",
                "bootstrap_iterations": f"Bootstrap resamples for the CI (default {esr.BOOT_ITERATIONS}, as effectsize)."}


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------
def p_phrase(p) -> str:
    s = apa.p_value(p)
    return f"p {s}" if s[0] in "<>" else f"p = {s}"


def tail_note(request, first: str, second: str) -> str | None:
    alt = request.tails.value
    if alt == "two_sided":
        return None
    return f"One-tailed test (alternative: {first} tends to be {'higher' if alt == 'greater' else 'lower'} than {second})."


def size_sentence(value, family: str, what: str = "difference") -> str:
    mag = magnitude(value, family)
    return f" The size of the {what} was {_SIZE[mag]} by common benchmarks." if mag else ""


def boot_settings(request) -> tuple[int, int]:
    o = request.options
    seed = int(o.get("bootstrap_seed", esr.BOOT_SEED))
    iters = int(o.get("bootstrap_iterations", esr.BOOT_ITERATIONS))
    if iters < 20:
        raise InvalidParams("options.bootstrap_iterations must be at least 20.")
    return seed, iters


def mdn_run(d: dict, name: str) -> Rich:
    return Rich().t(f"{name} (").i("Mdn").t(f" = {apa.num(d['median'])})")


def groups_data(df, request, meta, exactly: int | None, what: str) -> dict:
    """Outcome by group (independent samples), levels in prep.level_order order."""
    yname, gname = request.variables["outcome"][0], request.variables["group"][0]
    y = prep.numeric(df, yname, meta)
    g = prep.categorical(df, gname, meta)
    levels = prep.level_order(g, gname, meta, request.options.get("levels"))
    gl = prep.label(meta, gname)
    names = [prep.value_label(meta, gname, lv) for lv in levels]
    if exactly is not None and len(levels) != exactly:
        found = ", ".join(names) or "none"
        raise InvalidParams(f"{what} compares exactly {exactly} groups, but {gl} has {len(levels)} ({found}). "
                            "Filter to two groups or choose them in the options.")
    if len(levels) < 2:
        raise InvalidParams(f"{what} needs at least 2 groups, but {gl} has {len(levels)}.")
    masks = [g.map(lambda v, lv=lv: prep._same(v, lv)).to_numpy(bool) for lv in levels]
    raw = [y[m].to_numpy() for m in masks]
    clean = [a[np.isfinite(a)] for a in raw]
    for nm, a in zip(names, clean):
        if len(a) == 0:
            raise InvalidParams(f"The {nm} group has no {prep.label(meta, yname)} scores.")
    n_used = int(sum(len(a) for a in clean))
    return dict(yname=yname, gname=gname, vl=prep.label(meta, yname), gl=gl, levels=levels, names=names,
                raw=raw, clean=clean, n_used=n_used, n_excluded=int(len(df) - n_used))


def repeated_data(df, request, meta, k_exact: int | None = None, what: str = "This test") -> dict:
    """Complete-case subjects x conditions matrix from the wide or long layout.

    Long layout: IDs are normalized like linked datasets; an ID is used when it has exactly one row at
    every level and no missing score. Subjects keep their order of first appearance (this order is what
    the bootstrap resamples, so it matches R's row order).
    """
    notes: list[str] = []
    if "measures" in request.variables:
        cols = request.variables["measures"]
        xs = [prep.numeric(df, c, meta) for c in cols]
        cc = np.logical_and.reduce([x.notna().to_numpy() for x in xs])
        names = [prep.label(meta, c) for c in cols]
        dropped = int((~cc).sum())
        if dropped:
            notes.append(f"{dropped} people were left out because they are missing at least one of "
                         + ", ".join(names))
        m = np.column_stack([x.to_numpy()[cc] for x in xs])
        return dict(m=m, names=names, variables=list(cols), groups=[{} for _ in cols],
                    n_missing=[int(x.isna().sum()) for x in xs], n_excluded=dropped, notes=notes,
                    outcome_label=" and ".join(names) if len(names) == 2 else ", ".join(names))
    yname = request.variables["outcome"][0]
    tname = request.variables["time"][0]
    sname = request.variables["subject_id"][0]
    y = prep.numeric(df, yname, meta)
    tcol = prep.categorical(df, tname, meta)
    levels = prep.level_order(tcol, tname, meta, request.options.get("levels"))
    tl = prep.label(meta, tname)
    if k_exact is not None and len(levels) != k_exact:
        raise InvalidParams(f"{what} compares exactly {k_exact} time points, but {tl} has {len(levels)}. "
                            "Filter to two or choose them in the options.")
    if len(levels) < 2:
        raise InvalidParams(f"{what} needs at least 2 time points, but {tl} has {len(levels)}.")
    k = len(levels)
    link = (meta or {}).get("link") or {}
    norm = (link.get("normalization") if link.get("mode") == "linked" and link.get("id_variable") == sname
            else None) or {"trim_whitespace": True, "case_insensitive": False}
    ids = prep.categorical(df, sname, meta).map(
        lambda v: None if v is None else normalize_id(v, norm["trim_whitespace"], norm["case_insensitive"]))
    at = [tcol.map(lambda v, lv=lv: prep._same(v, lv)).to_numpy(bool) for lv in levels]
    lvl = np.full(len(df), -1)
    for j, a in enumerate(at):
        lvl[a] = j
    in_levels = lvl >= 0
    frame = pd.DataFrame({"id": ids.to_numpy(), "lvl": lvl, "y": y.to_numpy()})[in_levels]
    no_id = int(frame["id"].isna().sum())
    frame = frame[frame["id"].notna()]
    order = list(pd.unique(frame["id"]))
    counts = frame.groupby(["id", "lvl"]).size().unstack(fill_value=0).reindex(index=order, columns=range(k),
                                                                              fill_value=0)
    dup = counts.index[(counts > 1).any(axis=1)]
    partial = counts.index[((counts == 0).any(axis=1)) & ~counts.index.isin(dup)]
    ok = set(counts.index[(counts == 1).all(axis=1)])
    wide = frame[frame["id"].isin(ok)].pivot(index="id", columns="lvl", values="y")
    wide = wide.reindex(index=[i for i in order if i in ok], columns=range(k))
    cc = wide.notna().all(axis=1).to_numpy()
    names = [prep.value_label(meta, tname, lv) for lv in levels]
    if len(partial):
        notes.append(f"{len(partial)} people do not have a row at every time point")
    if len(dup):
        notes.append(f"{len(dup)} IDs appear more than once at the same time point, so their scores can't be matched")
    if int((~cc).sum()):
        notes.append(f"{int((~cc).sum())} matched people are missing a {prep.label(meta, yname)} score")
    if no_id:
        notes.append(f"{no_id} rows have no ID")
    n = int(cc.sum())
    return dict(m=wide.to_numpy()[cc], names=names, variables=[yname] * k, groups=[{tname: lv} for lv in levels],
                n_missing=[int(y[a].isna().sum()) for a in at], n_excluded=int(in_levels.sum() - k * n), notes=notes,
                outcome_label=prep.label(meta, yname))


def dropped_warning(notes: list[str], n: int, what: str = "at every time point") -> dict | None:
    if not notes:
        return None
    return warning("pairs_dropped", "info", f"This test needs the same person {what}, so some people were "
                   "left out: " + "; ".join(notes) + f". {n} complete cases were analysed.")


def _rank_effects(b: ResultBuilder, r: Estimate, rb: Estimate) -> None:
    b.effect("r", "r (z / sqrt(N))", "r", r, "r")
    b.effect("rank_biserial", "Rank-biserial correlation", "r_rb", rb, "r")


def _es_clause(r: Rich, est: Estimate, sym="r") -> Rich:
    if est.value is not None:
        r.t(", ").es(sym, est.value, est.lower, est.upper, est.level, bounded=True)
    return r


def _p_label(test: dict) -> str:
    return "exact p" if test["exact"] else "normal approximation, continuity corrected"


# ---------------------------------------------------------------------------
# Mann-Whitney U
# ---------------------------------------------------------------------------
@register("mann_whitney", label="Mann-Whitney U test",
          roles=[Role("outcome", 1, 1, "Scores to compare (ordinal or numeric)"),
                 Role("group", 1, 1, "Grouping variable with exactly two groups")],
          options={"levels": "Two group values, in the order to compare (first vs second)."})
def mann_whitney(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    level, alt, alpha = request.ci_level, request.tails.value, request.alpha
    g = groups_data(df, request, meta, 2, "A Mann-Whitney U test")
    x1, x2 = g["clean"]
    names, levels, vl = g["names"], g["levels"], g["vl"]
    n1, n2 = len(x1), len(x2)

    b = ResultBuilder(request)
    d1 = cell(g["yname"], {g["gname"]: levels[0]}, names[0], g["raw"][0], level)
    d2 = cell(g["yname"], {g["gname"]: levels[1]}, names[1], g["raw"][1], level)
    b.descriptives([d1, d2])
    test = esr.ranksum_test(x1, x2, alt)
    constant = test["sigma"] == 0
    rb = esr.rank_biserial_independent(x1, x2, level, alt)
    rr = esr.r_from_z(test["z"], n1 + n2, rb, alt)
    if constant:
        b.warn(constant_warning(vl))
    b.statistic("u", f"Mann-Whitney U ({_p_label(test)})", "U", None if constant else test["w"], [],
                None if constant else test["p"])
    b.statistic("z", "z (normal approximation, no continuity correction)", "z", test["z"])
    _rank_effects(b, rr, rb)

    counts = {names[0]: n1, names[1]: n2}
    b.warn(small_sample_warning(counts)).warn(unequal_groups_warning(counts)).warn(missing_warning(g["n_excluded"]))
    b.inputs(n1 + n2, g["n_excluded"], [({g["gname"]: levels[0]}, n1), ({g["gname"]: levels[1]}, n2)])

    r = Rich().t("A Mann-Whitney ").i("U").t(" test ")
    if constant:
        r.t(f"could not be computed because every {vl} score was the same.")
        summary = f"Every {vl} score was the same, so the groups can't be compared."
    else:
        p, sig = test["p"], test["p"] < alpha
        up = (rb.value or 0) > 0
        if sig:
            r.t(f"showed that {vl} scores tended to be {'higher' if up else 'lower'} for ").extend(mdn_run(d1, names[0])) \
                .t(" than for ").extend(mdn_run(d2, names[1])).t(", ")
        else:
            r.t(f"showed no significant difference in {vl} scores between ").extend(mdn_run(d1, names[0])) \
                .t(" and ").extend(mdn_run(d2, names[1])).t(", ")
        r.stat("U", [], test["w"]).t(", ").stat("z", [], test["z"]).t(", ").p(p)
        _es_clause(r, rr).t(".")
        hi, lo = (names[0], names[1]) if up else (names[1], names[0])
        summary = (f"Scores in the {hi} group tended to be higher than in the {lo} group (medians "
                   f"{apa.num(d1['median'])} and {apa.num(d2['median'])} for {names[0]} and {names[1]}). "
                   + ("This difference is unlikely to be due to chance alone" if sig else
                      "This difference could easily be due to chance, so there is no strong evidence of a real "
                      "difference between the groups") + f" ({p_phrase(p)})." + size_sentence(rr.value, "r"))
    b.sentence(r).summary(summary)

    cols = [apa.column("variable", "Variable", "left")]
    for k in (1, 2):
        cols += [apa.column(f"n{k}", Rich().i("n")), apa.column(f"mdn{k}", Rich().i("Mdn")),
                 apa.column(f"iqr{k}", "IQR")]
    cols += [apa.column("u", Rich().i("U")), apa.column("z", Rich().i("z")), apa.column("p", Rich().i("p")),
             apa.column("r", Rich().i("r")), apa.column("ci", f"{apa.level_text(level)} CI")]
    row = apa.row([apa.cell_text(vl), apa.cell_int(n1), apa.cell_num(d1["median"]), apa.cell_num(d1["iqr"]),
                   apa.cell_int(n2), apa.cell_num(d2["median"]), apa.cell_num(d2["iqr"]),
                   apa.cell_num(None if constant else test["w"]), apa.cell_num(test["z"]),
                   apa.cell_p(None if constant else test["p"]), apa.cell_num(rr.value, bounded=True),
                   apa.cell_ci(rr.lower, rr.upper, bounded=True)])
    note = Rich().i("Mdn").t(" = median; IQR = interquartile range; ").i("r").t(" = ").i("z").t(
        f"/√N; CI = confidence interval for ").i("r").t(f". p-value: {test['method']}. Rank-biserial ").i("r") \
        .t(f" = {apa.no_zero(rb.value)}.")
    tail = tail_note(request, names[0], names[1])
    if tail:
        note.t(" " + tail)
    b.table(apa.table(f"Mann-Whitney U Test of {vl} by {g['gl']}", cols, [row],
                      column_groups=[apa.column_group(names[0], 1, 3), apa.column_group(names[1], 4, 3)],
                      general_note=note))
    return b.build()


# ---------------------------------------------------------------------------
# Wilcoxon signed-rank (paired) and one-sample
# ---------------------------------------------------------------------------
def _signed_rank_result(request, b: ResultBuilder, diffs: np.ndarray, first: str, second: str,
                        n_used: int, subject: str) -> tuple[dict, Estimate, Estimate]:
    level, alt = request.ci_level, request.tails.value
    test = esr.signrank_test(diffs, alt)
    rb = esr.rank_biserial_paired(diffs, level, alt)
    rr = esr.r_from_z(test["z"], test["n_nonzero"], rb, alt)
    constant = test["n_nonzero"] == 0
    if constant:
        b.warn(constant_warning(f"the differences ({first} - {second})"))
    b.statistic("v", f"Wilcoxon signed-rank V ({_p_label(test)})", "V", None if constant else test["v"], [],
                None if constant else test["p"])
    b.statistic("z", "z (normal approximation, no continuity correction)", "z", test["z"])
    _rank_effects(b, rr, rb)
    zeros = int(np.sum(diffs == 0))
    if zeros and not constant:
        b.warn(warning("zero_differences", "info",
                       f"{zeros} {subject} had no difference ({first} = {second}). As in R, they are left out of "
                       "the ranking for the z statistic and effect sizes."))
    if n_used < SMALL_N:
        b.warn(warning("small_sample", "caution", f"Only {n_used} {subject} were analysed. With fewer than "
                       f"{SMALL_N}, results are less precise, so interpret them with care."))
    return test, rb, rr


@register("wilcoxon_signed_rank", label="Wilcoxon signed-rank test", roles=PAIRED_ROLES,
          options={"levels": "Long layout: the two time values, in the order to compare (first minus second)."})
def wilcoxon_signed_rank(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    level, alpha = request.ci_level, request.alpha
    data = repeated_data(df, request, meta, 2, "A Wilcoxon signed-rank test")
    m, names = data["m"], data["names"]
    n = len(m)
    if n < 1:
        raise InvalidParams("A Wilcoxon signed-rank test needs at least 1 person with both scores; there are 0.")
    x, y = m[:, 0], m[:, 1]
    diffs = x - y
    b = ResultBuilder(request)
    d1 = cell(data["variables"][0], data["groups"][0], names[0], x, level, data["n_missing"][0])
    d2 = cell(data["variables"][1], data["groups"][1], names[1], y, level, data["n_missing"][1])
    b.descriptives([d1, d2])
    test, rb, rr = _signed_rank_result(request, b, diffs, names[0], names[1], n, "people")
    b.warn(dropped_warning(data["notes"], n, "at both times"))
    b.inputs(n, data["n_excluded"], [(data["groups"][0], n), (data["groups"][1], n)] if data["groups"][0] else [])

    up = (rb.value or 0) > 0
    hi, lo = (names[0], names[1]) if up else (names[1], names[0])
    r = Rich().t("A Wilcoxon signed-rank test ")
    if test["n_nonzero"]:
        sent = Rich().t(f"showed that scores were significantly {'higher' if up else 'lower'} at ") \
            .extend(mdn_run(d1, names[0])).t(" than at ").extend(mdn_run(d2, names[1])).t(", ")
        ns = Rich().t("showed no significant difference between ").extend(mdn_run(d1, names[0])).t(" and ") \
            .extend(mdn_run(d2, names[1])).t(", ")
        r.extend(sent if test["p"] < alpha else ns)
        r.stat("V", [], test["v"]).t(", ").stat("z", [], test["z"]).t(", ").p(test["p"])
        _es_clause(r, rr).t(".")
        summary = (f"For the {n} people with both scores, scores tended to be higher at {hi} than at {lo} "
                   f"(medians {apa.num(d1['median'])} and {apa.num(d2['median'])} for {names[0]} and {names[1]}). "
                   + ("This change is unlikely to be due to chance alone" if test["p"] < alpha else
                      "This change could easily be due to chance, so there is no strong evidence of a real change")
                   + f" ({p_phrase(test['p'])})." + size_sentence(rr.value, "r", "change"))
    else:
        r.t("could not be computed because every difference was zero.")
        summary = "Every person had exactly the same score both times, so there is no change to test."
    b.sentence(r).summary(summary)
    b.table(_signed_rank_table(request, data["outcome_label"], [(names[0], d1), (names[1], d2)], test, rr, rb, n,
                               f"Wilcoxon Signed-Rank Test of {names[0]} and {names[1]}", names[0], names[1]))
    return b.build()


def _signed_rank_table(request, label, descs, test, rr, rb, n, title, first, second) -> dict:
    level = request.ci_level
    cols = [apa.column("variable", "Variable", "left")]
    cells = [apa.cell_text(label)]
    for k, (_, d) in enumerate(descs, 1):
        cols += [apa.column(f"mdn{k}", Rich().i("Mdn")), apa.column(f"iqr{k}", "IQR")]
        cells += [apa.cell_num(d["median"]), apa.cell_num(d["iqr"])]
    ok = test["n_nonzero"] > 0
    cols += [apa.column("v", Rich().i("V")), apa.column("z", Rich().i("z")), apa.column("p", Rich().i("p")),
             apa.column("r", Rich().i("r")), apa.column("ci", f"{apa.level_text(level)} CI")]
    cells += [apa.cell_num(test["v"] if ok else None), apa.cell_num(test["z"]), apa.cell_p(test["p"] if ok else None),
              apa.cell_num(rr.value, bounded=True), apa.cell_ci(rr.lower, rr.upper, bounded=True)]
    note = Rich().i("n").t(f" = {n}; {test['n_nonzero']} nonzero differences. ").i("V").t(
        " = sum of the ranks of the positive differences; ").i("r").t(" = ").i("z").t("/√N; p-value: "
                                                                                     f"{test['method']}. Rank-biserial ").i("r") \
        .t(f" = {apa.no_zero(rb.value)}.")
    tail = tail_note(request, first, second)
    if tail:
        note.t(" " + tail)
    groups = [apa.column_group(nm, 1 + 2 * i, 2) for i, (nm, _) in enumerate(descs)]
    return apa.table(title, cols, [apa.row(cells)], column_groups=groups, general_note=note)


def _test_value(request) -> float:
    return float(request.options.get("test_value", request.options.get("mu", 0.0)))


def _mu_text(mu: float) -> str:
    return str(int(mu)) if float(mu).is_integer() else apa.num(mu)


@register("wilcoxon_one_sample", label="Wilcoxon one-sample signed-rank test",
          roles=[Role("outcome", 1, 1, "Scores to compare with a fixed value")],
          options={"test_value": "Value the scores are compared with (default 0)."})
def wilcoxon_one_sample(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    level, alpha = request.ci_level, request.alpha
    name = request.variables["outcome"][0]
    vl = prep.label(meta, name)
    mu = _test_value(request)
    x_all = prep.numeric(df, name, meta)
    x = x_all.dropna().to_numpy()
    n = len(x)
    if n < 1:
        raise InvalidParams(f"A Wilcoxon one-sample test needs at least 1 score; {vl} has none.")
    b = ResultBuilder(request)
    desc = cell(name, {}, vl, x_all.to_numpy(), level)
    b.descriptives([desc])
    mu_txt = _mu_text(mu)
    test, rb, rr = _signed_rank_result(request, b, x - mu, vl, mu_txt, n, "scores")
    b.warn(missing_warning(int(x_all.isna().sum())))
    b.inputs(n, int(x_all.isna().sum()))

    up = (rb.value or 0) > 0
    r = Rich().t(f"A Wilcoxon signed-rank test showed that {vl} scores (").i("Mdn").t(f" = {apa.num(desc['median'])}) ")
    if test["n_nonzero"] == 0:
        r = Rich().t(f"A Wilcoxon signed-rank test could not be computed because every {vl} score equals {mu_txt}.")
        summary = f"Every {vl} score equals {mu_txt}, so there is nothing to test."
    else:
        sig = test["p"] < alpha
        r.t(f"were significantly {'higher' if up else 'lower'} than {mu_txt}, " if sig else
            f"did not differ significantly from {mu_txt}, ")
        r.stat("V", [], test["v"]).t(", ").stat("z", [], test["z"]).t(", ").p(test["p"])
        _es_clause(r, rr).t(".")
        summary = (f"{vl} scores tended to be {'higher' if up else 'lower'} than {mu_txt} (median "
                   f"{apa.num(desc['median'])}). " +
                   ("This is unlikely to be due to chance alone" if sig else
                    f"This could easily be due to chance, so there is no strong evidence that the typical score "
                    f"differs from {mu_txt}") + f" ({p_phrase(test['p'])})." + size_sentence(rr.value, "r"))
    b.sentence(r).summary(summary)
    b.table(_signed_rank_table(request, vl, [(vl, desc)], test, rr, rb, n,
                               f"Wilcoxon One-Sample Test of {vl} Against {mu_txt}", vl, mu_txt))
    return b.build()


# ---------------------------------------------------------------------------
# Sign test
# ---------------------------------------------------------------------------
@register("sign_test", label="Sign test",
          roles={**PAIRED_ROLES, "one_sample": [Role("outcome", 1, 1, "Scores to compare with a fixed value")]},
          options={"levels": "Long layout: the two time values, in the order to compare (first minus second).",
                   "test_value": "One-sample layout: value the scores are compared with (default 0)."})
def sign_test(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    level, alt, alpha = request.ci_level, request.tails.value, request.alpha
    b = ResultBuilder(request)
    if "measures" in request.variables or "time" in request.variables:
        data = repeated_data(df, request, meta, 2, "A sign test")
        m, names = data["m"], data["names"]
        diffs = m[:, 0] - m[:, 1]
        first, second = names
        d1 = cell(data["variables"][0], data["groups"][0], names[0], m[:, 0], level, data["n_missing"][0])
        d2 = cell(data["variables"][1], data["groups"][1], names[1], m[:, 1], level, data["n_missing"][1])
        b.descriptives([d1, d2])
        n_excluded = data["n_excluded"]
        b.warn(dropped_warning(data["notes"], len(diffs), "at both times"))
        by_group = [(data["groups"][0], len(diffs)), (data["groups"][1], len(diffs))] if data["groups"][0] else []
        label = data["outcome_label"]
        subject = "people"
    else:
        name = request.variables["outcome"][0]
        vl = prep.label(meta, name)
        mu = _test_value(request)
        x_all = prep.numeric(df, name, meta)
        diffs = x_all.dropna().to_numpy() - mu
        first, second = vl, _mu_text(mu)
        b.descriptives([cell(name, {}, vl, x_all.to_numpy(), level)])
        n_excluded = int(x_all.isna().sum())
        b.warn(missing_warning(n_excluded))
        by_group, label, subject = [], vl, "scores"
    n = len(diffs)
    if n < 1:
        raise InvalidParams("A sign test needs at least 1 complete case; there are 0.")
    pos, neg = int(np.sum(diffs > 0)), int(np.sum(diffs < 0))
    nnz = pos + neg
    if nnz == 0:
        b.warn(constant_warning(f"the differences ({first} - {second})"))
        p, prop = None, Estimate(None, None, None, level)
    else:
        p = esr.binom_test_half(pos, nnz, alt)
        lo, hi = esr.clopper_pearson(pos, nnz, level, alt)
        prop = Estimate(pos / nnz, lo, hi, level)
    b.statistic("s", "Sign test S = number of positive differences (exact binomial p)", "S",
                pos if nnz else None, [], p)
    b.effect("prop_positive", f"Proportion of nonzero differences where {first} > {second}", "π+", prop)
    if nnz and nnz < n:
        b.warn(warning("zero_differences", "info", f"{n - nnz} {subject} had no difference ({first} = {second}) "
                       "and are not counted by the sign test."))
    if n < SMALL_N:
        b.warn(warning("small_sample", "caution", f"Only {n} {subject} were analysed, so the test has little "
                       "power to detect a difference."))
    b.inputs(n, n_excluded, by_group)

    r = Rich().t("An exact sign test ")
    if not nnz:
        r.t("could not be computed because every difference was zero.")
        summary = "Every difference was zero, so there is nothing to test."
    else:
        sig = p < alpha
        r.t(f"found that {first} was higher than {second} in {pos} of {nnz} cases with a difference (proportion "
            f"{apa.no_zero(prop.value)}, {apa.level_text(level)} CI {apa.ci_text(prop.lower, prop.upper, 2, True)}), "
            f"{'a significant' if sig else 'not a significant'} departure from an even split, ").p(p).t(".")
        summary = (f"{first} was higher than {second} in {pos} cases and lower in {neg} (ties left out). " +
                   ("A split this uneven is unlikely to be due to chance alone" if sig else
                    "A split like this could easily happen by chance") + f" ({p_phrase(p)}).")
    b.sentence(r).summary(summary)
    cols = [apa.column("variable", "Variable", "left"), apa.column("pos", "Positive"),
            apa.column("neg", "Negative"), apa.column("ties", "Ties"), apa.column("p", Rich().i("p")),
            apa.column("prop", "Proportion positive"), apa.column("ci", f"{apa.level_text(level)} CI")]
    row = apa.row([apa.cell_text(label), apa.cell_int(pos), apa.cell_int(neg), apa.cell_int(n - nnz), apa.cell_p(p),
                   apa.cell_num(prop.value, bounded=True), apa.cell_ci(prop.lower, prop.upper, bounded=True)])
    note = Rich().t(f"Differences are {first} minus {second}. Exact binomial test against .50; CI = Clopper-Pearson "
                    "interval for the proportion of positive differences.")
    tail = tail_note(request, first, second)
    if tail:
        note.t(" " + tail)
    b.table(apa.table(f"Sign Test of {first} and {second}", cols, [row], general_note=note))
    return b.build()


# ---------------------------------------------------------------------------
# Kruskal-Wallis
# ---------------------------------------------------------------------------
@register("kruskal_wallis", label="Kruskal-Wallis test",
          roles=[Role("outcome", 1, 1, "Scores to compare (ordinal or numeric)"),
                 Role("group", 1, 1, "Grouping variable with two or more groups")],
          options={"levels": "Group values to include, in display order.", **BOOT_OPTIONS})
def kruskal_wallis(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    level, alpha = request.ci_level, request.alpha
    seed, iters = boot_settings(request)
    g = groups_data(df, request, meta, None, "A Kruskal-Wallis test")
    names, levels, vl, clean = g["names"], g["levels"], g["vl"], g["clean"]
    k = len(levels)
    values = np.concatenate(clean)
    codes = np.concatenate([np.full(len(a), i) for i, a in enumerate(clean)])
    n = len(values)
    h = esr.kruskal_h(values, codes, k)
    p = float(stats.chi2.sf(h, k - 1)) if finite(h) else None

    b = ResultBuilder(request)
    descs = [cell(g["yname"], {g["gname"]: lv}, nm, raw, level) for lv, nm, raw in zip(levels, names, g["raw"])]
    b.descriptives(descs)
    if not finite(h):
        b.warn(constant_warning(vl))
    b.statistic("h", "Kruskal-Wallis H (chi-square approximation)", "H", h, [k - 1], p)
    eps = esr.rank_epsilon_squared(clean, level, seed, iters)
    b.effect("epsilon_sq", "Rank epsilon squared", "ε²", eps, "eta_sq", what="effect")
    counts = dict(zip(names, (len(a) for a in clean)))
    b.warn(small_sample_warning(counts)).warn(unequal_groups_warning(counts)).warn(missing_warning(g["n_excluded"]))
    if any(c < 5 for c in counts.values()):
        b.warn(warning("chi_square_approximation", "caution", "Some groups have fewer than 5 scores, so the "
                       "chi-square p-value of the Kruskal-Wallis test is only approximate."))
    b.inputs(n, g["n_excluded"], [({g["gname"]: lv}, len(a)) for lv, a in zip(levels, clean)])

    ranks = esr.rank(values)
    mean_ranks = [float(ranks[codes == i].mean()) for i in range(k)]
    r = Rich().t("A Kruskal-Wallis test ")
    if not finite(h):
        r.t(f"could not be computed because every {vl} score was the same.")
        summary = f"Every {vl} score was the same, so the groups can't be compared."
    else:
        sig = p < alpha
        r.t(f"showed {'a significant' if sig else 'no significant'} difference in {vl} scores across the {k} groups, ")
        r.stat("H", [k - 1], h).t(", ").p(p)
        if eps.value is not None:
            r.t(", ").es("ε²", eps.value, eps.lower, eps.upper, level, bounded=True)
        r.t(".")
        top = names[int(np.argmax(mean_ranks))]
        low = names[int(np.argmin(mean_ranks))]
        summary = (f"Scores tended to be highest in the {top} group and lowest in the {low} group. " +
                   (f"Differences this large are unlikely to be due to chance alone ({p_phrase(p)}); a follow-up "
                    "test (Dunn's) shows which groups differ." if sig else
                    f"These differences could easily be due to chance, so there is no strong evidence that the "
                    f"groups differ ({p_phrase(p)}).") + size_sentence(eps.value, "eta_sq", "effect"))
    b.sentence(r).summary(summary)
    b.table(_rank_group_table(f"{vl} by {g['gl']}: Kruskal-Wallis Test", g["gl"], names, descs,
                              [len(a) for a in clean], mean_ranks,
                              _omnibus_note("H", [k - 1], h, p, "ε²", eps, level,
                                            "Rank epsilon squared with a percentile bootstrap CI")))
    return b.build()


def _omnibus_note(sym, df, stat, p, es_sym, est, level, es_text) -> Rich:
    note = Rich()
    if finite(stat):
        note.stat(sym, df, stat).t(", ").p(p).t(". ")
    if est.value is not None:
        note.i(es_sym).t(f" = {apa.no_zero(est.value)}, {apa.level_text(level)} CI "
                         f"{apa.ci_text(est.lower, est.upper, 2, True)} ({es_text}; one-sided, upper bound 1).")
    return note


def _rank_group_table(title, first_header, names, descs, ns, mean_ranks, note) -> dict:
    cols = [apa.column("group", first_header, "left"), apa.column("n", Rich().i("n")),
            apa.column("mdn", Rich().i("Mdn")), apa.column("iqr", "IQR"), apa.column("mean_rank", "Mean rank")]
    rows = [apa.row([apa.cell_text(nm), apa.cell_int(n), apa.cell_num(d["median"]), apa.cell_num(d["iqr"]),
                     apa.cell_num(mr)]) for nm, d, n, mr in zip(names, descs, ns, mean_ranks)]
    return apa.table(title, cols, rows, general_note=note)


# ---------------------------------------------------------------------------
# Friedman
# ---------------------------------------------------------------------------
def friedman_chi2(m: np.ndarray) -> tuple[float, np.ndarray]:
    """stats::friedman.test statistic (tie-corrected) and the within-block ranks."""
    ranks = esr.friedman_ranks(m)
    n, k = ranks.shape
    ties = sum(esr.tie_sum(row) for row in ranks)
    denom = n * k * (k + 1) - ties / (k - 1)
    stat = 12 * float(np.sum((ranks.sum(axis=0) - n * (k + 1) / 2) ** 2)) / denom if denom > 0 else float("nan")
    return stat, ranks


@register("friedman", label="Friedman test", roles=REPEATED_ROLES,
          options={"levels": "Long layout: time values to include, in order.", **BOOT_OPTIONS})
def friedman(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    level, alpha = request.ci_level, request.alpha
    seed, iters = boot_settings(request)
    data = repeated_data(df, request, meta, None, "A Friedman test")
    m, names = data["m"], data["names"]
    n, k = m.shape
    if n < 2:
        raise InvalidParams(f"A Friedman test needs at least 2 people with every score; there are {n}.")
    stat, ranks = friedman_chi2(m)
    p = float(stats.chi2.sf(stat, k - 1)) if finite(stat) else None

    b = ResultBuilder(request)
    descs = [cell(v, gr, nm, m[:, j], level, nmiss) for j, (v, gr, nm, nmiss) in
             enumerate(zip(data["variables"], data["groups"], names, data["n_missing"]))]
    b.descriptives(descs)
    if not finite(stat):
        b.warn(constant_warning(f"{data['outcome_label']} (within every person)"))
    b.statistic("chi_sq", "Friedman chi-square", "χ²", stat, [k - 1], p)
    w = esr.kendalls_w(m, level, seed, iters)
    b.effect("kendall_w", "Kendall's W", "W", w, "kendall_w", what="agreement")
    b.warn(dropped_warning(data["notes"], n))
    if n < SMALL_N:
        b.warn(warning("small_sample", "caution", f"Only {n} people have every score. With fewer than {SMALL_N}, "
                       "results are less precise, so interpret them with care."))
    b.inputs(n, data["n_excluded"], [(gr, n) for gr in data["groups"]] if data["groups"][0] else [])

    mean_ranks = ranks.mean(axis=0).tolist()
    r = Rich().t("A Friedman test ")
    if not finite(stat):
        r.t("could not be computed because every person had the same score at every time point.")
        summary = "Every person had the same score each time, so there is no change to test."
    else:
        sig = p < alpha
        r.t(f"showed {'a significant' if sig else 'no significant'} difference across the {k} time points, ")
        r.i("χ²").t(f"({k - 1}, ").i("N").t(f" = {n}) = {apa.num(stat)}, ").p(p)
        if w.value is not None:
            r.t(", ").es("W", w.value, w.lower, w.upper, level, bounded=True)
        r.t(".")
        top, low = names[int(np.argmax(mean_ranks))], names[int(np.argmin(mean_ranks))]
        summary = (f"For the {n} people with every score, scores tended to be highest at {top} and lowest at {low}. " +
                   (f"Differences this large are unlikely to be due to chance alone ({p_phrase(p)}); a follow-up "
                    "test (Conover or Nemenyi) shows which time points differ." if sig else
                    f"These differences could easily be due to chance ({p_phrase(p)}).") +
                   size_sentence(w.value, "kendall_w", "effect"))
    b.sentence(r).summary(summary)
    note = _omnibus_note("χ²", [k - 1], stat, p, "W", w, level, "Kendall's W with a percentile bootstrap CI")
    b.table(_rank_group_table(f"{data['outcome_label']}: Friedman Test", "Time point", names, descs, [n] * k,
                              mean_ranks, note))
    return b.build()

