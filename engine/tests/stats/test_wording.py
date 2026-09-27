"""Plain-language summary <-> APA sentence consistency (SPEC §8): for every family that reports
more than one effect size, the summary's headline effect size and its size label must name the
same measure the APA sentence uses (owner bug: paired t summary said "small" next to a d_z of
-0.69 while the APA sentence reported d_av = -0.29, a small difference). Also covers the variable
label fallback (label -> question_text -> name, SPEC §5.5).
"""

from __future__ import annotations

import pandas as pd

from statly_engine.stats import apa, registry

from .conftest import EXPECTED, load_fixture, run_fixture


def _apa_text(res: dict) -> str:
    return "".join(r["text"] for r in res["apa_sentence"])


def _headline(res: dict, key: str) -> dict:
    es = next(e for e in res["effect_sizes"] if e["key"] == key)
    assert es["value"] is not None
    return es


def test_paired_ttest_summary_names_d_av_not_d_z():
    fx = load_fixture(EXPECTED / "t_test.paired" / "basic.json")
    res = run_fixture(fx)
    dav = _headline(res, "d_av")
    formatted = apa.num(dav["value"])
    assert f"Cohen's d_av = {formatted}" in res["plain_language_summary"]
    assert f"= {formatted}" in _apa_text(res)
    # d_z stays out of the headline summary sentence even though it's still reported.
    dz = _headline(res, "d_z")
    assert apa.num(dz["value"]) not in res["plain_language_summary"].split(".")[-2]


def test_independent_ttest_summary_names_hedges_g():
    fx = load_fixture(EXPECTED / "t_test.independent" / "basic.json")
    res = run_fixture(fx)
    g = _headline(res, "hedges_g")
    formatted = apa.num(g["value"])
    assert f"Hedges' g = {formatted}" in res["plain_language_summary"]
    assert f"= {formatted}" in _apa_text(res)


def test_one_sample_ttest_summary_names_cohens_d():
    fx = load_fixture(EXPECTED / "t_test.one_sample" / "greater.json")
    res = run_fixture(fx)
    d = _headline(res, "cohens_d")
    formatted = apa.num(d["value"])
    assert f"Cohen's d = {formatted}" in res["plain_language_summary"]
    assert f"= {formatted}" in _apa_text(res)


def test_oneway_anova_summary_names_eta_sq():
    fx = load_fixture(EXPECTED / "anova" / "one_way__four_unequal.json")
    res = run_fixture(fx)
    eta = _headline(res, "eta_sq")
    formatted = apa.no_zero(eta["value"])
    assert f"η² = {formatted}" in res["plain_language_summary"]
    assert f"= {formatted}" in _apa_text(res)


def test_rm_anova_summary_names_partial_eta_sq():
    fx = load_fixture(EXPECTED / "anova" / "rm__three_wide.json")
    res = run_fixture(fx)
    pes = _headline(res, "partial_eta_sq")
    formatted = apa.no_zero(pes["value"])
    assert f"partial η² = {formatted}" in res["plain_language_summary"]
    assert f"= {formatted}" in _apa_text(res)


def test_chi_square_summary_names_cramers_v():
    fx = load_fixture(EXPECTED / "chi_square.independence" / "3x4.json")
    res = run_fixture(fx)
    v = _headline(res, "cramers_v")
    formatted = apa.no_zero(v["value"])
    assert f"Cramér's V = {formatted}" in res["plain_language_summary"]
    assert f"= {formatted}" in _apa_text(res)


def _req(analysis_id, variables, **options):
    return {"schema_version": 1, "request_id": "t", "analysis_id": analysis_id, "dataset_id": "d",
            "snapshot_id": "s", "variables": variables, "subset": [], "options": options, "corrections": [],
            "alpha": 0.05, "tails": "two_sided", "ci_level": 0.95}


def test_variable_label_falls_back_to_question_text_then_name():
    """SPEC §5.5: label resolution is label -> question_text (header/question stored at import) ->
    bare name, and every summary/APA builder must go through it (owner bug: a variable with question
    text but no short label showed up as its bare column name, e.g. "Q6", in the summary)."""
    df = pd.DataFrame({"Q6": [1, 2, 3, 4, 5, 2, 3, 4]})
    meta = {"variables": [
        {"name": "Q6", "label": None, "question_text": "How satisfied are you with the classroom experience?",
         "dtype": "integer"},
    ]}
    res = registry.run(df, _req("t_test.one_sample", {"outcome": ["Q6"]}, test_value=3), meta=meta)
    apa_text = "".join(r["text"] for r in res["apa_sentence"])
    # Question-length labels are quoted when embedded mid-sentence (prep.label_in_prose /
    # quote_if_sentence), so they read clearly next to the surrounding prose.
    quoted = "“How satisfied are you with the classroom experience?”"
    assert quoted in apa_text
    assert quoted in res["plain_language_summary"]
    assert "Q6" not in apa_text and "Q6" not in res["plain_language_summary"]
    # The APA table title, in contrast, keeps the label unquoted.
    assert "How satisfied are you with the classroom experience?" in res["apa_table"]["title"]
    assert "“" not in res["apa_table"]["title"]

    # no label and no question_text -> falls back to the bare name
    meta_bare = {"variables": [{"name": "Q6", "label": None, "question_text": None, "dtype": "integer"}]}
    res_bare = registry.run(df, _req("t_test.one_sample", {"outcome": ["Q6"]}, test_value=3), meta=meta_bare)
    assert "Q6" in "".join(r["text"] for r in res_bare["apa_sentence"])


def test_label_in_prose_quotes_only_question_length_labels():
    """prep.label_in_prose / quote_if_sentence: a short label is unchanged; a label that reads as a
    question or sentence is wrapped in typographic quotes so it's parseable mid-sentence."""
    from statly_engine.stats import prep

    short_meta = {"variables": [{"name": "Q1", "label": "Program", "dtype": "integer"}]}
    assert prep.label_in_prose(short_meta, "Q1") == "Program"

    question_meta = {"variables": [{"name": "Q1", "label": "What is your program?", "dtype": "integer"}]}
    assert prep.label_in_prose(question_meta, "Q1") == "“What is your program?”"

    long_meta = {"variables": [{"name": "Q1", "label": "This is a fairly long label about six words",
                                "dtype": "integer"}]}
    assert prep.label_in_prose(long_meta, "Q1").startswith("“")

    assert prep.quote_if_sentence("Short") == "Short"
    assert prep.quote_if_sentence("Are you satisfied?") == "“Are you satisfied?”"


def test_chi_square_summary_quotes_question_labels_owner_example():
    """Owner bug: with two question-text labels, the summary read "What is your program? and Did you
    pass the course? appear to be related", which is hard to parse. Both labels should be quoted in
    the summary and APA sentence, and unquoted in the crosstab table title."""
    df = pd.DataFrame({"Q1": ["A", "B", "A", "B", "A", "B", "A", "B"],
                       "Q2": ["Y", "N", "Y", "N", "N", "Y", "Y", "N"]})
    meta = {"variables": [
        {"name": "Q1", "label": None, "question_text": "What is your program?", "dtype": "string"},
        {"name": "Q2", "label": None, "question_text": "Did you pass the course?", "dtype": "string"},
    ]}
    res = registry.run(df, _req("chi_square.independence", {"row": ["Q1"], "column": ["Q2"]}), meta=meta)
    apa_text = "".join(r["text"] for r in res["apa_sentence"])
    q1, q2 = "“What is your program?”", "“Did you pass the course?”"
    assert q1 in apa_text and q1 in res["plain_language_summary"]
    assert q2 in apa_text and q2 in res["plain_language_summary"]
    assert "“" not in res["apa_table"]["title"]
    assert "What is your program?" in res["apa_table"]["title"]


def test_categorical_descriptives_use_labels_not_raw_names():
    """Owner bug: the descriptives block on chi-square/Fisher still showed the raw variable names
    (e.g. "Q4") while the summary used labels. The frequency tables added to additional_tables for
    the row/column variables should use the same resolved (unquoted) label as the crosstab title."""
    df = pd.DataFrame({"Q3": ["A", "B", "A", "B", "A", "B", "A", "B"],
                       "Q4": ["Y", "N", "Y", "N", "N", "Y", "Y", "N"]})
    meta = {"variables": [
        {"name": "Q3", "label": "Program", "dtype": "string"},
        {"name": "Q4", "label": "Passed", "dtype": "string"},
    ]}
    res = registry.run(df, _req("chi_square.independence", {"row": ["Q3"], "column": ["Q4"]}), meta=meta)
    titles = [t["title"] for t in res["additional_tables"]]
    assert any("Program" in t for t in titles)
    assert any("Passed" in t for t in titles)
    assert not any("Q3" in t or "Q4" in t for t in titles)


def test_paired_ttest_excluded_reasons_break_down_by_cause():
    """Owner bug: the paired subtitle said "15 left out for missing answers" when the 15 were
    unpairable (one time point, or a duplicate ID), not missing answers. inputs.excluded_reasons
    (contracts/AnalysisResult.json) lets the caller show the real cause instead of defaulting to
    "missing answers"."""
    df = pd.DataFrame({
        "id": ["a", "a", "b", "b", "c", "c", "c", "d", "e", "f", "f"],
        "time": ["Pre", "Post", "Pre", "Post", "Pre", "Pre", "Post", "Pre", "Pre", "Pre", "Post"],
        "score": [1, 2, 3, 4, 5, 6, 7, 8, None, 9, 10],
    })
    res = registry.run(df, _req("t_test.paired", {"outcome": ["score"], "time": ["time"], "subject_id": ["id"]},
                                levels=["Pre", "Post"]))
    reasons = {r["code"]: r for r in res["inputs"]["excluded_reasons"]}
    # counts are people/IDs (matching the pairs_dropped warning text), not raw excluded rows.
    assert reasons["unpaired_one_side"]["count"] == 2   # d (Pre only), e (Pre only, and missing score)
    assert reasons["duplicate_id"]["count"] == 1        # c (two Pre rows)
    warn = next(w for w in res["warnings"] if w["code"] == "pairs_dropped")
    assert "only one of the two time points" in warn["message"]
    assert "appear more than once" in warn["message"]
    assert "missing answers" not in warn["message"]
