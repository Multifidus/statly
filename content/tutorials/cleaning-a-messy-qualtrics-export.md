---
id: cleaning-a-messy-qualtrics-export
title: "Cleaning a messy Qualtrics export"
dataset: messy_qualtrics
reading_level_target: "8-10"
---

## Goal

Real survey exports are messy: extra rows that aren't real responses,
personal information you shouldn't keep around, questions coded in
different ways, and open-ended text mixed in with numbers. This tutorial
walks through Statly's import wizard using one file that has every one of
these problems on purpose, so you can see exactly how Statly catches and
fixes each one.

## Dataset

`fixtures/practice/messy_qualtrics/messy_3header.csv`: 113 rows, one
underlying survey exported with a 3-row Qualtrics header. Includes preview
and spam rows, unfinished responses, personal information (IP address,
name, email, location), a reverse-worded matrix item, a multi-select
question, an "-99" missing-value code, non-contiguous answer codes, and
open-ended text responses.

## Steps

1. **Click "New project."** Screen: Home.
   You see: the welcome screen.
   Expected result: the import wizard opens.

2. **Choose your file.** Screen: Choose files.
   Check `messy_3header.csv` and click Open.
   You see: the file listed under "Files to import."
   Expected result: the wizard moves to detection.

3. **Check the detection screen.** Screen: Check how we read them.
   You see: Statly correctly identifies a Qualtrics export with a 3-row
   header, UTF-8 encoding with a byte-order mark, 113 rows, and 34
   columns.
   Why this matters: Qualtrics exports come in several formats (2-row and
   3-row headers, different encodings). Getting the format wrong would
   silently misread every column that follows.
   Expected result: you continue.

4. **Check the personal-information columns.** Screen: Survey clean-up.
   You see: a pre-checked list including `IPAddress`, respondent first and
   last name, and email, all marked for removal.
   Why this matters: student survey data with names, emails, or IP
   addresses attached raises FERPA concerns. Statly finds these columns
   automatically and removes them by default, before you even see the
   data grid.
   Expected result: the boxes are already checked; you confirm them.

5. **Check the row filters.** Screen: Survey clean-up.
   You see: "Survey Preview" and "Spam" response statuses pre-checked for
   removal.
   Why this matters: when someone previews a survey link or a bot spams
   it, Qualtrics logs a row that isn't a real response. Counting those
   rows as data would quietly bias every result.
   Expected result: the filters stay checked; you confirm them.

6. **Confirm the unusual answer codes.** Screen: Survey clean-up.
   You see: a warning that `Q6` uses recode values 1, 2, 4, 5, and 7,
   skipping 3 and 6.
   Why this matters: most Likert-style questions use consecutive codes
   like 1-5. When they skip a number, treating the codes as evenly spaced
   points on a scale can be misleading. Statly won't let you continue
   until you've looked at this and clicked "Why does this matter?" to see
   how it could affect later test runs.
   Expected result: you check the acknowledgment box, and the Continue
   button becomes available.

7. **Import.** Screen: Review and import.
   You see: 113 rows summarized, ready to import (the preview and spam
   rows get filtered out during import, not before, so you can still see
   what was removed).
   Expected result: click Import; the Variable Interview starts.

8. **Skip ahead to the data grid.** Screen: Data.
   Click "Skip for now" on the Variable Interview welcome screen.
   You see: 108 rows (113 minus the 3 preview and 2 spam rows), the PII
   columns gone, and survey-system columns like `StartDate` hidden by
   default behind a "Show survey system columns" toggle.
   Why this matters: this is what a cleaned-up dataset looks like before
   you've even set up a single variable, proof the wizard did its job.
   Expected result: the grid shows real data, keyboard-navigable with
   arrow keys.

9. **Check the missing-data summary.** Screen: Data.
   You see: a summary calling out columns with missing values, including
   `Q5_1`.
   Why this matters: this file uses Qualtrics's `-99` code for "no
   answer" in some columns, and some responses were left unfinished.
   Statly surfaces these as missing data instead of silently treating
   `-99` as a real, very low score.
   Expected result: missing counts show up per column, not hidden inside
   an average.

10. **Reverse-score the matrix item.** Screen: Variable Interview, Scales
    step.
    You see: the `Q5` matrix suggested as a scale, with `Q5_4` flagged.
    Check "Negatively worded" for `Q5_4`.
    Why this matters: one item in this matrix is worded so that agreeing
    means the opposite of the other five items. Leaving it unflipped
    would drag the scale average in the wrong direction.
    Expected result: the scale preview updates once `Q5_4` is
    reverse-coded.

11. **Check the text-choice and multi-select columns.** Screen: Variables.
    You see: `Q5` and `Q6` recognized correctly even though some export
    variants store their answers as text labels instead of numeric codes,
    and `Q7` (a multi-select "check all that apply" question, with an
    "Other, please specify" text box) kept as its own set of yes/no
    variables.
    Why this matters: the same underlying survey can be exported with
    text labels or numeric codes depending on Qualtrics settings. Statly
    matches them to the same question either way, and a multi-select
    question can't be treated like a single answer, since a respondent
    might pick three options at once.
    Expected result: `Q5`, `Q6`, and `Q7` all appear correctly typed in
    the Variables list.

12. **Tag the open-ended responses.** Screen: Qualitative.
    Open the free-text responses for `Q9` and `Q10` and apply codebook
    tags to common themes.
    Why this matters: open-ended answers can't be averaged or tested
    directly, but sorting them into a small set of tags (like "liked the
    pacing" or "wanted more examples") turns them into something you can
    count and compare across groups.
    Expected result: *this screen isn't built yet.* For now, `Q9` and
    `Q10` are visible as plain text columns in the data grid; a dedicated
    tagging workspace is planned but not part of the app today.
