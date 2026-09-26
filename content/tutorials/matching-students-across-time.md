---
id: matching-students-across-time
title: "Matching students across time"
dataset: linked_id_prepost
reading_level_target: "8-10"
---

## Goal

You collected pre and post scores using a self-generated student ID
question, so you can match each student's "before" to their "after."
By the end of this tutorial you will have linked the two files by ID,
built a normalized gain score, and run a paired-samples t-test, which is
more powerful than treating pre and post as separate groups.

## Dataset

`fixtures/practice/linked_id_prepost/`: `pre.csv` (80 rows, all unique
IDs) and `post.csv` (81 rows, 79 unique IDs after cleanup). IDs vary in
case and spacing between the two files. The outcome (`Q4`) is a continuous
0-100 score.

## Steps

1. **Click "New project."** Screen: Home.
   You see: the welcome screen.
   Expected result: the import wizard opens.

2. **Choose your files.** Screen: Choose files.
   Check `pre.csv` and `post.csv`, then click Open.
   You see: both files listed.
   Why this matters: both files share a self-generated ID question, which
   is what makes linking possible.
   Expected result: the wizard moves to detection.

3. **Check the detection screen.** Screen: Check how we read them.
   You see: both files read as the same question set.
   Expected result: you continue.

4. **Link people by their ID.** Screen: Can Statly tell which answers
   came from the same person?
   Choose "Link people by an ID" and select the `Q1` column.
   Why this matters: comparing the same person before and after is more
   powerful than comparing two separate groups, because each student
   acts as their own baseline. Statly can only do that if it can match
   students across the two files.
   Expected result: the "Ignore extra spaces" and "Ignore capital
   letters" boxes are available, both checked by default.

5. **Review and import.** Screen: Review and import.
   You see: 80 pre rows and 81 post rows about to import.
   Why this matters: row counts and unique-ID counts aren't the same
   thing here, because of the two duplicate IDs in `post.csv`, and you're
   about to see exactly how that plays out.
   Expected result: click Import.

6. **Read the ID match report.** Screen: How the IDs matched.
   You see: counts for matched, unmatched, and duplicate IDs, shown right
   on the same screen once the import finishes.
   Why this matters: IDs in `post.csv` vary in case and have stray
   spacing compared to `pre.csv` ("ab12 " vs "AB12"). Statly trims
   whitespace and ignores case before matching, and shows you the result:
   most students matched, a handful appear only in one file, and two IDs
   show up twice in `post.csv` (likely retakes).
   Expected result: roughly 75 matched pairs, a few pre-only and
   post-only students, and 2 duplicate IDs called out by name.

7. **Build a normalized gain score.** Screen: Variables.
   Click "New computed variable," choose "Normalized gain," and pick the
   pre and post score columns.
   Why this matters: a student who starts at 90 out of 100 can only gain
   10 more points, while a student who starts at 40 has 60 points of
   room to grow. A raw point gain unfairly favors low starters or high
   starters depending on the test's ceiling. Normalized gain measures how
   much of the *possible* improvement a student actually made.
   Expected result: a new gain-score column appears, only for the
   students who matched across both files.

8. **Ask the Test Advisor what you want to know.** Screen: Analyze.
   Answer "Did scores change over time, or differ between groups?", then
   "Same respondents, measured more than once (linked)," then "Two" time
   points.
   Why this test: because your students are linked by ID, Statly can
   offer the paired comparison instead of the weaker aggregate one.
   Expected result: a recommendation appears.

9. **Read the recommendation.** Screen: Analyze, recommendation card.
   You see: "Paired-samples t-test" as the primary test, with Wilcoxon
   signed-rank listed as a nonparametric backup.
   Why this test: a paired t-test compares each student's own pre and
   post score, using the fact that the same person was measured twice.
   That extra information makes it more sensitive than comparing two
   separate groups of the same size.
   Expected result: you click Continue.

10. **Confirm the setup and run.** Screen: Analyze, variable roles.
    You see: a "Measurements" picker asking for the two score columns
    for the same people.
    Expected result: click Run.

    *A note for anyone recording this today:* the browser build used for
    screenshots runs on a lightweight stand-in for the real statistics
    engine. That stand-in currently expects two separate wide-format
    score columns (one for "before," one for "after") for a paired
    test, but stacking pre.csv and post.csv during import combines them
    into one long-format score column plus a Time column instead, so
    there isn't a valid pair to pick from this practice dataset yet in
    the mock build. Steps 11 and 12 describe the finished feature;
    screenshot them once that gap is closed.

11. **Check the assumption.** Screen: Analyze, assumption check.
    You see: a check on whether the *differences* between each student's
    pre and post score are roughly normal.
    Why this matters: a paired t-test doesn't need the raw pre and post
    scores themselves to be normal, only their differences. This is a
    common point of confusion, and Statly checks the right thing
    automatically.
    Expected result: the assumption passes.

12. **Read the results.** Screen: Results.
    You see: a plain-language summary, an APA-style sentence reporting
    the paired t-test, and the effect size.
    Why this matters: the practice data plants a true average gain of
    about 5 points for matched students; the paired test should detect
    this gain clearly, and the normalized gain variable from step 7 lets
    you describe it as "how much of the possible room to improve" rather
    than just raw points.
    Expected result: a statistically significant improvement from pre to
    post, with a plain-language summary and an APA sentence ready to
    copy.
