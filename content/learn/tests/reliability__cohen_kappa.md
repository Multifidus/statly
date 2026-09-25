---
id: reliability.cohen_kappa
title: "Cohen's kappa"
category: tests
summary: "Measures agreement between exactly two raters on categories, correcting for agreement that would happen by chance."
related: [reliability.icc, reliability.fleiss_kappa]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Cohen's {{kappa_statistic}} measures how well two raters agree when they sort people or items into categories, like pass/fail or three levels of a writing rubric. Plain percent agreement can look impressive even when raters are partly guessing, since two raters will land on the same category some of the time just by luck. Kappa corrects for that by comparing the agreement you actually saw to the agreement you'd expect from chance alone.

## When to use it

Use Cohen's kappa when exactly two raters each classify the same set of people or items into categories, and the categories are {{nominal}} or ordinal rather than a fine-grained numeric scale. A common use is checking whether two teachers agree on pass/fail scoring for a set of student essays. If you have three or more raters, use Fleiss' kappa instead. If the scale is more continuous, like a 1-10 rating, use ICC instead.

## An everyday analogy

Picture two referees each calling plays "fair" or "foul" during the same game. If they agree on almost every call, that looks good, but some of that agreement could just be luck, especially if most plays are obviously fair anyway. Kappa asks: how much better do these two referees agree than two people randomly guessing "fair" or "foul" with the same overall tendencies?

## A worked example

In Scenario A, two raters each classify 10 students' writing samples as "meets standard" or "needs support."

| | Rater 2: meets | Rater 2: needs support |
|---|---|---|
| Rater 1: meets | 6 | 1 |
| Rater 1: needs support | 1 | 2 |

The raters agree on 8 of 10 students (6 + 2), so observed agreement is 0.80. To find chance agreement, Statly uses each rater's totals: Rater 1 said "meets" for 7 students and Rater 2 said "meets" for 7 students, so expected agreement on "meets" by chance is (7/10) x (7/10) = 0.49. Doing the same for "needs support" and adding both gives expected agreement of about 0.58.

Kappa = (observed - expected) / (1 - expected) = (0.80 - 0.58) / (1 - 0.58) = 0.52.

## How to read the output

Statly reports a kappa value, typically from -1 to 1, though it's usually between 0 and 1 in practice. A common guide: below 0 means worse than chance, 0 to .20 is slight agreement, .21 to .40 is fair, .41 to .60 is moderate, .61 to .80 is substantial, and above .80 is almost perfect. Here, kappa = .52 falls in the moderate range, so the two raters agree more than chance would predict, but there's still meaningful disagreement worth discussing.

## How to report it (APA 7)

Template: `Interrater agreement was {level} (kappa = {value}).`

Filled example: Interrater agreement was moderate (kappa = .52).

## Common mistakes

Don't report plain percent agreement as your reliability number without also giving kappa, since percent agreement ignores how much agreement chance alone would produce. Also don't use kappa when you have more than two raters, it only handles a pair. And watch out for kappa looking low even with high percent agreement when one category is much more common than the other, a known quirk sometimes called the kappa paradox.
