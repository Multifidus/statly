---
id: reliability.fleiss_kappa
title: "Fleiss' kappa"
category: tests
summary: "Measures agreement among three or more raters classifying items into categories, correcting for chance."
related: [reliability.cohen_kappa]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Fleiss' {{kappa_statistic}} extends the idea behind Cohen's kappa to three or more raters. It measures how much raters agree when sorting people or items into categories, beyond what you'd expect them to agree on just by chance. Unlike Cohen's kappa, it doesn't require the same raters to score every item, only that each item gets the same number of ratings.

## When to use it

Use Fleiss' kappa when three or more raters each classify the same set of items into categories, like three teachers each rating a batch of essays as "below," "at," or "above" grade level. It works for {{nominal}} categories without any natural order. If you only have two raters, use Cohen's kappa instead, since it's built specifically for a pair.

## An everyday analogy

Picture three judges at a science fair, each sorting the same 8 projects into "needs work," "solid," or "outstanding." If all three judges tend to sort the same projects into the same bucket, that's strong agreement. Fleiss' kappa checks how much better the three judges agree than you'd expect if each one were just randomly assigning ratings at the same overall rate.

## A worked example

In Scenario A, three raters each classify 6 students' writing samples into "below," "at," or "above" grade level.

| Student | Below | At | Above |
|---|---|---|---|
| 1 | 0 | 3 | 0 |
| 2 | 0 | 2 | 1 |
| 3 | 3 | 0 | 0 |
| 4 | 0 | 1 | 2 |
| 5 | 0 | 3 | 0 |
| 6 | 1 | 2 | 0 |

Each cell counts how many of the 3 raters picked that category for that student. Students 1, 3, and 5 got unanimous ratings, a strong sign of agreement, while students 2, 4, and 6 show some split opinions. Statly computes the proportion of agreement for each student, averages across all 6, and compares that to the agreement expected if raters picked categories at the same overall rates purely by chance. That comparison gives Fleiss' kappa = .58 for this example.

## How to read the output

Statly reports a single kappa value across all raters and items, usually with the same rough guide used for Cohen's kappa: below 0 is worse than chance, 0 to .20 is slight, .21 to .40 is fair, .41 to .60 is moderate, .61 to .80 is substantial, and above .80 is almost perfect. Here, kappa = .58 is moderate agreement, meaning the three raters are landing on the same category noticeably more often than chance, but there's still real disagreement on some students.

## How to report it (APA 7)

Template: `Agreement among the {n} raters was {level} (kappa = {value}).`

Filled example: Agreement among the 3 raters was moderate (kappa = .58).

## Common mistakes

Don't use Fleiss' kappa when the same fixed pair of raters scores everything and you only have two of them, Cohen's kappa is the right fit there. Also don't ignore which categories cause the most disagreement, a low overall kappa might come from raters splitting on just one tricky category while agreeing everywhere else. Check the category-by-category pattern, not just the single summary number.
