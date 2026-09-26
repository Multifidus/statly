---
id: did-my-students-improve
title: "Did my students improve?"
dataset: one_group_prepost_likert
reading_level_target: "8-10"
---

## Goal

You gave the same class a short reading-attitude survey before and after a
unit, using two separate Qualtrics links (no way to match one student's
"before" answer to their "after" answer). By the end of this tutorial you
will have a single combined score for the survey, a test that tells you
whether attitudes really changed, and a check on whether the survey
questions were even measuring one thing consistently.

## Dataset

`fixtures/practice/one_group_prepost_likert/`: `pre.csv` and `post.csv`,
60 respondents each, a 10-item Likert matrix (`Q3_1`-`Q3_10`), no linking ID.
Two of the items (`Q3_3`, `Q3_8`) are worded negatively.

## Steps

1. **Click "New project."** Screen: Home.
   You see: a welcome screen with a big "New project" button.
   Why this matters: every project starts from a blank slate, so nothing
   from a previous tutorial carries over.
   Expected result: the "Choose files" step of the import wizard opens.

2. **Choose your files.** Screen: Choose files.
   Check both `pre.csv` and `post.csv`, then click Open.
   You see: both file names listed under "Files to import."
   Why this matters: pre and post are two separate exports of the same
   survey. Statly needs both files to line up the same questions before
   comparing them.
   Expected result: the wizard moves to "Check how we read them."

3. **Check the detection screen.** Screen: Check how we read them.
   You see: Statly reports it found a Qualtrics export, the number of
   header rows, the file's text encoding, and the row/column counts.
   Why this matters: catching a misread file here is much easier than
   catching it after your analysis is already wrong.
   Expected result: everything looks right, so you click Continue.

4. **Review survey clean-up.** Screen: Survey clean-up.
   You see: a list of columns Statly plans to remove or keep, with reasons.
   Why this matters: Qualtrics exports carry extra columns you usually
   don't want in an analysis, like timestamps and survey metadata.
   Expected result: the defaults look sensible, so you continue.

5. **Import.** Screen: Review and import.
   You see: a final row and column count, then a button to import.
   Why this matters: one last check before the data becomes part of your
   project.
   Expected result: the Variable Interview starts automatically.

6. **Set up the scale.** Screen: Variable Interview, Scales step.
   You see: Statly has already grouped `Q3_1` through `Q3_10` into one
   suggested scale, with `Q3_3` and `Q3_8` flagged to check.
   Why this matters: `Q3_3` and `Q3_8` are worded so that agreeing means
   the *opposite* of the other eight items. If you don't reverse-score
   them, they will drag the average score in the wrong direction.
   Expected result: you check "Negatively worded" for both items, and the
   scale preview updates.

7. **Look at the new variable.** Screen: Variables.
   You see: a new column, the scale score, alongside the original items.
   Why this matters: this one number, an average of all ten (correctly
   scored) items, is what you'll actually test, instead of picking one
   question at random.
   Expected result: the scale score column shows a value for every student.

8. **Ask the Test Advisor what you want to know.** Screen: Analyze.
   Click "Did scores change over time, or differ between groups?"
   You see: the scale score is already selected as your outcome, since
   it's the only scored variable in your data.
   Why this test: Statly starts by understanding your question in plain
   language, then narrows down to a specific statistical test.
   Expected result: a follow-up question about how your groups are set up.

9. **Say how pre/post relate.** Screen: Analyze.
   Choose "Comparing time points, but respondents are NOT linked across
   them."
   Why this matters: because pre.csv and post.csv have no shared student
   ID, Statly can't match one student's "before" to their "after." It has
   to treat pre and post as two separate groups of people.
   Expected result: a recommendation appears.

10. **Read the recommendation.** Screen: Analyze, recommendation card.
    You see: "Independent-samples t-test" as the primary recommendation,
    with a clear caveat about the aggregate (unlinked) comparison, and
    Mann-Whitney U listed as a backup if the data isn't normal enough.
    Why this test: an independent-samples t-test compares the average
    score of two separate groups, which is exactly what you have here
    once pre and post are treated as separate groups.
    Expected result: you click Continue.

11. **Confirm the setup and run.** Screen: Analyze, variable roles.
    You see: the scale score pre-filled as the outcome and "Time"
    pre-filled as the group variable.
    Why this matters: Statly fills in roles from your data whenever it
    can, so you're checking its work, not doing data entry.
    Expected result: click Run to start the assumption checks.

12. **Step through the assumption checks.** Screen: Analyze, assumption
    checks.
    You see: one screen per assumption (normality, then equal spread),
    each with a chart and a plain-language verdict.
    Why this matters: a t-test's p-value is only trustworthy if its
    assumptions roughly hold. Checking first means you'll know whether to
    trust the result or switch to the backup test.
    Expected result: both assumptions pass, so Statly suggests the
    standard t-test.

13. **Read the results.** Screen: Results.
    You see: a plain-language summary first ("scores in the post group
    were higher..."), then an APA-style sentence you can copy straight
    into a report, then a results table.
    Why this matters: you get both a version you can understand instantly
    and a version that's ready for a paper.
    Expected result: post-test scores are higher than pre-test scores,
    with a moderate effect size, matching what was planted in the
    practice data.

14. **Check the scale's reliability.** Screen: Analyze.
    Go back to the Analyze tab and answer "Do my survey questions hang
    together?"
    Why this matters: before you trust a combined scale score, you want
    to know the ten items were actually measuring one consistent thing,
    not ten unrelated questions averaged together.
    Expected result: Statly reports Cronbach's alpha for the reading
    attitude scale, in plain language, with a note on what counts as a
    "good" value.
