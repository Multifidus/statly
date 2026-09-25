"""Exploratory factor analysis (SPEC §8 "Validity"). Reference: fixtures/r/factor.R (psych::fa).

Conventions (building blocks and their R equivalents in factor_utils.py):
- Items: numeric columns; rows with no answer at all are dropped. Correlations are pairwise-complete and
  n = rows with at least one answer (psych::fa / KMO / cortest.bartlett on the raw data).
- KMO = psych::KMO (overall + per item); Bartlett = psych::cortest.bartlett(R, n).
- Parallel analysis (always run; it also feeds the scree plot) = psych::fa.parallel(fa = "fa",
  fm = "minres", n.iter = options.parallel_iterations (100), quant = .95), sequential, after
  set.seed(options.seed (12345)); R's RNG is reproduced draw for draw. The suggestion is the number of
  leading observed factor eigenvalues above the simulated 95th percentile.
- Number of factors = options.n_factors, else the parallel-analysis suggestion (at least 1).
- Extraction psych::fa(fm = options.extraction): "minres" (default), "ml", "pa". Rotation
  options.rotation: "oblimin" (default, GPArotation quartimin), "varimax" (stats::varimax), "promax"
  (psych::kaiser + Promax, power 4), "none". Factors are signed so each column sums positive and sorted by
  SS loadings (with Phi when oblique), as psych does.
- Communalities h² = rowSums of the unrotated loadings²; uniqueness u² = 1 - h². Variance explained =
  SS loadings / number of items (psych Vaccounted). Loadings with |loading| < options.suppress (.30) are
  left blank in the APA table (never in chart_data).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from statly_engine.errors import InvalidParams
from statly_engine.stats import apa, prep
from statly_engine.stats import factor_utils as fu
from statly_engine.stats.apa import Rich
from statly_engine.stats.core import ResultBuilder, finite, warning
from statly_engine.stats.registry import Role, register

FACTOR_N = 100          # SPEC: factor analysis with fewer than ~100 respondents
MIN_ITEMS_PER_FACTOR = 3
EXTRACTION = {"minres": "minimum residual", "ml": "maximum likelihood", "pa": "principal axis"}
ROTATION = {"oblimin": "oblimin", "varimax": "varimax", "promax": "promax", "none": "no"}
OBLIQUE = {"oblimin", "promax"}


def kmo_label(v: float) -> str:
    """Kaiser (1974)."""
    for cut, word in ((0.9, "marvelous"), (0.8, "meritorious"), (0.7, "middling"), (0.6, "mediocre"),
                      (0.5, "miserable")):
        if v >= cut:
            return word
    return "unacceptable"


def factor_dof(p: int, k: int) -> float:
    return ((p - k) ** 2 - (p + k)) / 2


def _items(df, request, meta) -> dict:
    names = list(dict.fromkeys(request.variables["items"]))
    if len(names) < 3:
        raise InvalidParams("Factor analysis needs at least three different items.")
    x = np.column_stack([prep.numeric(df, v, meta).to_numpy() for v in names])
    has_any = np.isfinite(x).any(axis=1)
    x = x[has_any]
    labels = [prep.label(meta, v) for v in names]
    with np.errstate(all="ignore"):
        sd = np.array([np.nanstd(c, ddof=1) if np.isfinite(c).sum() > 1 else np.nan for c in x.T])
    flat = [lab for lab, s in zip(labels, sd) if not s > 0]
    if flat:
        raise InvalidParams(f"{', '.join(flat)} {'has' if len(flat) == 1 else 'have'} the same answer from everyone, "
                            "so there is nothing to factor. Remove "
                            f"{'it' if len(flat) == 1 else 'them'} and run the analysis again.")
    return {"names": names, "labels": labels, "x": x, "n_excluded": int((~has_any).sum())}


def _int_option(opts: dict, key: str, default: int, lo: int, hi: int, what: str) -> int:
    v = opts.get(key)
    if v is None:
        return default
    if isinstance(v, bool) or not isinstance(v, (int, float)) or int(v) != v or not lo <= v <= hi:
        raise InvalidParams(f"options.{key} must be a whole number from {lo} to {hi} ({what}).")
    return int(v)


def _choice(opts: dict, key: str, allowed: dict, default: str) -> str:
    v = opts.get(key) or default
    if v not in allowed:
        raise InvalidParams(f"options.{key} must be one of: {', '.join(allowed)}.")
    return v


def efa_compute(x: np.ndarray, n_factors: int | None, extraction: str, rotation: str, iterations: int,
                seed: int) -> dict:
    n, p = x.shape
    r = fu.pairwise_cor(x)
    if not np.all(np.isfinite(r)):
        raise InvalidParams("Some pairs of items have fewer than two people answering both, so their correlation "
                            "can't be estimated.")
    if np.linalg.eigvalsh(r)[0] < 1e-10:
        raise InvalidParams("The items' correlation matrix is singular (some items are exact combinations of others, "
                            "or there are too few people). Remove duplicated or total-score items and try again.")
    msa, msa_i = fu.kmo(r)
    chi2, bdf, bp = fu.bartlett(r, n)
    pa = fu.parallel_analysis(x, iterations, seed)
    max_k = max(k for k in range(1, p) if factor_dof(p, k) >= 0)
    notes = []
    if n_factors is None:
        s = pa["suggested"]
        if s is None:
            k, why = max_k, "all"
        elif s < 1:
            k, why = 1, "zero"
        else:
            k, why = min(s, max_k), None
        notes.append(why)
    else:
        if n_factors > max_k:
            raise InvalidParams(f"{n_factors} factors is too many for {p} items (at most {max_k} can be estimated).")
        k = n_factors
    fit = fu.EXTRACTORS[extraction](r, k)
    lam0 = fu.sign_unrotated(fit["loadings"])
    h2 = np.sum(lam0 ** 2, axis=1)
    rot = fu.rotate(lam0, rotation if k > 1 else "none")
    lam, phi = fu.orient(rot["loadings"], rot["phi"])
    ss = fu.ss_loadings(lam, phi)
    rr = r.copy()
    np.fill_diagonal(rr, h2)
    return {"n": n, "p": p, "r": r, "kmo": msa, "kmo_items": msa_i, "bartlett": (chi2, bdf, bp), "parallel": pa,
            "k": k, "pa_note": notes[0] if notes else None, "loadings": lam, "phi": phi, "h2": h2, "u2": 1 - h2,
            "ss": ss, "prop": ss / p, "eigenvalues": fu.eigvals_desc(r),
            "factor_eigenvalues": fit["values"] if "values" in fit else fu.eigvals_desc(rr),
            "converged": bool(fit["converged"] and rot["converged"]), "extraction": extraction,
            "rotation": rotation if k > 1 else "none"}


@register("validity.efa", label="Exploratory factor analysis",
          roles=[Role("items", 3, None, "Three or more items (numeric, e.g. Likert) to explore")],
          options={"n_factors": "Number of factors to extract (default: the parallel-analysis suggestion).",
                   "extraction": "\"minres\" (default, minimum residual), \"ml\" (maximum likelihood) or \"pa\" "
                                 "(principal axis).",
                   "rotation": "\"oblimin\" (default), \"promax\", \"varimax\" or \"none\".",
                   "suppress": "Hide loadings smaller than this in the table (default .30).",
                   "parallel_iterations": "Parallel-analysis simulations (default 100).",
                   "seed": "Random seed for parallel analysis (default 12345; same as R's set.seed).",
                   "scale_name": "Name of the scale for tables and text."})
def efa(df: pd.DataFrame, request, meta: dict | None = None) -> dict:
    opts = request.options or {}
    extraction = _choice(opts, "extraction", EXTRACTION, "minres")
    rotation = _choice(opts, "rotation", ROTATION, "oblimin")
    suppress = opts.get("suppress", 0.30)
    if isinstance(suppress, bool) or not isinstance(suppress, (int, float)) or not 0 <= suppress < 1:
        raise InvalidParams("options.suppress must be a number from 0 to 1 (for example .30).")
    iterations = _int_option(opts, "parallel_iterations", 100, 10, 5000, "simulations")
    seed = _int_option(opts, "seed", 12345, 0, 2 ** 31 - 1, "random seed")
    n_factors = None if opts.get("n_factors") is None else _int_option(opts, "n_factors", 1, 1, 1000, "factors")
    scale = opts.get("scale_name") or "the items"

    b = ResultBuilder(request)
    d = _items(df, request, meta)
    n, p = d["x"].shape
    if n < 3:
        raise InvalidParams(f"Factor analysis needs more people than this ({n}).")
    res = efa_compute(d["x"], n_factors, extraction, rotation, iterations, seed)
    k, lam, phi, pa = res["k"], res["loadings"], res["phi"], res["parallel"]
    chi2, bdf, bp = res["bartlett"]
    fnames = [f"F{j + 1}" for j in range(k)]
    cum = float(np.sum(res["prop"]))

    b.statistic("kmo", "Kaiser-Meyer-Olkin measure of sampling adequacy", "KMO", res["kmo"])
    b.statistic("bartlett_chi2", "Bartlett's test of sphericity", "χ²", chi2, [bdf], bp)
    b.statistic("n_factors", "Number of factors extracted", "k", k)
    b.statistic("parallel_suggested", "Factors suggested by parallel analysis", "k", pa["suggested"])
    b.statistic("variance_explained", "Proportion of variance explained (all factors)", "Var", cum)

    b.chart("scree", [{"number": i + 1, "eigenvalue": float(res["eigenvalues"][i]),
                       "factor_eigenvalue": float(pa["observed"][i]),
                       "simulated_mean": float(pa["sim_mean"][i]), "simulated_p95": float(pa["sim_p95"][i]),
                       "fitted_factor_eigenvalue": float(res["factor_eigenvalues"][i])} for i in range(p)])
    b.chart("loadings", [{"item": v, "label": lab, "factor": fnames[j], "factor_index": j + 1,
                          "loading": float(lam[i, j]), "salient": bool(abs(lam[i, j]) >= suppress)}
                         for i, (v, lab) in enumerate(zip(d["names"], d["labels"])) for j in range(k)])
    b.chart("communalities", [{"item": v, "label": lab, "communality": float(res["h2"][i]),
                               "uniqueness": float(res["u2"][i]), "kmo": float(res["kmo_items"][i])}
                              for i, (v, lab) in enumerate(zip(d["names"], d["labels"]))])
    b.chart("variance", [{"factor": fnames[j], "ss_loadings": float(res["ss"][j]), "proportion": float(res["prop"][j]),
                          "cumulative": float(np.sum(res["prop"][:j + 1]))} for j in range(k)])
    if phi is not None:
        b.chart("factor_correlations", [{"factor_a": fnames[a], "factor_b": fnames[c], "r": float(phi[a, c])}
                                        for a in range(k) for c in range(a + 1, k)])

    _warnings(b, d, res, suppress, request.alpha)
    b.inputs(n, d["n_excluded"])
    _tables(b, d, res, suppress, fnames, scale)
    _text(b, d, res, suppress, scale)
    return b.build()


def _warnings(b: ResultBuilder, d: dict, res: dict, suppress: float, alpha: float) -> None:
    n, k, lam = res["n"], res["k"], res["loadings"]
    labels = d["labels"]
    if n < FACTOR_N:
        b.warn(warning("factor_sample_size", "caution", f"Only {n} people answered. Factor analysis needs about "
                       f"{FACTOR_N} or more to give a stable picture of how items group; with fewer, the factors "
                       "and loadings can change a lot in a new sample. Treat these results as a first look."))
    if res["kmo"] < 0.6:
        b.warn(warning("low_sampling_adequacy", "serious" if res["kmo"] < 0.5 else "caution",
                       f"KMO is {apa.no_zero(res['kmo'])} ({kmo_label(res['kmo'])}). Values below .60 mean the items "
                       "share too little in common for factor analysis to be very useful."))
    if not res["bartlett"][2] < alpha:
        b.warn(warning("bartlett_not_significant", "caution", "Bartlett's test is not significant: the items are not "
                       "clearly more correlated than chance, so there may be no factors to find."))
    primary = np.argmax(np.abs(lam), axis=1)
    strong = np.abs(lam) >= suppress
    counts = [int(np.sum((primary == j) & strong[np.arange(len(primary)), primary])) for j in range(k)]
    thin = [f"F{j + 1}" for j, c in enumerate(counts) if c < MIN_ITEMS_PER_FACTOR]
    if thin:
        b.warn(warning("few_items_per_factor", "caution", f"{', '.join(thin)} {'is' if len(thin) == 1 else 'are'} "
                       f"defined by fewer than {MIN_ITEMS_PER_FACTOR} items. A factor needs at least three items "
                       "loading clearly on it to be trustworthy; consider extracting fewer factors."))
    cross = [labels[i] for i in range(len(labels)) if k > 1 and np.sum(strong[i]) > 1]
    if cross:
        b.warn(warning("cross_loadings", "info", f"{', '.join(cross)} load{'s' if len(cross) == 1 else ''} on more "
                       f"than one factor (|loading| >= {apa.no_zero(suppress)}). Such items don't belong clearly to "
                       "one factor; consider rewording or dropping them."))
    weak = [labels[i] for i in range(len(labels)) if not strong[i].any()]
    if weak:
        b.warn(warning("weak_items", "info", f"{', '.join(weak)} {'does' if len(weak) == 1 else 'do'} not load "
                       f"{apa.no_zero(suppress)} or more on any factor, so {'it does' if len(weak) == 1 else 'they do'} "
                       "not fit the factor structure well."))
    if np.any(res["h2"] >= fu.HEYWOOD - 1e-6):
        b.warn(warning("heywood_case", "serious", "An item's communality reached 1 (a Heywood case). This usually "
                       "means too many factors, too few people, or an item that duplicates another; interpret the "
                       "solution with caution."))
    if not res["converged"]:
        b.warn(warning("not_converged", "serious", "The factor solution did not fully converge, so the loadings may "
                       "be unreliable. Try fewer factors or a different rotation."))
    note = res["pa_note"]
    if note == "zero":
        b.warn(warning("parallel_no_factors", "caution", "Parallel analysis found no factor stronger than random data, "
                       "so one factor is shown. The items may not measure a common trait."))
    elif note == "all":
        b.warn(warning("parallel_all_factors", "caution", "Parallel analysis could not settle on a number of factors, "
                       f"so the largest estimable number ({res['k']}) is shown. Choose the number of factors yourself."))
    if np.isnan(d["x"]).any():
        b.warn(warning("missing_data", "info", "Some answers were missing. Each pair of items used everyone who "
                       "answered both (pairwise), as the psych package does."))
    if d["n_excluded"]:
        b.warn(warning("rows_dropped", "info", f"{d['n_excluded']} rows with no answers to any item were left out."))


def _tables(b: ResultBuilder, d: dict, res: dict, suppress: float, fnames: list[str], scale: str) -> None:
    k, lam, phi = res["k"], res["loadings"], res["phi"]
    title_scale = scale[0].upper() + scale[1:]
    order = sorted(range(len(d["names"])), key=lambda i: (int(np.argmax(np.abs(lam[i]))), -np.max(np.abs(lam[i]))))
    cols = [apa.column("item", "Item", "left")] + [apa.column(f, f"Factor {j + 1}") for j, f in enumerate(fnames)] + \
        [apa.column("h2", Rich().i("h").sup("2")), apa.column("u2", Rich().i("u").sup("2"))]
    rows = [apa.row([apa.cell_text(d["labels"][i])] +
                    [apa.cell_num(float(lam[i, j]), bounded=True) if abs(lam[i, j]) >= suppress else apa.cell_empty()
                     for j in range(k)] +
                    [apa.cell_num(float(res["h2"][i]), bounded=True), apa.cell_num(float(res["u2"][i]), bounded=True)])
            for i in order]
    rows.append(apa.row([apa.cell_text("% of variance")] + [apa.cell_num(100 * float(v)) for v in res["prop"]] +
                        [apa.cell_empty(), apa.cell_empty()], kind="total"))
    rot = res["rotation"]
    note = Rich().t(f"n = {res['n']}. {EXTRACTION[res['extraction']].capitalize()} extraction with "
                    f"{ROTATION[rot]} rotation{' (oblique)' if rot in OBLIQUE else ''}. Loadings below "
                    f"{apa.no_zero(suppress)} are not shown. ").i("h").sup("2").t(" = communality; ").i("u").sup("2") \
        .t(" = uniqueness.")
    if phi is not None:
        note.t(" With an oblique rotation the loadings are pattern coefficients.")
    b.table(apa.table(f"Factor Loadings for {title_scale}", cols, rows, general_note=note))

    num = 2
    vcols = [apa.column("f", "Factor", "left"), apa.column("ss", "SS loadings"), apa.column("pct", "% of variance"),
             apa.column("cum", "Cumulative %")]
    vrows = [apa.row([apa.cell_text(f"Factor {j + 1}"), apa.cell_num(float(res["ss"][j])),
                      apa.cell_num(100 * float(res["prop"][j])), apa.cell_num(100 * float(np.sum(res["prop"][:j + 1])))])
             for j in range(k)]
    vnote = "SS = sum of squared loadings" + (" (with the factor correlations, as in psych)." if phi is not None else ".")
    b.extra_table(apa.table("Variance Explained by Each Factor", vcols, vrows, number=num, general_note=vnote))
    if phi is not None:
        num += 1
        ccols = [apa.column("f", "Factor", "left")] + [apa.column(f, str(j + 1)) for j, f in enumerate(fnames)]
        crows = [apa.row([apa.cell_text(f"{a + 1}. Factor {a + 1}")] +
                         [apa.cell_num(float(phi[a, c]), bounded=True) if c < a else
                          (apa.cell_text(apa.EM_DASH) if c == a else apa.cell_empty()) for c in range(k)])
                 for a in range(k)]
        b.extra_table(apa.table("Factor Correlations", ccols, crows, number=num))
    num += 1
    pa = res["parallel"]
    pcols = [apa.column("f", "Factor", "left"), apa.column("obs", "Observed eigenvalue"),
             apa.column("mean", "Random data: mean"), apa.column("p95", "Random data: 95th percentile")]
    prows = [apa.row([apa.cell_int(i + 1), apa.cell_num(float(pa["observed"][i])), apa.cell_num(float(pa["sim_mean"][i])),
                      apa.cell_num(float(pa["sim_p95"][i]))]) for i in range(min(res["p"], max(k, (pa["suggested"] or 0)) + 3))]
    pnote = (f"Parallel analysis with {pa['iterations']} simulated data sets (seed {pa['seed']}); factor eigenvalues "
             f"from a one-factor minimum residual fit, as psych::fa.parallel. Suggested number of factors: "
             f"{pa['suggested'] if pa['suggested'] is not None else 'undetermined'}.")
    b.extra_table(apa.table("Parallel Analysis", pcols, prows, number=num, general_note=pnote))
    num += 1
    chi2, bdf, bp = res["bartlett"]
    kcols = [apa.column("item", "Item", "left"), apa.column("msa", "KMO (MSA)")]
    krows = [apa.row([apa.cell_text(lab), apa.cell_num(float(v), bounded=True)]) for lab, v in zip(d["labels"], res["kmo_items"])]
    knote = Rich().t(f"Overall KMO = {apa.no_zero(res['kmo'])} ({kmo_label(res['kmo'])}). Bartlett's test: ").i("χ").sup("2") \
        .t(f"({apa.df_text(bdf)}) = {apa.num(chi2)}, ").p(bp).t(".")
    b.extra_table(apa.table("Sampling Adequacy", kcols, krows, number=num, general_note=knote))


def _text(b: ResultBuilder, d: dict, res: dict, suppress: float, scale: str) -> None:
    k, lam = res["k"], res["loadings"]
    chi2, bdf, bp = res["bartlett"]
    cum = float(np.sum(res["prop"]))
    rot = res["rotation"]
    s = Rich().t(f"An exploratory factor analysis ({EXTRACTION[res['extraction']]} extraction, {ROTATION[rot]} "
                 f"rotation) of {res['p']} items (").i("n").t(f" = {res['n']}) retained {k} factor{'s' if k > 1 else ''}, "
                 f"explaining {apa.num(100 * cum, 1)}% of the variance. Sampling adequacy was {kmo_label(res['kmo'])}, "
                 f"KMO = {apa.no_zero(res['kmo'])}, and Bartlett's test was ")
    s.t("significant, " if finite(bp) and bp < 0.05 else "not significant, ").i("χ").sup("2") \
        .t(f"({apa.df_text(bdf)}) = {apa.num(chi2)}, ").p(bp).t(".")
    pa_s = res["parallel"]["suggested"]
    groups = []
    for j in range(k):
        items = [d["labels"][i] for i in range(len(d["labels"]))
                 if int(np.argmax(np.abs(lam[i]))) == j and abs(lam[i, j]) >= suppress]
        groups.append(f"factor {j + 1}: {', '.join(items) if items else 'no clear items'}")
    how = ("the number suggested by parallel analysis" if res["pa_note"] is None and pa_s == k and
           b.request.options.get("n_factors") is None else "the number you chose")
    summary = (f"The answers to {scale} group into {k} factor{'s' if k > 1 else ''} ({how}; parallel analysis "
               f"suggested {pa_s if pa_s is not None else 'no clear number'}). Together they account for "
               f"{apa.num(100 * cum, 0)}% of the variation in the items. Items that belong together: "
               f"{'; '.join(groups)}. The data were {kmo_label(res['kmo'])} for factor analysis "
               f"(KMO = {apa.no_zero(res['kmo'])}; .60 or higher is usually considered adequate).")
    b.sentence(s).summary(summary)
