---
id: which-intervention-worked-best
title: "Which intervention worked best?"
dataset: three_groups_prepost_followup
reading_level_target: "8-10"
---

## Goal

You ran a study with three groups (Control, Intervention A, Intervention B),
each taking a 20-item knowledge test at three points: before, right after,
and a follow-up weeks later. By the end of this tutorial you will have
scored the raw test answers against an answer key, compared the three
groups, and found out which specific pairs of groups actually differ.

## Dataset

`fixtures/practice/three_groups_prepost_followup/`: `pre.csv`, `post.csv`,
`followup.csv`, plus `answer_key.csv`. Group is stored as text
(`Control`, `Intervention A`, `Intervention B`). Test items (`Q4_1`-`Q4_20`)
are raw answer choices (A-D), not pre-scored. Group sizes shrink over time
as some students didn't complete every wave.

## Steps

1. **Click "New project."** Screen: Home.
   You see: the welcome screen.
   Expected result: the import wizard's "Choose files" step opens.

2. **Choose your files.** Screen: Choose files.
   Check `pre.csv`, `post.csv`, and `followup.csv`, then click Open.
   You see: all three files listed.
   Why this matters: one study, three time points, in three separate
   exports. Statly needs all three to build the full picture.
   Expected result: the wizard moves to detection.

3. **Check the detection screen.** Screen: Check how we read them.
   You see: row and column counts for each file.
   Why this matters: a quick sanity check that nothing got cut off or
   misread before you commit to the import.
   Expected result: you continue.

4. **Review survey clean-up.** Screen: Survey clean-up.
   You see: Statly notes that the group column (`Q2`) holds text labels
   like "Control" and "Intervention A," not numeric codes.
   Why this matters: if Statly mistook the group column for a number, it
   would try to average "Control" and "Intervention A" together, which
   makes no sense. Reading it as a category keeps the three groups
   separate.
   Expected result: you continue.

5. **Import.** Screen: Review and import.
   You see: a final count, noting that the number of rows shrinks from
   `pre` to `post` to `followup` (students who didn't finish every wave).
   Why this matters: knowing up front that the groups get smaller over
   time helps you understand why later results have a wider margin of
   error.
   Expected result: the Variable Interview starts.

6. **Score the test against the answer key.** Screen: Variable Interview,
   Test scoring step.
   You see: the 20 raw-choice items lined up against the answer key, with
   a preview of the resulting total score.
   Why this test: the raw items are letters (A, B, C, D), not points.
   Statly needs to know which letter was correct for each question before
   it can add up a score.
   Expected result: a new total-score variable is created for every
   student, at every time point.

7. **Look at the new variable.** Screen: Variables.
   You see: the new scored-total column alongside the raw items.
   Why this matters: this is the number you'll actually compare across
   groups, not the 20 individual answer choices.
   Expected result: a total score shows for each row.

8. **Ask the Test Advisor what you want to know.** Screen: Analyze.
   Answer "Did scores change over time, or differ between groups?", then
   "Independent groups," then "Three or more."
   Why this test: with three separate groups, running three separate
   t-tests (Control vs A, Control vs B, A vs B) would multiply your
   chance of a false positive. An ANOVA compares all three at once, in a
   single test.
   Expected result: a recommendation appears.

9. **Read the recommendation.** Screen: Analyze, recommendation card.
   You see: "One-way ANOVA" as the primary test, with Tukey listed as the
   post hoc follow-up and Kruskal-Wallis as a nonparametric backup.
   Why this test: a one-way ANOVA tells you whether the three group
   averages differ overall. It doesn't say which pairs differ, that's
   what the post hoc step is for.
   Expected result: you click Continue.

10. **Confirm the setup and run.** Screen: Analyze, variable roles.
    You see: the post-test total score pre-filled as the outcome, and the
    group column pre-filled as the grouping variable.
    Expected result: click Run.

    *A note for anyone recording this today:* the browser build used for
    screenshots runs on a lightweight stand-in for the real statistics
    engine, and that stand-in doesn't yet include ANOVA. Clicking Run
    here currently shows "Statly can't run One-way ANOVA yet." Steps 11
    and 12 describe what the finished feature looks like; screenshot
    them once ANOVA is wired into the app build you're recording from.

11. **Step through the assumption checks.** Screen: Analyze, assumption
    checks.
    You see: normality and equal-spread checks, one screen at a time.
    Why this matters: ANOVA assumes the three groups are each roughly
    normal and similarly spread out. If not, Statly points you to
    Kruskal-Wallis instead.
    Expected result: both assumptions pass.

12. **Read the results and the post hoc comparisons.** Screen: Results.
    You see: the overall ANOVA result, then a table of every pair of
    groups with its own p-value and a note that the p-values are already
    adjusted for making multiple comparisons.
    Why this matters: the overall test tells you the three groups aren't
    all the same; the post hoc table tells you exactly which pairs
    differ. In this study, Intervention B scores highest, then
    Intervention A, then Control.
    Expected result: Intervention B beats Control clearly; Intervention A
    beats Control; Intervention B vs. Intervention A may or may not reach
    significance depending on the exact sample that completed each wave.

13. **See how the pattern holds at follow-up.** Screen: Analyze (repeat).
    Run the same one-way ANOVA and post hoc comparison, this time using
    the follow-up total score instead of the post-test score.
    Why this matters: an intervention that looks good right after
    training but fades a few weeks later tells a very different story
    than one that holds up. This study plants a partial fade toward
    baseline at follow-up, while keeping the same group ordering.
    Expected result: the same ordering (B > A > Control) shows up, but
    with smaller gaps between groups than at the post-test time point.

    *A note on what's next:* comparing all three groups across all three
    time points in a single repeated-measures-by-group (mixed) analysis
    would be the most complete version of this comparison. That path
    isn't wired into the Test Advisor yet; for now, repeating the
    one-way ANOVA at each time point (as in steps 8-13) gets you most of
    the way there.
