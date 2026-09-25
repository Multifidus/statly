"""Test Log export (SPEC §9, §10.3): one row per TestLogEntry as XLSX, CSV or DOCX.

TestLogEntry carries raw numbers (primary statistic, p, effect size, adjusted p); they are formatted
here with stats/apa.py so the log reads exactly like the results screen. The APA sentence and
plain-language summary are the engine's own text, copied verbatim.
"""

from __future__ import annotations

import csv

from statly_engine.export import plain
from statly_engine.stats import apa

HEADERS = ["#", "Date", "Analysis", "Outcome(s)", "Statistic", "p", "Effect size", "N", "Family",
           "Correction", "Adjusted p", "APA sentence", "Plain-language summary", "Engine version"]
CORRECTION_WORDS = {"none": "None", "bonferroni": "Bonferroni", "holm": "Holm",
                    "fdr_bh": "Benjamini-Hochberg (FDR)"}
# Effect sizes bounded by 1 in magnitude: no leading zero (APA).
BOUNDED_ES = {"r", "rank_biserial", "eta_sq", "partial_eta_sq", "omega_sq", "partial_omega_sq", "epsilon_sq",
              "kendall_w", "cramers_v", "phi", "r_sq", "adj_r_sq", "alpha", "omega", "kappa", "icc", "rho",
              "tau", "tau_b", "spearman_rho", "kendall_tau", "pearson_r", "point_biserial", "cohens_kappa"}
BOUNDED_SYMBOLS = {"r", "ρ", "τ", "τb", "η²", "ηp²", "η²p", "ω²", "ε²", "V", "φ", "W", "R²", "κ", "α", "ω", "r_rb"}


def statistic_runs(st: dict | None) -> list[dict]:
    if not st or st.get("value") is None:
        return []
    return apa.Rich().stat(st["symbol"], st.get("df") or [], st["value"]).runs


def effect_runs(es: dict | None) -> list[dict]:
    if not es or es.get("value") is None:
        return []
    ci = es.get("ci") or {}
    return apa.Rich().es(es["symbol"], es["value"], ci.get("lower"), ci.get("upper"), ci.get("level", 0.95),
                         bounded=es.get("key") in BOUNDED_ES or es["symbol"] in BOUNDED_SYMBOLS).runs


def row_runs(i: int, e: dict) -> list:
    """One log row; rich cells are RichText run lists, the rest plain strings."""
    s = e["result_summary"]
    return [
        str(i), e["timestamp"][:10], s["analysis_label"], ", ".join(s.get("outcome_variables") or []),
        statistic_runs(s.get("primary_statistic")), apa.p_value(s.get("p")) if s.get("p") is not None else "",
        effect_runs(s.get("primary_effect_size")), str(s.get("n_used", "")), e.get("family_id") or "",
        CORRECTION_WORDS.get(e.get("correction_method"), str(e.get("correction_method"))),
        apa.p_value(e["adjusted_p"]) if e.get("adjusted_p") is not None else "",
        s.get("apa_sentence") or [], s.get("plain_language_summary", ""), s.get("engine_version", ""),
    ]


def plain_rows(entries: list[dict]) -> list[list[str]]:
    return [[c if isinstance(c, str) else plain(c) for c in row_runs(i, e)] for i, e in enumerate(entries, 1)]


def write(path: str, fmt: str, entries: list[dict], title: str = "Test Log") -> None:
    if fmt == "csv":
        with open(path, "w", encoding="utf-8-sig", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(HEADERS)
            w.writerows(plain_rows(entries))
        return
    if fmt == "xlsx":
        from statly_engine.export import write_xlsx_sheets
        write_xlsx_sheets(path, [("Test Log", HEADERS, plain_rows(entries))])
        return
    from statly_engine.export import docx as dx

    doc = dx.new_document(landscape=True)
    doc.core_properties.title = title
    doc.add_paragraph(title, style="Title")
    keep = [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11]  # the DOCX drops family id, summary, engine version
    rows = [[r[k] for k in keep] for r in (row_runs(i, e) for i, e in enumerate(entries, 1))]
    dx.add_grid(doc, [HEADERS[k] for k in keep], rows, font_size=9,
                widths=[0.3, 0.8, 1.2, 0.8, 0.9, 0.5, 1.2, 0.4, 0.8, 0.6, 1.5])
    doc.save(path)
