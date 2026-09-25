"""Two-way between-subjects (factorial) ANOVA (SPEC §3, §8). Reference: fixtures/r/factorial.R.

Conventions (see also stats/README.md, "Factorial, mixed, ART, simple effects"):
- anova.factorial = car::Anova(lm(y ~ A * B), type = 3) with sum-to-zero contrasts (contr.sum), which
  is afex::aov_car's default and SPSS's GLM Type III. Each term's SS is the increase in residual SS
  when its contrast columns are dropped from the full effect-coded model, so unbalanced designs are
  handled exactly (each effect adjusted for all others). Terms: A, B, A × B; error df = N - ab.
- Complete cases on (outcome, A, B); rows dropped are counted. Factor levels with no complete rows are
  dropped. An empty cell (a combination with no scores) makes the Type III model rank deficient: R
  (car/afex) refuses, and so does Statly, naming the cell (InvalidParams). Unequal cell sizes get an
  `unbalanced_design` warning.
- Effect sizes per term (effectsize on the car::Anova table): partial eta² = SS_t / (SS_t + SS_E),
  partial omega² = max(0, (SS_t - df_t MSE) / (SS_t + (N - df_t) MSE)), Cohen's f from partial eta²;
  two-sided CIs at ci_level (effect_sizes_anova.pve_ci).
- Assumptions: Levene (Brown-Forsythe, median) across the a x b cells (car::leveneTest(y ~ A * B));
  Shapiro-Wilk on the model residuals (with small cells a per-cell test has no power; the model
  assumption is normal errors).
- Estimated marginal means (emmeans on the lm): cell means with SE sqrt(MSE / n_ij), and marginal
  means as the unweighted mean of cell means, SE = sqrt(MSE sum_j 1/n_ij) / b, df = N - ab. Shipped in
  chart_data["marginal_means"] and chart_data["interaction_plot"] (x = first factor, series = second).
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy import stats

from statly_engine.errors import InvalidParams
from statly_engine.stats import apa, assumptions as asm, effect_sizes_anova as esa, prep
from statly_engine.stats.anova import ETA_P, p_phrase, require_two_sided
from statly_engine.stats.apa import Rich
from statly_engine.stats.core import (ResultBuilder, constant_warning, magnitude, missing_warning,
                                      small_sample_warning, ties_warning, warning)
from statly_engine.stats.descriptives import cell
from statly_engine.stats.registry import Role, register

TIMES = "×"
FACTORIAL_ROLES = [Role("outcome", 1, 1, "Scores to compare"),
                   Role("factors", 2, 2, "Two grouping variables (e.g. teaching method and grade)")]


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------
def _levels_of(g: pd.Series, name: str, meta, keep: np.ndarray) -> list:
    return prep.level_order(g[keep], name, meta)


def factorial_data(df: pd.DataFrame, request, meta) -> dict:
    """Complete cases on outcome and both factors; cell structure; InvalidParams on an empty cell."""
    yname = request.variables["outcome"][0]
    aname, bname = request.variables["factors"]
    if aname == bname:
        raise InvalidParams("Choose two different grouping variables.")
    y = prep.numeric(df, yname, meta)
    ga, gb = prep.categorical(df, aname, meta), prep.categorical(df, bname, meta)
    has_ab = (ga.notna() & gb.notna()).to_numpy()
    keep = has_ab & y.notna().to_numpy()
    al, bl = _levels_of(ga, aname, meta, keep), _levels_of(gb, bname, meta, keep)
    labs = {"y": prep.label(meta, yname), "a": prep.label(meta, aname), "b": prep.label(meta, bname)}
    for lv, nm in ((al, labs["a"]), (bl, labs["b"])):
        if len(lv) < 2:
            raise InvalidParams(f"A two-way ANOVA needs at least two groups in each grouping variable, but "
                                f"{nm} has {len(lv)} with scores.")
    ai = np.full(len(df), -1)
    bi = np.full(len(df), -1)
    for i, lv in enumerate(al):
        ai[ga.map(lambda v, lv=lv: prep._same(v, lv)).to_numpy(bool)] = i
    for j, lv in enumerate(bl):
        bi[gb.map(lambda v, lv=lv: prep._same(v, lv)).to_numpy(bool)] = j
    anames = [prep.value_label(meta, aname, lv) for lv in al]
    bnames = [prep.value_label(meta, bname, lv) for lv in bl]
    counts = np.zeros((len(al), len(bl)), int)
    for i, j in zip(ai[keep], bi[keep]):
        counts[i, j] += 1
    empty = [f"{anames[i]} and {bnames[j]}" for i in range(len(al)) for j in range(len(bl)) if counts[i, j] == 0]
    if empty:
        raise InvalidParams(
            f"No one has a {labs['y']} score in these combinations of {labs['a']} and {labs['b']}: "
            + "; ".join(empty) + ". A two-way ANOVA needs scores in every combination (an empty cell makes the "
            "interaction impossible to estimate). Consider leaving out one of the levels with the Levels option "
            "or a filter, or analyse the groups one factor at a time.")
    yy = y.to_numpy()
    n = int(keep.sum())
    if n - len(al) * len(bl) < 1:
        raise InvalidParams(f"There are too few scores ({n}) for {len(al) * len(bl)} groups: each combination "
                            "needs more than one score on average to estimate the error.")
    raw = [[yy[has_ab & (ai == i) & (bi == j)] for j in range(len(bl))] for i in range(len(al))]
    return dict(yname=yname, aname=aname, bname=bname, labs=labs, al=al, bl=bl, anames=anames, bnames=bnames,
                y=yy[keep], a=ai[keep], b=bi[keep], counts=counts, raw=raw, n_used=n,
                n_excluded=int(len(df) - n))


# ---------------------------------------------------------------------------
# Type III sums of squares (effect coding) and estimated marginal means
# ---------------------------------------------------------------------------
def sum_contrasts(idx: np.ndarray, k: int) -> np.ndarray:
    """contr.sum columns for a factor coded 0..k-1 (last level = -1 in every column)."""
    x = np.zeros((len(idx), k - 1))
    for j in range(k - 1):
        x[:, j] = (idx == j).astype(float) - (idx == k - 1).astype(float)
    return x


def _rss(x: np.ndarray, y: np.ndarray) -> float:
    beta, *_ = np.linalg.lstsq(x, y, rcond=None)
    r = y - x @ beta
    return float(r @ r)


def type3(y: np.ndarray, a: np.ndarray, b: np.ndarray, ka: int, kb: int) -> dict:
    """car::Anova(lm(y ~ A * B), type = 3) under contr.sum: SS, df, F, p per term + error; residuals."""
    xa, xb = sum_contrasts(a, ka), sum_contrasts(b, kb)
    xab = np.column_stack([xa[:, i] * xb[:, j] for i in range(ka - 1) for j in range(kb - 1)])
    one = np.ones((len(y), 1))
    blocks = {"A": xa, "B": xb, "AB": xab}
    full = np.column_stack([one, xa, xb, xab])
    beta, *_ = np.linalg.lstsq(full, y, rcond=None)
    resid = y - full @ beta
    ss_e = float(resid @ resid)
    df_e = len(y) - full.shape[1]
    out = {"error": dict(ss=ss_e, df=df_e, ms=ss_e / df_e if df_e > 0 else float("nan")), "resid": resid}
    scale = float(np.sum((y - y.mean()) ** 2))
    ok = df_e > 0 and ss_e > 1e-12 * max(1.0, scale)
    for key, blk in blocks.items():
        others = [one] + [v for k2, v in blocks.items() if k2 != key]
        ss = max(0.0, _rss(np.column_stack(others), y) - ss_e)
        df1 = blk.shape[1]
        f = (ss / df1) / (ss_e / df_e) if ok else None
        out[key] = dict(ss=ss, df=df1, ms=ss / df1, f=f, p=float(stats.f.sf(f, df1, df_e)) if ok else None)
    return out


def factorial_effects(t: dict, key: str, n: int, level: float) -> dict:
    """Partial eta², partial omega², Cohen's f for a between-subjects term (effectsize on car::Anova)."""
    ss, df1 = t[key]["ss"], t[key]["df"]
    ss_e, df_e = t["error"]["ss"], t["error"]["df"]
    none = esa.Estimate(None, None, None, level)
    if not (ss + ss_e > 0 and df_e > 0) or t[key]["f"] is None:
        return {"partial_eta_sq": none, "omega_sq": none, "cohens_f": none}
    mse = ss_e / df_e
    pes = esa.pve_ci(ss / (ss + ss_e), df1, df_e, level)
    om = esa.pve_ci(max(0.0, (ss - df1 * mse) / (ss + (n - df1) * mse)), df1, df_e, level)
    return {"partial_eta_sq": pes, "omega_sq": om, "cohens_f": esa.cohens_f(pes)}


def emmeans_between(d: dict, mse: float, df_e: int, level: float) -> tuple[list[dict], list[dict]]:
    """(marginal_means records, interaction_plot records) as emmeans on lm(y ~ A * B)."""
    ka, kb = len(d["al"]), len(d["bl"])
    n = d["counts"].astype(float)
    m = np.array([[np.mean(d["y"][(d["a"] == i) & (d["b"] == j)]) for j in range(kb)] for i in range(ka)])
    q = stats.t.ppf(0.5 + level / 2, df_e) if df_e > 0 else float("nan")
    marg = []
    for i in range(ka):
        se = math.sqrt(mse * np.sum(1 / n[i])) / kb
        marg.append(_emm_rec(d["labs"]["a"], d["anames"][i], m[i].mean(), se, df_e, q))
    for j in range(kb):
        se = math.sqrt(mse * np.sum(1 / n[:, j])) / ka
        marg.append(_emm_rec(d["labs"]["b"], d["bnames"][j], m[:, j].mean(), se, df_e, q))
    cells = []
    for i in range(ka):
        for j in range(kb):
            se = math.sqrt(mse / n[i, j])
            cells.append({"x": d["anames"][i], "series": d["bnames"][j], "n": int(n[i, j]),
                          **_emm_rec(None, None, m[i, j], se, df_e, q, flat=True)})
    return marg, cells


def _emm_rec(factor, level, mean, se, df, q, flat: bool = False) -> dict:
    ok = math.isfinite(se) and math.isfinite(q)
    rec = {"emmean": float(mean), "se": float(se) if ok else None, "df": float(df),
           "ci_lower": float(mean - q * se) if ok else None, "ci_upper": float(mean + q * se) if ok else None}
    return rec if flat else {"factor": factor, "level": level, **rec}


# ---------------------------------------------------------------------------
# Shared reporting helpers (factorial, mixed, ART)
# ---------------------------------------------------------------------------
def cell_counts_warning(b: ResultBuilder, counts: dict[str, int], what: str = "combinations of the two factors",
                        sequential: bool = False):
    b.warn(small_sample_warning(counts))
    ns = [v for v in counts.values()]
    if ns and max(ns) != min(ns):
        how = ("The aligned rank transform for mixed designs tests the time effects sequentially (Type I, as "
               "ARTool does), so with unequal groups the time effect gives larger groups more weight."
               if sequential else "Statly uses Type III sums of squares, so each effect is adjusted for the others, "
               "and the estimated marginal means give every combination equal weight.")
        b.warn(warning("unbalanced_design", "info",
                       f"The {what} have different numbers of people (from {min(ns)} to {max(ns)}). " + how))


def effect_phrase(term_label: str, is_interaction: bool) -> str:
    return (f"the interaction between {term_label.replace(' ' + TIMES + ' ', ' and ')}" if is_interaction
            else f"the main effect of {term_label}")


def term_sentence(r: Rich, rows: list[dict], alpha: float, level: float) -> Rich:
    """'... a significant main effect of A, F(1, 36) = 5.20, p = .029, η²p = .13, 95% CI [...]; ...'."""
    for n_, row in enumerate(rows):
        if n_:
            r.t("; " if n_ < len(rows) - 1 else "; and ")
        if row["f"] is None:
            r.t(f"{effect_phrase(row['label'], row['interaction'])} could not be tested")
            continue
        sig = row["p"] < alpha
        r.t(f"{'a significant' if sig else 'no significant'} {effect_phrase(row['label'], row['interaction'])[4:]}, ")
        r.stat("F", row["df"], row["f"]).t(", ").p(row["p"])
        pes = row["pes"]
        if pes.value is not None:
            r.t(", ").es(ETA_P, pes.value, pes.lower, pes.upper, level, bounded=True)
    return r.t(".")


def term_summary(rows: list[dict], alpha: float) -> str:
    parts = []
    for row in rows:
        if row["f"] is None:
            continue
        sig = row["p"] < alpha
        mag = magnitude(row["pes"].value, "eta_sq")
        size = f", {mag} in size" if mag and sig else ""
        if row["interaction"]:
            parts.append(("The difference between groups depended on the other factor (an interaction"
                          if sig else "There was no clear sign that the effect of one factor depended on the "
                          "other (no interaction") + f", {p_phrase(row['p'])}{size}).")
        else:
            parts.append((f"{row['label'][:1].upper() + row['label'][1:]} made a difference on its own"
                          if sig else f"{row['label'][:1].upper() + row['label'][1:]} did not clearly make a "
                          "difference on its own") + f" ({p_phrase(row['p'])}{size}).")
    return " ".join(parts)


def anova_table(title: str, rows: list[dict], error_rows: list[tuple[str, float, float]], level: float,
                note: Rich) -> dict:
    cols = [apa.column("source", "Source", "left"), apa.column("ss", Rich().i("SS")),
            apa.column("df", Rich().i("df")), apa.column("ms", Rich().i("MS")), apa.column("f", Rich().i("F")),
            apa.column("p", Rich().i("p")), apa.column("eta", ETA_P), apa.column("ci", f"{apa.level_text(level)} CI")]
    body = []
    blank = apa.cell_empty
    for row in rows:
        if row.get("error"):
            body.append(apa.row([apa.cell_text(row["label"]), apa.cell_num(row["ss"]), apa.cell_df(row["df"]),
                                 apa.cell_num(row["ss"] / row["df"] if row["df"] else None), blank(), blank(),
                                 blank(), blank()]))
            continue
        pes = row["pes"]
        body.append(apa.row([apa.cell_text(row["label"]), apa.cell_num(row.get("ss")), apa.cell_df(row["df"][0]),
                             apa.cell_num(row["ss"] / row["df"][0] if row.get("ss") is not None else None),
                             apa.cell_num(row["f"]), apa.cell_p(row["p"]), apa.cell_num(pes.value, bounded=True),
                             apa.cell_ci(pes.lower, pes.upper, bounded=True)], indent=row.get("indent", 0)))
        for sub in row.get("corrected", []):
            body.append(apa.row([apa.cell_text(sub["label"]), blank(), apa.cell_df(sub["df"][0] if sub["df"] else None),
                                 blank(), apa.cell_num(row["f"]), apa.cell_p(sub["p"]), blank(), blank()], indent=1))
    for lab, ss, dfe in error_rows:
        body.append(apa.row([apa.cell_text(lab), apa.cell_num(ss), apa.cell_df(dfe),
                             apa.cell_num(ss / dfe if dfe else None), blank(), blank(), blank(), blank()]))
    return apa.table(title, cols, body, general_note=note)


def cell_table(title: str, rows: list[dict], h1: str, h2: str, level: float) -> dict:
    cols = [apa.column("a", h1, "left"), apa.column("b", h2, "left"), apa.column("n", Rich().i("n")),
            apa.column("m", Rich().i("M")), apa.column("sd", Rich().i("SD")),
            apa.column("ci", f"{apa.level_text(level)} CI of the mean")]
    body = [apa.row([apa.cell_text(r["_a"]), apa.cell_text(r["_b"]), apa.cell_int(r["n"]), apa.cell_num(r["mean"]),
                     apa.cell_num(r["sd"]), apa.cell_ci(*((r["ci"]["lower"], r["ci"]["upper"]) if r["ci"]
                                                          else (None, None)))]) for r in rows]
    return apa.table(title, cols, body, number=2)


def factorial_descriptives(b: ResultBuilder, d: dict, level: float) -> list[dict]:
    rows, shown = [], []
    for i, lv_a in enumerate(d["al"]):
        for j, lv_b in enumerate(d["bl"]):
            r = cell(d["yname"], {d["aname"]: lv_a, d["bname"]: lv_b}, f"{d['anames'][i]}, {d['bnames'][j]}",
                     d["raw"][i][j], level)
            rows.append(r)
            shown.append({**r, "_a": d["anames"][i], "_b": d["bnames"][j]})
    b.descriptives(rows)
    return shown


def factorial_warnings(b: ResultBuilder, d: dict) -> None:
    counts = {f"{d['anames'][i]}, {d['bnames'][j]}": int(d["counts"][i, j])
              for i in range(len(d["al"])) for j in range(len(d["bl"]))}
    cell_counts_warning(b, counts)
    b.warn(ties_warning(d["y"], d["labs"]["y"]))
    b.warn(missing_warning(d["n_excluded"]))


def factorial_inputs(b: ResultBuilder, d: dict) -> None:
    b.inputs(d["n_used"], d["n_excluded"],
             [({d["aname"]: d["al"][i], d["bname"]: d["bl"][j]}, int(d["counts"][i, j]))
              for i in range(len(d["al"])) for j in range(len(d["bl"]))])


def term_labels(la: str, lb: str) -> dict:
    return {"A": la, "B": lb, "AB": f"{la} {TIMES} {lb}"}


# ---------------------------------------------------------------------------
# anova.factorial
# ---------------------------------------------------------------------------
@register("anova.factorial", label="Two-way (factorial) ANOVA", roles=FACTORIAL_ROLES, options={})
def factorial(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    require_two_sided(request, "A two-way ANOVA")
    level, alpha = request.ci_level, request.alpha
    d = factorial_data(df, request, meta)
    ka, kb = len(d["al"]), len(d["bl"])
    t = type3(d["y"], d["a"], d["b"], ka, kb)
    labels = term_labels(d["labs"]["a"], d["labs"]["b"])
    b = ResultBuilder(request)
    shown = factorial_descriptives(b, d, level)
    rows = []
    for key in ("A", "B", "AB"):
        tt = t[key]
        b.statistic("F", "F", "F", tt["f"], [tt["df"], t["error"]["df"]] if tt["f"] is not None else [], tt["p"],
                    term=labels[key])
        rows.append(dict(label=labels[key], ss=tt["ss"], df=[tt["df"], t["error"]["df"]], f=tt["f"], p=tt["p"],
                         interaction=key == "AB", key=key))
    for row in rows:
        es = factorial_effects(t, row["key"], d["n_used"], level)
        row["pes"] = es["partial_eta_sq"]
        b.effect("partial_eta_sq", "Partial eta squared", "η²p", es["partial_eta_sq"], "eta_sq", term=row["label"],
                 what="effect")
        b.effect("omega_sq", "Partial omega squared", "ω²p", es["omega_sq"], "eta_sq", term=row["label"], what="effect")
        b.effect("cohens_f", "Cohen's f", "f", es["cohens_f"], "cohens_f", term=row["label"], what="effect")

    cells = {f"{d['anames'][i]}, {d['bnames'][j]}": d["y"][(d["a"] == i) & (d["b"] == j)]
             for i in range(ka) for j in range(kb)}
    lev, _ = asm.levene_brown_forsythe(cells, asm.scope("overall", "all cells"), alpha,
                                       failed_note="Type III F tests are fairly robust when the groups are similar "
                                       "in size; with very unequal groups, read the results with care.")
    b.assumption(lev)
    b.assumption(*asm.shapiro_wilk(t["resid"], asm.scope("residuals", "model residuals"), alpha))
    factorial_warnings(b, d)
    if t["A"]["f"] is None:
        b.warn(constant_warning(f"{d['labs']['y']} within every group"))
    marg, inter = emmeans_between(d, t["error"]["ms"], t["error"]["df"], level)
    b.chart("marginal_means", marg).chart("interaction_plot", inter)
    factorial_inputs(b, d)

    r = Rich().t(f"A {ka} {TIMES} {kb} between-subjects ANOVA of {d['labs']['y']} ")
    if t["A"]["f"] is None:
        r.t("could not be computed because the scores do not vary within the groups.")
        summary = f"The two-way ANOVA could not be calculated because {d['labs']['y']} scores do not vary within the groups."
    else:
        r.t("showed ")
        term_sentence(r, rows, alpha, level)
        summary = (f"Mean {d['labs']['y']} was compared across the {ka * kb} groups formed by "
                   f"{d['labs']['a']} and {d['labs']['b']}. " + term_summary(rows, alpha))
        if rows[2]["f"] is not None and rows[2]["p"] < alpha:
            summary += (" Because of the interaction, the main effects should be read with care; simple-effects "
                        "tests show where the groups differ.")
    b.sentence(r).summary(summary)
    note = (Rich().t("Type III sums of squares (sum-to-zero contrasts). ").extend(ETA_P)
            .t(" = partial eta squared with its confidence interval."))
    b.table(anova_table(f"Two-Way ANOVA of {d['labs']['y']} by {d['labs']['a']} and {d['labs']['b']}", rows,
                        [("Error", t["error"]["ss"], t["error"]["df"])], level, note))
    b.extra_table(cell_table(f"Descriptive Statistics for {d['labs']['y']} by {d['labs']['a']} and {d['labs']['b']}",
                             shown, d["labs"]["a"], d["labs"]["b"], level))
    return b.build()
