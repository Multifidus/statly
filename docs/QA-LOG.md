# Owner QA log

Findings from the owner's phased testing, started 2026-09-26. Status: fixed = committed on main.

| # | Finding | Status |
|---|---------|--------|
| 1 | Duplicate "Leave out unfinished responses" option on clean-up | fixed |
| 2 | No way back to Home or Import once data is loaded | fixed |
| 3 | Import wizard remembered the previous file | fixed |
| 4 | "Unsaved changes" overlapping Export; "Test Log" tab wrapping | fixed |
| 5 | Cmd+Q quit without the unsaved-changes prompt | fixed |
| 6 | Answer choices step didn't explain number-coded answers; no presets | fixed |
| 7 | Scales step unclear (what a scale is, stem, naming, negatively worded) | fixed |
| 8 | Scale scores step didn't say what a scale score is; no worked example | fixed |
| 9 | Tied-ranks advisor question should be auto-answered | fixed |
| 10 | Summaries used variable names instead of question text | fixed |
| 11 | Raw asterisks/underscores in "How to report this" | fixed |
| 12 | "1 rows were left out" | fixed |
| 13 | Lowercase glossary term opening a sentence | fixed |
| 14 | Assumption verdicts didn't say why | fixed |
| 15 | One-sample test ran against 0 without asking | fixed |
| 16 | "Import data…" replaced the open project instead of offering a new one | fixed |
| 17 | Statly wordmark had no hover cue | fixed |
| 18 | Clean-up filters listed once per file on review/complete | fixed |
| 19 | Summary effect-size label didn't match the number shown | fixed |
| 20 | Unpairable rows described as "missing answers" | fixed |
| 21 | Yes/no variables missing from the advisor outcome picker | fixed |
| 22 | Chi-square summary didn't say which group differed | fixed |
| 23 | Cramér's V CI upper bound 1.00 (one-sided convention) | fixed, two-sided |
| 24 | Small expected counts never switched to Fisher | fixed |
| 25 | No one-click "Run Fisher's exact test instead" | fixed |
| 26 | No way to delete a Test Log entry | fixed |
| 27 | Ties note shown for categorical outcomes | fixed |
| 28 | Expected-counts check page had placeholder "What it is" | fixed |
| 29 | Decision step used generic t-test blurbs for every test | fixed |
| 30 | Descriptives table used raw names while summary used labels | fixed |
| 31 | Question-text labels unquoted in prose | fixed |
| 32 | Recommendation card: headings wrap; wants two clean columns | fixed |
| 33 | Chart builder numbers table: "1 rows used" | fixed |
| 34 | Summary stat chip shows d_z while the sentence names d_av | fixed |
| 35 | d_av / d_z shown with literal underscores outside the APA sentence | fixed |
| 36 | "Because the p value…" is a fragment after "looks reasonable." | fixed |
| 37 | Comparison-value hint should say where the suggested 3 came from | fixed |
| 38 | "Start another analysis" keeps the previous advisor answers; should clear them and keep the outcome | open |
| 39 | Correlation tied-ranks auto-answer only sees the outcome; ask for the second variable first or re-check at setup | open |
| 40 | Chart builder: pin "Save chart" in a sticky bar; warn before leaving with an unsaved chart | fixed |
| 41 | Report export never includes Chart Builder charts saved in the project ("Charts" meant per-test charts only) | fixed |
| 42 | PDF export: subscripts (d_av, d_z) drop into the table rule and the next line | fixed |
| 43 | Copy table: numeric cells wrap ("-5.86", "< .001") when pasted; mark them no-wrap | fixed |
| 44 | Responses: tag menu stays open after picking a tag; should close (number keys cover multi-tagging) | fixed |
| 45 | Data tab: after creating columns (yes/no tags, computed), jump to and highlight the new columns | fixed |
| 46 | Every advisor/planner question and option needs an inline explanation with an example (learning tool) | fixed |
| 47 | Planner sample-size page never states that bigger effects need fewer people; add the sentence under the effect picker | fixed |
| 48 | Planner plan page: pin Save plan / Export Word / Start analysis project in a sticky bar | open |
| 49 | Exported figures: axis titles/tick labels use the dark-theme muted grey on white paper (nearly invisible in PDF) | open |
| 50 | Import check step: repeated per-column notes (e.g. seven '-99' lines) should be grouped into one | open |

Parked for v1.1: guided learning mode (learner must pick the right advisor answers); Word survey import (Qualtrics .docx export was truncated/malformed; QSF is the route).
