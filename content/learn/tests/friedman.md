---
id: friedman
title: "Friedman test"
category: tests
summary: "Compares three or more repeated measurements on the same people using ranks, the nonparametric alternative to repeated-measures ANOVA."
related: [anova_rm, kruskal_wallis, wilcoxon_signed_rank, kendalls_w, sphericity, descriptives]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

The Friedman test checks whether scores change across three or more {{repeated_measures}} on the same people or units. It's the {{nonparametric}} alternative to a repeated-measures ANOVA. Instead of comparing raw values, it ranks each person's own scores across the conditions (lowest to highest), then checks whether one condition tends to earn higher ranks than the others across the whole group.

## When to use it

Use it when the same people are measured three or more times (or under three or more conditions), your outcome is {{ordinal}} or continuous, and you can't trust the normality or {{sphericity}} assumptions a repeated-measures ANOVA needs. It's common for pretest/posttest/follow-up designs.

## An everyday analogy

Picture five students each ranking their own energy level in the morning, afternoon, and evening, from lowest to highest for themselves. You don't compare one student's numbers to another's directly, you just ask: across everyone, does one time of day usually come out on top?

## A worked example

Five students in the Intervention A group (Scenario B) are given the same 10-point quiz at pretest, posttest, and follow-up.

| Student | Pretest | Posttest | Follow-up |
|---|---|---|---|
| 1 | 3 | 5 | 4 |
| 2 | 4 | 6 | 5 |
| 3 | 4 | 3 | 5 |
| 4 | 5 | 7 | 6 |
| 5 | 3 | 6 | 5 |

Rank each student's own three scores from 1 (lowest) to 3 (highest):

| Student | Pretest rank | Posttest rank | Follow-up rank |
|---|---|---|---|
| 1 | 1 | 3 | 2 |
| 2 | 1 | 3 | 2 |
| 3 | 2 | 1 | 3 |
| 4 | 1 | 3 | 2 |
| 5 | 1 | 3 | 2 |
| **Sum** | **6** | **13** | **11** |

With *n* = 5 students and *k* = 3 conditions:

chi-square_r = [12 / (*n* x *k*(*k*+1))] x sum(R²) - 3*n*(*k*+1)
chi-square_r = [12/60] x (6² + 13² + 11²) - 3(5)(4)
chi-square_r = 0.2 x 326 - 60 = 65.2 - 60 = 5.2

With *df* = *k* - 1 = 2, this gives *p* = .074.

## How to read the output

Statly reports the Friedman {{chi_square_statistic}}, its {{degrees_of_freedom}}, and a {{p_value}}. A significant result means at least one condition's ranks differ from the others across your sample, but not which pair. Follow up with pairwise comparisons (such as Wilcoxon signed-rank tests with a correction for {{multiple_comparisons}}) to locate the difference, and check Kendall's W for the size of the effect.

## How to report it (APA 7)

Template: `A Friedman test showed a {significant/non-significant} difference in {outcome} across the {k} conditions, chi-square_r({df}) = {chi2}, *p* = {p}.`

Filled example: A Friedman test showed a non-significant difference in quiz score across pretest, posttest, and follow-up, chi-square_r(2) = 5.20, *p* = .074.

## Common mistakes

Don't run a Friedman test on people who weren't measured under every condition, it needs complete data for each person across all time points or conditions. Also, don't interpret a significant result as pinpointing which pair of conditions differs, that takes a follow-up pairwise test.
