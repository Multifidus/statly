---
id: reliability.icc
title: "Intraclass correlation (ICC)"
category: tests
summary: "Measures how closely two or more raters or repeated measurements agree on a continuous or ordinal scale."
related: [reliability.cronbach_alpha, reliability.cohen_kappa]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

The {{intraclass_correlation}} (ICC) tells you how much raters or repeated measurements agree with each other on a numeric or ordinal scale. It's a form of {{interrater_reliability}}: instead of just checking whether two raters' scores move together, like an ordinary correlation would, ICC also checks whether they land on the same actual values. Two raters who both rate everyone 2 points higher than each other could have a high correlation but a low ICC, because they don't agree on the exact score.

## When to use it

Use ICC when two or more raters score the same set of people or items on a continuous or ordinal scale, like rating classroom engagement from 1 to 10, or when the same instrument measures the same subjects more than once. It's the natural choice when your rating scale has many possible values, not just a handful of categories. If raters are instead sorting things into a small number of categories, use Cohen's kappa or Fleiss' kappa.

## An everyday analogy

Imagine two judges scoring a science fair project out of 100. If both judges tend to give nearly the same score to the same projects, ICC is high. If one judge is a harsh grader who scores everything 15 points lower, even if their rankings of the projects match, ICC drops, because agreement means landing on the same number, not just ranking things the same way.

## A worked example

In Scenario A, two raters independently score 6 students' classroom engagement on a 1-10 scale during a reading activity.

| Student | Rater 1 | Rater 2 |
|---|---|---|
| 1 | 6 | 7 |
| 2 | 8 | 8 |
| 3 | 5 | 5 |
| 4 | 9 | 8 |
| 5 | 4 | 5 |
| 6 | 7 | 7 |

The two raters land close to each other on every student, with at most a 1-point gap. Statly computes ICC by comparing the variance between students (how much true engagement differs from student to student) to the variance from rater disagreement. Here that works out to ICC = .91, since the raters mostly agree and most of the spread in scores comes from real differences between students, not from the raters disagreeing.

## How to read the output

Statly reports an ICC value between 0 and 1, often with a {{confidence_interval}}. Values below .50 suggest poor agreement, .50 to .75 is moderate, .75 to .90 is good, and above .90 is excellent. Statly also tells you which ICC model it used, since the exact formula depends on whether raters were chosen at random or were the same fixed raters every time, and whether you care about a single rater's score or the average of several raters. Here, ICC = .91 means the two raters' engagement scores are highly consistent with each other.

## How to report it (APA 7)

Template: `Interrater reliability was {level} (ICC = {value}, 95% CI [{lower}, {upper}]).`

Filled example: Interrater reliability was excellent (ICC = .91, 95% CI [.71, .98]).

## Common mistakes

Don't use a plain Pearson correlation as a substitute for ICC. Correlation can be high even when raters consistently disagree by a fixed amount, since it only checks whether scores rise and fall together. Also don't report an ICC value without saying which ICC model and type Statly used, since different models answer slightly different questions and aren't directly comparable. Finally, ICC estimates from a small handful of ratings, like the 6 students here, can shift a lot with more data, so treat early estimates as rough.
