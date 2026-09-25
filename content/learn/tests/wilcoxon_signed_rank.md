---
id: wilcoxon_signed_rank
title: "Wilcoxon signed-rank test"
category: tests
summary: "Compares two related measurements (like pre and post scores from the same people) using ranks of the differences, for when a paired t-test's assumptions don't hold."
related: [t_test.paired, sign_test, mann_whitney, rank_biserial, normality, descriptives]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

The Wilcoxon signed-rank test checks whether {{paired}} measurements, like the same people tested twice, tend to change in one direction. It is a {{nonparametric}} alternative to the paired t-test. Instead of averaging the raw differences, it ranks the *sizes* of the differences (ignoring the sign at first), then checks whether the positive or negative differences carry more of the total rank weight.

## When to use it

Use it when you have two related measurements per person or unit, your outcome is {{ordinal}} or continuous, and the differences between pairs aren't shaped like a {{normal_distribution}} (or your sample is small and you can't check). It's common with before/after designs, matched pairs, or Likert-based scale scores.

## An everyday analogy

Imagine eight students each ran a race twice, once before training and once after. You don't just average the time changes, you rank how *big* each student's change was, from smallest to largest. Then you check whether the big changes were mostly improvements or mostly setbacks.

## A worked example

Eight students, matched by ID, get a 0-100 outcome score before and after a program (Scenario C).

| Student | Pre | Post | Difference |
|---|---|---|---|
| 1 | 50 | 54 | 4 |
| 2 | 55 | 55 | 0 |
| 3 | 60 | 66 | 6 |
| 4 | 62 | 60 | -2 |
| 5 | 58 | 64 | 6 |
| 6 | 65 | 70 | 5 |
| 7 | 70 | 68 | -2 |
| 8 | 52 | 60 | 8 |

Student 2 had a difference of 0, so that pair drops out, leaving *n* = 7. Rank the remaining differences by their absolute size, splitting ties evenly:

| Absolute difference | 2 | 2 | 4 | 5 | 6 | 6 | 8 |
|---|---|---|---|---|---|---|---|
| Rank | 1.5 | 1.5 | 3 | 4 | 5.5 | 5.5 | 7 |

Now split those ranks by the original sign:

- Positive differences (4, 6, 6, 5, 8): ranks 3 + 5.5 + 5.5 + 4 + 7 = 25
- Negative differences (-2, -2): ranks 1.5 + 1.5 = 3

*W* is the smaller sum, so *W* = 3. Using the normal approximation (mean = *n*(*n*+1)/4 = 14, *SD* = 5.92), *z* = (3 - 14) / 5.92 = -1.86, giving *p* = .063.

## How to read the output

Statly reports *W* (or *T*, the smaller rank sum), a *z*-score, and a {{p_value}}. A small *W* means the differences leaned heavily in one direction. As with any paired test, look at the direction of the effect (which sum was bigger) alongside the *p*-value, not just whether it crossed .05.

## How to report it (APA 7)

Template: `A Wilcoxon signed-rank test showed a {significant/non-significant} difference between {condition1} and {condition2}, *W* = {W}, *z* = {z}, *p* = {p}.`

Filled example: A Wilcoxon signed-rank test showed a non-significant difference between pretest and posttest scores, *W* = 3, *z* = -1.86, *p* = .063.

## Common mistakes

Don't forget to drop zero differences before ranking, they carry no information about direction and inflate your sample size if you keep them. Also don't report a group mean difference as your headline number, since the test is built on ranks, medians of the differences are the better match.
