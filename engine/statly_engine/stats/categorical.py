"""Categorical tests (SPEC §8 "Categorical"). Reference: fixtures/r/categorical.R.

Conventions:
- Complete cases on the variables involved; levels in category order (options > value labels >
  sorted values). Tests of association are non-directional, so `tails` applies only to Fisher's
  exact test on a 2 x 2 table (as fisher.test); CIs use `ci_level`.
- chi_square.independence: Pearson's chi-square (no continuity correction) is the headline; for
  2 x 2 tables the Yates-corrected statistic (chisq.test default) is reported alongside, as SPSS
  shows both, plus the likelihood-ratio G². When more than 20% of expected counts are below 5 (or
  any is below 1) a warning recommends Fisher's exact test.
- Effect sizes (effect_sizes_cat): Cramér's V and phi unadjusted (effectsize adjust = FALSE) with
  effectsize's default one-sided CI (upper bound 1); phi is unsigned as in effectsize, and the
  direction is carried by the sample odds ratio (ad / bc, Woolf CI; null CI with a zero cell).
- fisher_exact: stats::fisher.test. 2 x 2: p (two-sided = sum of tables no more likely than the
  observed one, relative tolerance 1e-7), the conditional-MLE odds ratio with its exact CI (this
  differs from the sample OR, which is also reported), and phi. r x c: exact p by full enumeration
  of the tables with the observed margins (refused when that would be too large; use chi-square).
- chi_square.goodness_of_fit: equal expected proportions, or options.expected_proportions (a
  {value: proportion} map or a list in level order), rescaled to sum to 1. Cohen's w and Fei
  (effectsize defaults, one-sided CI).
- mcnemar: two paired yes/no variables with the same two codes. Headline chi-square with the
  continuity correction (mcnemar.test default; SPSS's chi-square), the uncorrected statistic and the
  exact binomial test alongside. Cohen's g (Wilson CI) and the paired odds ratio b / c (exact CI).
- cochran_q: two or more paired yes/no variables sharing the same two codes; the second code
  (e.g. 1 / "Yes") counts as success unless options.success says otherwise. Q on k - 1 df.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy import special, stats

from statly_engine.errors import InvalidParams
from statly_engine.stats import apa, effect_sizes_cat as esc, prep
from statly_engine.stats.apa import Rich
from statly_engine.stats.core import SMALL_N, ResultBuilder, magnitude, missing_warning, warning
from statly_engine.stats.descriptives import frequency_table
from statly_engine.stats.registry import Role, register

FISHER_MAX_TABLES = 2_000_000
_ALT = {"two_sided": "two-sided", "greater": "greater", "less": "less"}


def _chi_sym() -> Rich:
    return Rich().i("χ").sup("2")


def _p_phrase(p) -> str:
    s = apa.p_value(p)
    return f"p {s}" if s[0] in "<>" else f"p = {s}"


def _pct(x) -> str:
    return f"{x:.1f}%" if np.isfinite(x) else apa.EM_DASH


# ---------------------------------------------------------------------------
# Tables
# ---------------------------------------------------------------------------
def _levels_mask(values: pd.Series, levels: list) -> list[np.ndarray]:
    return [values.map(lambda v, lv=lv: prep._same(v, lv)).to_numpy(bool) for lv in levels]


def crosstab(df, rname, cname, meta, request) -> dict:
    r, c = prep.categorical(df, rname, meta), prep.categorical(df, cname, meta)
    ok = (r.notna() & c.notna()).to_numpy()
    rl = prep.level_order(r[ok], rname, meta, request.options.get("row_levels"))
    cl = prep.level_order(c[ok], cname, meta, request.options.get("column_levels"))
    rm, cm = _levels_mask(r, rl), _levels_mask(c, cl)
    tab = np.array([[int((a & b & ok).sum()) for b in cm] for a in rm], dtype=int)
    return {"table": tab, "row_levels": rl, "col_levels": cl,
            "row_names": [prep.value_label(meta, rname, v) for v in rl],
            "col_names": [prep.value_label(meta, cname, v) for v in cl],
            "row_label": prep.label(meta, rname), "col_label": prep.label(meta, cname),
            "n": int(tab.sum()), "n_excluded": int(len(df) - tab.sum()), "r": r[ok], "c": c[ok]}


def expected_counts(tab: np.ndarray) -> np.ndarray:
    tab = np.asarray(tab, float)
    return np.outer(tab.sum(1), tab.sum(0)) / tab.sum()


def pearson_chisq(tab, yates: bool = False) -> tuple[float, int, float]:
    """stats::chisq.test on a matrix; Yates' correction as R: min(0.5, |O - E|) over all cells."""
    tab = np.asarray(tab, float)
    e = expected_counts(tab)
    dfree = (tab.shape[0] - 1) * (tab.shape[1] - 1)
    d = np.abs(tab - e)
    if yates:
        d = d - min(0.5, float(d.min()))
    with np.errstate(divide="ignore", invalid="ignore"):
        chi = float(np.sum(d ** 2 / e))
    return chi, dfree, float(stats.chi2.sf(chi, dfree)) if np.isfinite(chi) else None


def likelihood_ratio(tab) -> tuple[float, int, float]:
    tab = np.asarray(tab, float)
    e = expected_counts(tab)
    pos = tab > 0
    g2 = float(2 * np.sum(tab[pos] * np.log(tab[pos] / e[pos])))
    dfree = (tab.shape[0] - 1) * (tab.shape[1] - 1)
    return g2, dfree, float(stats.chi2.sf(g2, dfree))


def adjusted_residuals(tab) -> np.ndarray:
    """(O - E) / sqrt(E (1 - row share)(1 - column share)) — SPSS 'adjusted residuals'."""
    tab = np.asarray(tab, float)
    n = tab.sum()
    e = expected_counts(tab)
    rs, cs = tab.sum(1, keepdims=True) / n, tab.sum(0, keepdims=True) / n
    with np.errstate(divide="ignore", invalid="ignore"):
        return (tab - e) / np.sqrt(e * (1 - rs) * (1 - cs))


def fisher_rxc_p(tab) -> float:
    """Two-sided exact p for an r x c table: the total probability of every table with the observed
    margins that is no more likely than the observed one (relative tolerance 1e-7, as fisher.test)."""
    t = np.asarray(tab, int)
    if t.shape[0] > t.shape[1]:
        t = t.T
    rows, cols = t.sum(1), t.sum(0)
    n = int(t.sum())
    const = float(np.sum(special.gammaln(rows + 1)) + np.sum(special.gammaln(cols + 1)) - special.gammaln(n + 1))
    obs = -float(np.sum(special.gammaln(t + 1)))
    thr = obs + math.log1p(1e-7)
    ncol = len(cols)
    memo: dict = {}
    budget = [0]

    def vectors(total: int, caps: tuple):
        if len(caps) == 1:
            if total <= caps[0]:
                yield (total,)
            return
        rest = sum(caps[1:])
        for v in range(max(0, total - rest), min(caps[0], total) + 1):
            for tail in vectors(total - v, caps[1:]):
                yield (v,) + tail

    def suffix(j: int, rem: tuple) -> np.ndarray:
        key = (j, rem)
        if key in memo:
            return memo[key]
        if j == ncol - 1:
            out = np.array([-float(np.sum(special.gammaln(np.array(rem) + 1)))])
        else:
            parts = []
            for v in vectors(int(cols[j]), rem):
                head = -float(np.sum(special.gammaln(np.array(v) + 1)))
                parts.append(head + suffix(j + 1, tuple(a - b for a, b in zip(rem, v))))
            out = np.concatenate(parts) if parts else np.array([])
        budget[0] += len(out)
        if budget[0] > FISHER_MAX_TABLES:
            raise InvalidParams("This table is too large for an exact test. Use the chi-square test of "
                                "independence instead.")
        memo[key] = out
        return out

    vals = suffix(0, tuple(int(x) for x in rows))
    keep = vals <= thr
    return float(min(1.0, np.sum(np.exp(const + vals[keep]))))


# ---------------------------------------------------------------------------
# Shared output pieces
# ---------------------------------------------------------------------------
def _crosstab_outputs(b: ResultBuilder, x: dict, rname: str, cname: str, meta, note: Rich):
    tab = x["table"]
    e = expected_counts(tab)
    res = adjusted_residuals(tab)
    rows_tot, cols_tot, n = tab.sum(1), tab.sum(0), tab.sum()
    b.frequency_tables([frequency_table(x["r"], rname, {}, meta), frequency_table(x["c"], cname, {}, meta)])
    recs = []
    for i, rn in enumerate(x["row_names"]):
        for j, cn in enumerate(x["col_names"]):
            recs.append({"row": rn, "column": cn, "count": int(tab[i, j]), "expected": float(e[i, j]),
                         "row_percent": float(100 * tab[i, j] / rows_tot[i]) if rows_tot[i] else None,
                         "column_percent": float(100 * tab[i, j] / cols_tot[j]) if cols_tot[j] else None,
                         "adjusted_residual": float(res[i, j]) if np.isfinite(res[i, j]) else None})
    b.chart("crosstab", recs)

    cols = [apa.column("row", x["row_label"], "left")]
    for j, cn in enumerate(x["col_names"]):
        cols += [apa.column(f"n{j}", Rich().i("n")), apa.column(f"pct{j}", "%")]
    cols += [apa.column("total", "Total")]
    rows = []
    for i, rn in enumerate(x["row_names"]):
        cells = [apa.cell_text(rn)]
        for j in range(len(x["col_names"])):
            pct = 100 * tab[i, j] / rows_tot[i] if rows_tot[i] else float("nan")
            cells += [apa.cell_int(int(tab[i, j])), {"type": "number", "value": float(pct) if np.isfinite(pct) else None,
                                                     "display": f"{pct:.1f}" if np.isfinite(pct) else apa.EM_DASH}]
        cells.append(apa.cell_int(int(rows_tot[i])))
        rows.append(apa.row(cells))
    tot = [apa.cell_text("Total")]
    for j in range(len(x["col_names"])):
        pct = 100 * cols_tot[j] / n
        tot += [apa.cell_int(int(cols_tot[j])), {"type": "number", "value": float(pct), "display": f"{pct:.1f}"}]
    tot.append(apa.cell_int(int(n)))
    rows.append(apa.row(tot, kind="total"))
    groups = [apa.column_group(cn, 1 + 2 * j, 2) for j, cn in enumerate(x["col_names"])]
    b.table(apa.table(f"{x['row_label']} by {x['col_label']}", cols, rows, column_groups=groups,
                      general_note=Rich().t("Percentages are within each row. ").extend(note)))

    ecols = [apa.column("row", x["row_label"], "left")] + [apa.column(f"e{j}", cn) for j, cn in enumerate(x["col_names"])]
    erows = [apa.row([apa.cell_text(rn)] + [apa.cell_text(f"{e[i, j]:.1f} ({apa.num(res[i, j])})")
                                            for j in range(len(x["col_names"]))])
             for i, rn in enumerate(x["row_names"])]
    b.extra_table(apa.table("Expected Counts (Adjusted Residuals)", ecols, erows, number=None,
                            general_note="Adjusted residuals beyond ±1.96 mark cells that differ from what "
                                         "independence predicts at about the .05 level."))
    return e


def _low_expected_warning(e: np.ndarray, fisher_ok: bool = True):
    share = float(np.mean(e < 5))
    if share > 0.2 or float(e.min()) < 1:
        tail = (" Fisher's exact test does not rely on large counts and is the safer choice here."
                if fisher_ok else " Consider combining small categories.")
        return warning("low_expected_counts", "caution",
                       f"{share * 100:.0f}% of the cells have an expected count below 5 (smallest "
                       f"{e.min():.2f}). The chi-square p-value can be inaccurate with counts this small."
                       + tail)
    return None


def _zero_cell_warning(est, what: str):
    """An odds ratio that is 0 or infinite (a zero cell): say so and give the finite bound."""
    if est.value is not None and est.value > 0:
        return None
    bound = est.lower if est.value is None else est.upper
    extra = f" The {apa.level_text(est.level)} CI is {'above' if est.value is None else 'below'} {apa.num(bound)}." \
        if bound is not None else ""
    return warning("zero_cell", "caution", f"A cell of the table is empty, so the {what} is "
                   f"{'infinite' if est.value is None else 'zero'} and has no usable point estimate.{extra}")


def _need_two_levels(x: dict):
    for lab, lv in ((x["row_label"], x["row_levels"]), (x["col_label"], x["col_levels"])):
        if len(lv) < 2:
            raise InvalidParams(f"{lab} has only one category among the complete rows, so there is nothing to "
                                "compare. A test of association needs at least two categories in each variable.")


_ROWCOL = [Role("row", 1, 1, "Categorical variable shown in the table rows"),
           Role("column", 1, 1, "Categorical variable shown in the table columns")]


# ---------------------------------------------------------------------------
# Chi-square test of independence
# ---------------------------------------------------------------------------
@register("chi_square.independence", label="Chi-square test of independence", roles=_ROWCOL,
          options={"row_levels": "Row categories in display order.",
                   "column_levels": "Column categories in display order."})
def chi_square_independence(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    rname, cname = request.variables["row"][0], request.variables["column"][0]
    level, alpha = request.ci_level, request.alpha
    x = crosstab(df, rname, cname, meta, request)
    _need_two_levels(x)
    tab, n = x["table"], x["n"]
    is2 = tab.shape == (2, 2)
    b = ResultBuilder(request)
    chi, dfree, p = pearson_chisq(tab)
    b.statistic("chi2", "Pearson chi-square", "χ²", chi, [dfree], p)
    if is2:
        cy, _, py = pearson_chisq(tab, yates=True)
        b.statistic("chi2_yates", "Chi-square with Yates' continuity correction", "χ²", cy, [dfree], py)
    g2, _, pg = likelihood_ratio(tab)
    b.statistic("likelihood_ratio", "Likelihood-ratio chi-square", "G²", g2, [dfree], pg)
    v = esc.cramers_v(chi, n, *tab.shape, level=level)
    b.effect("cramers_v", "Cramér's V", "V", v, "r", what="association")
    if is2:
        b.effect("phi", "Phi (unsigned)", "φ", esc.phi(chi, n, level), "r", what="association")
        b.effect("sample_odds_ratio", "Odds ratio (sample)", "OR", esc.odds_ratio_woolf(tab, level))

    note = Rich().stat(_chi_sym(), [dfree], chi).t(", ").p(p).t(".")
    e = _crosstab_outputs(b, x, rname, cname, meta, note)
    b.warn(_low_expected_warning(e))
    if n < SMALL_N:
        b.warn(warning("small_sample", "caution", f"Only {n} people are in the table, so the result is imprecise."))
    b.warn(missing_warning(x["n_excluded"]))
    b.inputs(n, x["n_excluded"])

    sig = p < alpha
    s = Rich().t("A chi-square test of independence showed " + ("a significant" if sig else "no significant") +
                 f" association between {x['row_label']} and {x['col_label']}, ")
    s.extend(_chi_sym()).t(f"({dfree}, ").i("N").t(f" = {n}) = {apa.num(chi)}, ").p(p)
    s.t(", ").es("V", v.value, v.lower, v.upper, level, bounded=True).t(".")
    strength = {"negligible": "very weak", "small": "weak", "medium": "moderate", "large": "strong"}
    mag = magnitude(v.value, "r")
    summary = ((f"{x['row_label']} and {x['col_label']} appear to be related: the pattern of {x['col_label']} "
                "differs across the rows more than chance alone would explain") if sig else
               (f"There is no strong evidence that {x['row_label']} and {x['col_label']} are related; the "
                "differences in the table could easily be due to chance")) + f" ({_p_phrase(p)})."
    if mag:
        summary += f" The strength of the association was {strength[mag]} by common benchmarks."
    b.sentence(s).summary(summary)
    return b.build()


# ---------------------------------------------------------------------------
# Fisher's exact test
# ---------------------------------------------------------------------------
@register("fisher_exact", label="Fisher's exact test", roles=_ROWCOL,
          options={"row_levels": "Row categories in display order.",
                   "column_levels": "Column categories in display order."})
def fisher_exact(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    rname, cname = request.variables["row"][0], request.variables["column"][0]
    level, alpha, alt = request.ci_level, request.alpha, request.tails.value
    x = crosstab(df, rname, cname, meta, request)
    _need_two_levels(x)
    tab, n = x["table"], x["n"]
    is2 = tab.shape == (2, 2)
    b = ResultBuilder(request)
    chi, dfree, _ = pearson_chisq(tab)
    if is2:
        p = float(stats.fisher_exact(tab, alternative=_ALT[alt]).pvalue)
        b.statistic("fisher_p", "Fisher's exact test", "p", None, [], p)
        orc = esc.odds_ratio_conditional(tab, level, alt)
        b.effect("odds_ratio", "Odds ratio (conditional MLE)", "OR", orc)
        b.effect("sample_odds_ratio", "Odds ratio (sample)", "OR", esc.odds_ratio_woolf(tab, level))
        b.effect("phi", "Phi (unsigned)", "φ", esc.phi(chi, n, level), "r", what="association")
        head_es = ("OR", orc, False)
        b.warn(_zero_cell_warning(orc, "odds ratio"))
    else:
        if alt != "two_sided":
            raise InvalidParams("A one-tailed Fisher's exact test is only defined for a 2 × 2 table.")
        p = fisher_rxc_p(tab)
        b.statistic("fisher_p", "Fisher's exact test", "p", None, [], p)
        v = esc.cramers_v(chi, n, *tab.shape, level=level)
        b.effect("cramers_v", "Cramér's V", "V", v, "r", what="association")
        head_es = ("V", v, True)

    note = Rich().t("Fisher's exact test, ").p(p).t(".")
    if alt != "two_sided":
        note.t(f" One-tailed (alternative: odds ratio {'>' if alt == 'greater' else '<'} 1).")
    _crosstab_outputs(b, x, rname, cname, meta, note)
    if n < SMALL_N:
        b.warn(warning("small_sample", "info", f"Only {n} people are in the table. Fisher's exact test is valid "
                       "for small samples, but the effect-size intervals are wide."))
    b.warn(missing_warning(x["n_excluded"]))
    b.inputs(n, x["n_excluded"])

    sig = p < alpha
    sym, est, bounded = head_es
    s = Rich().t("Fisher's exact test showed " + ("a significant" if sig else "no significant") +
                 f" association between {x['row_label']} and {x['col_label']}, ").p(p)
    if est.value is not None:
        s.t(", ").es(sym, est.value, est.lower, est.upper, level, bounded=bounded)
    s.t(f", N = {n}.")
    summary = ((f"{x['row_label']} and {x['col_label']} appear to be related" if sig else
                f"There is no strong evidence that {x['row_label']} and {x['col_label']} are related")
               + f" ({_p_phrase(p)}). Fisher's exact test works even when some cells have very few people.")
    if is2 and est.value is not None and est.value > 0:
        summary += (f" The odds of {x['col_names'][0]} were {apa.num(est.value)} times as high for "
                    f"{x['row_names'][0]} as for {x['row_names'][1]}.")
    b.sentence(s).summary(summary)
    return b.build()


# ---------------------------------------------------------------------------
# Goodness of fit
# ---------------------------------------------------------------------------
def _expected_props(opt, levels: list, names: list) -> tuple[list, list, np.ndarray]:
    if opt is None:
        return levels, names, np.full(len(levels), 1 / len(levels))
    if isinstance(opt, dict):
        keys = list(opt.keys())
        extra = [k for k in keys if not any(prep._same(k, lv) or str(k) == str(nm) for lv, nm in zip(levels, names))]
        lv_all, nm_all = list(levels) + extra, list(names) + [str(k) for k in extra]
        props = []
        for lv, nm in zip(lv_all, nm_all):
            hit = [v for k, v in opt.items() if prep._same(k, lv) or str(k) == str(nm)]
            if not hit:
                raise InvalidParams(f"No expected proportion was given for the category '{nm}'.")
            props.append(float(hit[0]))
    else:
        props = [float(v) for v in opt]
        if len(props) != len(levels):
            raise InvalidParams(f"Give one expected proportion per category ({len(levels)}), in category order.")
        lv_all, nm_all = levels, names
    p = np.asarray(props, float)
    if np.any(p <= 0) or not np.all(np.isfinite(p)):
        raise InvalidParams("Expected proportions must all be positive numbers.")
    return lv_all, nm_all, p / p.sum()


@register("chi_square.goodness_of_fit", label="Chi-square goodness-of-fit test",
          roles=[Role("variable", 1, 1, "Categorical variable")],
          options={"expected_proportions": "Expected share of each category, as {value: proportion} or a list in "
                                           "category order (rescaled to sum to 1). Default: equal shares."})
def goodness_of_fit(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    name = request.variables["variable"][0]
    vl = prep.label(meta, name)
    level, alpha = request.ci_level, request.alpha
    vals = prep.categorical(df, name, meta)
    ok = vals.notna().to_numpy()
    levels = prep.level_order(vals[ok], name, meta)
    names = [prep.value_label(meta, name, lv) for lv in levels]
    levels, names, p = _expected_props(request.options.get("expected_proportions"), levels, names)
    if len(levels) < 2:
        raise InvalidParams(f"{vl} has only one category, so there is nothing to compare.")
    obs = np.array([int(m[ok].sum()) for m in _levels_mask(vals, levels)], float)
    n = int(obs.sum())
    e = n * p
    chi = float(np.sum((obs - e) ** 2 / e))
    dfree = len(obs) - 1
    pv = float(stats.chi2.sf(chi, dfree))
    b = ResultBuilder(request)
    b.statistic("chi2", "Chi-square goodness of fit", "χ²", chi, [dfree], pv)
    w = esc.cohens_w_gof(chi, n, p, level)
    b.effect("cohens_w", "Cohen's w", "w", w, "r", what="departure from the expected shares")
    b.effect("fei", "Fei (w scaled to 0-1)", "פ", esc.fei(chi, n, p, level))
    b.frequency_tables([frequency_table(vals, name, {}, meta)])
    resid = (obs - e) / np.sqrt(e)
    b.chart("goodness_of_fit", [{"category": nm, "observed": int(o), "expected": float(ex),
                                 "expected_proportion": float(pp), "residual": float(rr)}
                                for nm, o, ex, pp, rr in zip(names, obs, e, p, resid)])
    if float(np.mean(e < 5)) > 0.2 or float(e.min()) < 1:
        b.warn(_low_expected_warning(e.reshape(1, -1), fisher_ok=False))
    b.warn(missing_warning(int((~ok).sum())))
    b.inputs(n, int((~ok).sum()))

    cols = [apa.column("cat", vl, "left"), apa.column("obs", "Observed"), apa.column("exp", "Expected"),
            apa.column("prop", "Expected %"), apa.column("res", "Residual")]
    rows = [apa.row([apa.cell_text(nm), apa.cell_int(int(o)), apa.cell_num(float(ex), 1),
                     apa.cell_num(float(100 * pp), 1), apa.cell_num(float(rr))])
            for nm, o, ex, pp, rr in zip(names, obs, e, p, resid)]
    rows.append(apa.row([apa.cell_text("Total"), apa.cell_int(n), apa.cell_num(float(n), 1),
                         apa.cell_num(100.0, 1), apa.cell_empty()], kind="total"))
    equal = request.options.get("expected_proportions") is None
    note = Rich().t("Expected counts assume " + ("equal shares. " if equal else "the specified shares. "))
    note.t("Residual = (observed - expected) / √expected. ").stat(_chi_sym(), [dfree], chi).t(", ").p(pv).t(".")
    b.table(apa.table(f"Observed and Expected Frequencies of {vl}", cols, rows, general_note=note))
    sig = pv < alpha
    s = Rich().t("A chi-square goodness-of-fit test showed that the distribution of " + vl +
                 (" differed significantly from " if sig else " did not differ significantly from ") +
                 ("equal shares" if equal else "the expected shares") + ", ")
    s.extend(_chi_sym()).t(f"({dfree}, ").i("N").t(f" = {n}) = {apa.num(chi)}, ").p(pv)
    s.t(", ").es("w", w.value, w.lower, w.upper, level).t(".")
    top = names[int(np.argmax(resid))]
    summary = ((f"The answers for {vl} were not spread the way we expected: '{top}' was chosen more often than "
                "expected" if sig else f"The answers for {vl} were spread about as expected")
               + f" ({_p_phrase(pv)}).")
    b.sentence(s).summary(summary)
    return b.build()


# ---------------------------------------------------------------------------
# McNemar
# ---------------------------------------------------------------------------
def _binary_levels(series: list[pd.Series], names: list[str], meta, what: str) -> list:
    allv = pd.concat([s.dropna() for s in series])
    levels = prep.level_order(allv, names[0], meta)
    if len(levels) != 2:
        raise InvalidParams(f"{what} needs yes/no variables that share the same two codes; the chosen variables "
                            f"have {len(levels)} different values.")
    return levels


@register("mcnemar", label="McNemar test",
          roles=[Role("measures", 2, 2, "The same yes/no question for the same people at two times")],
          options={})
def mcnemar(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    a, c = request.variables["measures"]
    level, alpha = request.ci_level, request.alpha
    xa, xb = prep.categorical(df, a, meta), prep.categorical(df, c, meta)
    ok = (xa.notna() & xb.notna()).to_numpy()
    levels = _binary_levels([xa[ok], xb[ok]], [a, c], meta, "The McNemar test")
    ma, mb = _levels_mask(xa, levels), _levels_mask(xb, levels)
    tab = np.array([[int((ma[i] & mb[j] & ok).sum()) for j in range(2)] for i in range(2)])
    names = [prep.label(meta, a), prep.label(meta, c)]
    lv = [prep.value_label(meta, a, v) for v in levels]
    n = int(tab.sum())
    bb, cc = int(tab[0, 1]), int(tab[1, 0])
    b = ResultBuilder(request)
    disc = bb + cc
    if disc == 0:
        chi1 = chi0 = p1 = p0 = None
        pb = 1.0
    else:
        yates = 1 if bb != cc else 0
        chi1 = (abs(bb - cc) - yates) ** 2 / disc
        chi0 = (bb - cc) ** 2 / disc
        p1, p0 = float(stats.chi2.sf(chi1, 1)), float(stats.chi2.sf(chi0, 1))
        pb = float(stats.binomtest(bb, disc, 0.5).pvalue)
    b.statistic("chi2", "McNemar chi-square (continuity corrected)", "χ²", chi1, [1], p1)
    b.statistic("chi2_uncorrected", "McNemar chi-square (uncorrected)", "χ²", chi0, [1], p0)
    b.statistic("binomial_exact", "Exact binomial McNemar test", "b", bb, [], pb)
    g = esc.cohens_g(bb, cc, level)
    b.effect("cohens_g", "Cohen's g", "g", g)
    por = esc.paired_odds_ratio(bb, cc, level)
    b.effect("odds_ratio", f"Paired odds ratio ({lv[0]}→{lv[1]} vs {lv[1]}→{lv[0]})", "OR", por)
    if disc:
        b.warn(_zero_cell_warning(por, "paired odds ratio"))
    b.frequency_tables([frequency_table(xa[ok], a, {}, meta), frequency_table(xb[ok], c, {}, meta)])
    b.chart("paired_table", [{"first": lv[i], "second": lv[j], "count": int(tab[i, j])} for i in range(2) for j in range(2)])
    if disc == 0:
        b.warn(warning("constant_variable", "serious", "Nobody changed their answer, so there is no change to test."))
    elif disc < 25:
        b.warn(warning("small_sample", "caution", f"Only {disc} people changed their answer. With fewer than 25 "
                       "changes the exact binomial p-value (also reported) is more trustworthy than the chi-square."))
    n_excl = int((~ok).sum())
    if n_excl:
        b.warn(warning("pairs_dropped", "info", f"{n_excl} people were left out because they are missing {names[0]} "
                       f"or {names[1]}. {n} complete pairs were analysed."))
    b.inputs(n, n_excl)

    cols = [apa.column("first", names[0], "left")] + [apa.column(f"c{j}", lv[j]) for j in range(2)] + \
           [apa.column("total", "Total")]
    rows = [apa.row([apa.cell_text(lv[i]), apa.cell_int(int(tab[i, 0])), apa.cell_int(int(tab[i, 1])),
                     apa.cell_int(int(tab[i].sum()))]) for i in range(2)]
    rows.append(apa.row([apa.cell_text("Total"), apa.cell_int(int(tab[:, 0].sum())), apa.cell_int(int(tab[:, 1].sum())),
                         apa.cell_int(n)], kind="total"))
    note = Rich().t("Rows: " + names[0] + "; columns: " + names[1] + ". ")
    if chi1 is not None:
        note.t("McNemar ").stat(_chi_sym(), [1], chi1).t(" (continuity corrected), ").p(p1).t("; exact binomial ").p(pb).t(".")
    b.table(apa.table(f"{names[0]} and {names[1]}", cols, rows,
                      column_groups=[apa.column_group(names[1], 1, 2)], general_note=note))
    p1s, p2s = tab[1].sum() / n, tab[:, 1].sum() / n
    s = Rich().t(f"The proportion answering {lv[1]} was {_pct(100 * p1s)} for {names[0]} and {_pct(100 * p2s)} for "
                 f"{names[1]}. ")
    if chi1 is None:
        s.t("A McNemar test could not be computed because no one changed their answer.")
        summary = "Nobody changed their answer between the two measurements, so there is no change to test."
    else:
        sig = p1 < alpha
        s.t("A McNemar test showed " + ("a significant" if sig else "no significant") + " change, ")
        s.extend(_chi_sym()).t(f"(1, ").i("N").t(f" = {n}) = {apa.num(chi1)}, ").p(p1)
        if g.value is not None:
            s.t(", ").es("g", g.value, g.lower, g.upper, level)
        s.t(".")
        summary = (f"{bb} people changed from {lv[0]} to {lv[1]} and {cc} changed from {lv[1]} to {lv[0]}. " +
                   ("This shift is unlikely to be due to chance alone" if sig else
                    "This difference could easily be due to chance") + f" ({_p_phrase(p1)}).")
    b.sentence(s).summary(summary)
    return b.build()


# ---------------------------------------------------------------------------
# Cochran's Q
# ---------------------------------------------------------------------------
def cochran_q_stat(x: np.ndarray) -> tuple[float | None, int, float | None]:
    """x: n x k 0/1 matrix (complete cases). Q = (k-1)(k ΣC² - N²) / (k N - ΣR²)."""
    k = x.shape[1]
    cj, ri, tot = x.sum(0), x.sum(1), x.sum()
    den = k * tot - np.sum(ri ** 2)
    if den == 0:
        return None, k - 1, None
    q = (k - 1) * (k * np.sum(cj ** 2) - tot ** 2) / den
    return float(q), k - 1, float(stats.chi2.sf(q, k - 1))


@register("cochran_q", label="Cochran's Q test",
          roles=[Role("measures", 2, None, "Two or more yes/no variables for the same people")],
          options={"success": "The code that counts as 'yes' (default: the second of the two codes, e.g. 1)."})
def cochran_q(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    names = list(dict.fromkeys(request.variables["measures"]))
    if len(names) < 2:
        raise InvalidParams("Cochran's Q needs at least two different variables.")
    alpha = request.alpha
    cols = [prep.categorical(df, v, meta) for v in names]
    ok = np.ones(len(df), bool)
    for s in cols:
        ok &= s.notna().to_numpy()
    levels = _binary_levels([s[ok] for s in cols], names, meta, "Cochran's Q")
    succ = request.options.get("success")
    if succ is not None:
        hit = [lv for lv in levels if prep._same(lv, succ)]
        if not hit:
            raise InvalidParams(f"'{succ}' is not one of the codes in these variables.")
        yes = hit[0]
    else:
        yes = levels[1]
    x = np.column_stack([s[ok].map(lambda v: prep._same(v, yes)).to_numpy(float) for s in cols])
    n, k = x.shape
    labels = [prep.label(meta, v) for v in names]
    yes_lab = prep.value_label(meta, names[0], yes)
    q, dfree, p = cochran_q_stat(x)
    b = ResultBuilder(request)
    b.statistic("q", "Cochran's Q", "Q", q, [dfree], p)
    b.frequency_tables([frequency_table(s[ok], v, {}, meta) for s, v in zip(cols, names)])
    props = x.mean(0)
    b.chart("proportions", [{"measure": lab, "proportion": float(pp), "count": int(cnt)}
                            for lab, pp, cnt in zip(labels, props, x.sum(0))])
    if q is None:
        b.warn(warning("constant_variable", "serious", "Every person gave the same answer on every measure, so "
                       "there is no change to test."))
    if n < SMALL_N:
        b.warn(warning("small_sample", "caution", f"Only {n} people have all {k} answers. Cochran's Q relies on a "
                       "large-sample approximation, so treat the p-value with care."))
    n_excl = int((~ok).sum())
    if n_excl:
        b.warn(warning("pairs_dropped", "info", f"{n_excl} people were left out because they are missing at least "
                       f"one of the {k} measures. {n} complete cases were analysed."))
    b.inputs(n, n_excl)

    tcols = [apa.column("m", "Measure", "left"), apa.column("n", Rich().i("n").t(f" ({yes_lab})")),
             apa.column("pct", "%")]
    rows = [apa.row([apa.cell_text(lab), apa.cell_int(int(cnt)), apa.cell_num(float(100 * pp), 1)])
            for lab, cnt, pp in zip(labels, x.sum(0), props)]
    note = Rich().t(f"N = {n} complete cases. ")
    if q is not None:
        note.t("Cochran's ").stat("Q", [dfree], q).t(", ").p(p).t(".")
    b.table(apa.table(f"Proportion Answering {yes_lab} by Measure", tcols, rows, general_note=note))
    s = Rich().t("Cochran's ").i("Q").t(" test ")
    if q is None:
        s.t("could not be computed because every person gave the same answer on every measure.")
        summary = "Everyone answered the same way on every measure, so there is nothing to compare."
    else:
        sig = p < alpha
        s.t("showed " + ("a significant" if sig else "no significant") +
            f" difference in the proportion answering {yes_lab} across the {k} measures, ")
        s.stat("Q", [dfree], q).t(", ").p(p).t(f", N = {n}.")
        rng = f"{_pct(100 * props.min())} to {_pct(100 * props.max())}"
        summary = (f"The share answering {yes_lab} ranged from {rng} across the {k} measures. " +
                   ("These differences are unlikely to be due to chance alone" if sig else
                    "These differences could easily be due to chance") + f" ({_p_phrase(p)}).")
    b.sentence(s).summary(summary)
    return b.build()
