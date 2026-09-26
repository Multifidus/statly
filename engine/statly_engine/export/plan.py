"""Study Planner DOCX (SPEC §11.2): a StudyPlan rendered as a plain-language plan document.

Sections, in order: title + date line, research question (optional), design summary, the design
interview answers (optional, as the app shows them), planned analyses with rationale, sample size
(one block per power analysis), data-collection recommendations grouped by category, and a
checklist of assumptions to check once the data are in.

The plan is validated against the StudyPlan contract by the RPC handler; `labels` (analysis /
assumption / effect-size id -> readable label) and `interview` ({question, answer} pairs) are
optional display extras sent by the app, since the plan itself stores ids.
"""

from __future__ import annotations

from datetime import datetime

from statly_engine.export import run

CATEGORY_TITLES = {
    "design": "Study design",
    "data_collection": "Collecting your data",
    "qualtrics_setup": "Setting up your Qualtrics survey",
    "analysis": "Analysing your data later",
}
CATEGORY_ORDER = ("design", "data_collection", "qualtrics_setup", "analysis")
RESEARCH_QUESTION_KEY = "planner_research_question"

METRIC_SYMBOL = {"d": "d", "d_z": "d_z", "f": "f", "r": "r", "w": "w", "f_sq": "f²", "f2": "f²"}
TAILS = {"two_sided": "two-sided", "greater": "one-sided (greater)", "less": "one-sided (less)"}


def _humanize(key: str) -> str:
    text = key.replace(".", " ").replace("_", " ").strip()
    return text[:1].upper() + text[1:] if text else key


def label_for(key: str | None, labels: dict[str, str]) -> str:
    if not key:
        return ""
    return labels.get(key) or _humanize(key)


def _num(v: float | None, digits: int = 2) -> str:
    if v is None:
        return "—"
    s = f"{v:.{digits}f}"
    return s


def _date(iso: str) -> str:
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).strftime("%B %d, %Y").replace(" 0", " ")
    except ValueError:
        return iso


def power_rows(pa: dict) -> list[list[str]]:
    """Input / result rows of one PowerAnalysis for a two-column grid."""
    i, o = pa["inputs"], pa.get("outputs")
    sym = METRIC_SYMBOL.get(i["effect_size_metric"], i["effect_size_metric"])
    rows = [["Calculation", "Sample size needed (a priori)" if pa["mode"] == "a_priori"
             else "Smallest effect you could detect (sensitivity)"],
            ["Planned for", _humanize(pa["analysis_id"])],
            ["Significance level (α)", f"{i['alpha']:g}"],
            ["Tails", TAILS.get(i["tails"], i["tails"])]]
    if i.get("power") is not None:
        rows.append(["Target power", f"{i['power']:g}"])
    if i.get("effect_size") is not None:
        rows.append(["Expected effect", f"{sym} = {_num(i['effect_size'])}"])
    extras = (("n_groups", "Groups"), ("n_measurements", "Measurements per person"),
              ("correlation_among_measures", "Correlation between repeated measures"),
              ("nonsphericity_epsilon", "Nonsphericity correction (ε)"), ("n_predictors", "Predictors"),
              ("df", "Degrees of freedom"), ("allocation_ratio", "Group size ratio (group 2 ÷ group 1)"))
    for k, lbl in extras:
        if i.get(k) is not None:
            rows.append([lbl, f"{i[k]:g}"])
    if pa["mode"] == "sensitivity" and i.get("n_total") is not None:
        rows.append(["Planned total sample (N)", str(i["n_total"])])
    if o:
        if pa["mode"] == "a_priori" and o.get("n_total") is not None:
            rows.append(["Total sample needed (N)", str(o["n_total"])])
        if o.get("n_per_group"):
            rows.append(["Per group", ", ".join(str(n) for n in o["n_per_group"])])
        if o.get("detectable_effect") is not None:
            rows.append(["Smallest detectable effect", f"{sym} = {_num(o['detectable_effect'])}"])
        if o.get("achieved_power") is not None:
            rows.append(["Power at this sample size", _num(o["achieved_power"], 3)])
        if o.get("method_note"):
            rows.append(["Method", o["method_note"]])
    return rows


def power_sentence(pa: dict) -> str:
    i, o = pa["inputs"], pa.get("outputs") or {}
    sym = METRIC_SYMBOL.get(i["effect_size_metric"], i["effect_size_metric"])
    if pa["mode"] == "a_priori":
        if o.get("n_total") is None:
            return "This calculation has not been run yet."
        pct = f"{(i.get('power') or 0.8) * 100:g}%"
        return (f"To have a {pct} chance of detecting an effect of {sym} = {_num(i['effect_size'])} at "
                f"α = {i['alpha']:g}, plan for about {o['n_total']} people in total. Recruit a few more to "
                "allow for people who drop out or skip questions.")
    if o.get("detectable_effect") is None:
        return "This calculation has not been run yet."
    return (f"With {i.get('n_total')} people, the smallest effect you could reliably detect is about "
            f"{sym} = {_num(o['detectable_effect'])}. Smaller real effects would often be missed.")


def assumption_checklist(plan: dict, labels: dict[str, str]) -> list[str]:
    seen: list[str] = []
    for a in plan["planned_analyses"]:
        for key in a["assumptions_to_check"]:
            if key not in seen:
                seen.append(key)
    return [label_for(k, labels) for k in seen]


def write_docx(path: str, plan: dict, labels: dict[str, str] | None = None,
               interview: list[dict] | None = None) -> None:
    from statly_engine.export import docx as dx

    labels = labels or {}
    doc = dx.new_document()
    doc.core_properties.title = plan["title"]
    doc.add_paragraph(plan["title"], style="Title")
    dx.paragraph(doc, [run(f"Study plan made with Statly on {_date(plan['modified_at'])}.", italic=True)])

    rq = plan["design"]["answers"].get(RESEARCH_QUESTION_KEY)
    if isinstance(rq, str) and rq.strip():
        doc.add_paragraph("Research question", style="Heading 1")
        dx.paragraph(doc, [run(rq.strip())])

    doc.add_paragraph("Design summary", style="Heading 1")
    for part in [p for p in plan["design"]["summary"].split("\n") if p.strip()]:
        dx.paragraph(doc, [run(part.strip())])
    if interview:
        dx.paragraph(doc, [run("Your answers to the design questions:", bold=True)], space_after=3)
        dx.add_grid(doc, ["Question", "Your answer"],
                    [[str(x.get("question", "")), str(x.get("answer", ""))] for x in interview],
                    widths=[3.5, 3.0])
        doc.add_paragraph()

    doc.add_paragraph("Planned analyses", style="Heading 1")
    if not plan["planned_analyses"]:
        dx.paragraph(doc, [run("No analyses planned yet.")])
    for a in plan["planned_analyses"]:
        doc.add_paragraph(a["label"] or label_for(a["analysis_id"], labels), style="Heading 2")
        dx.paragraph(doc, [run("Why: ", bold=True), run(a["rationale"])])
        if a.get("nonparametric_alternative"):
            dx.paragraph(doc, [run("If its assumptions don't hold: ", bold=True),
                               run(label_for(a["nonparametric_alternative"], labels))])
        if a.get("effect_size"):
            dx.paragraph(doc, [run("Effect size to report: ", bold=True), run(label_for(a["effect_size"], labels))])
        if a["assumptions_to_check"]:
            dx.paragraph(doc, [run("Assumptions to check: ", bold=True),
                               run(", ".join(label_for(k, labels) for k in a["assumptions_to_check"]))])
        if a["follow_ups"]:
            dx.paragraph(doc, [run("Follow-up tests: ", bold=True),
                               run(", ".join(label_for(k, labels) for k in a["follow_ups"]))])

    doc.add_paragraph("Sample size (power analysis)", style="Heading 1")
    if not plan["power_analyses"]:
        dx.paragraph(doc, [run("No power analysis yet.")])
    for pa in plan["power_analyses"]:
        doc.add_paragraph("Sample size needed" if pa["mode"] == "a_priori" else "What your sample can detect",
                          style="Heading 2")
        dx.paragraph(doc, [run(power_sentence(pa))])
        dx.add_grid(doc, ["Input or result", "Value"], power_rows(pa), widths=[2.6, 3.9])
        doc.add_paragraph()

    doc.add_paragraph("Data collection recommendations", style="Heading 1")
    recs = plan["recommendations"]
    if not recs:
        dx.paragraph(doc, [run("No recommendations.")])
    for cat in CATEGORY_ORDER:
        items = [r for r in recs if r["category"] == cat]
        if not items:
            continue
        doc.add_paragraph(CATEGORY_TITLES[cat], style="Heading 2")
        for r in items:
            p = doc.add_paragraph(style="List Bullet")
            dx.add_runs(p, [run(r["text"]), run(" Why it matters: ", italic=True), run(r["why"], italic=True)])

    checklist = assumption_checklist(plan, labels)
    doc.add_paragraph("Assumptions to check after you collect data", style="Heading 1")
    if checklist:
        for item in checklist:
            doc.add_paragraph(f"☐ {item}", style="List Bullet")
    else:
        dx.paragraph(doc, [run("None for the planned analyses.")])
    doc.save(path)
