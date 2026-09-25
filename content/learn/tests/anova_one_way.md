---
id: anova_one_way
title: "One-way ANOVA"
category: tests
summary: "Compares the average scores of three or more independent groups on a continuous outcome."
related: [t_independent, anova_welch, kruskal_wallis, eta_squared, homogeneity_of_variance]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

The one-way ANOVA (Analysis of Variance) compares the average scores of three or more independent groups on the same continuous outcome. Instead of running several t-tests one after another, it makes one overall check: does at least one group's average stand out from the rest, more than random chance alone would explain?

## When to use it

Use this test when you have three or more independent groups and a continuous outcome. It assumes the groups have roughly equal {{variance}} (spread). If that assumption looks shaky, Welch's ANOVA is the safer choice, since it doesn't require equal variances.

## An everyday analogy

Picture three bakeries claiming their bread rises to about the same height. You measure a handful of loaves from each bakery and ask whether the average height really differs across the three, or whether the small differences you see are just normal oven-to-oven variation.

## A worked example

A researcher compares a 10-point quiz score across Control, Intervention A, and Intervention B (Scenario B), 4 students per group.

| | Control | Intervention A | Intervention B |
|---|---|---|---|
| Scores | 4, 5, 5, 6 | 6, 7, 7, 8 | 8, 9, 9, 10 |
| *M* | 5.00 | 7.00 | 9.00 |

The grand mean across all 12 students is 7.00. The {{between_groups_variance}} (how far each group's mean sits from the grand mean) adds up to a {{sum_of_squares}} of 32. The {{within_groups_variance}} (how much scores spread out inside each group) adds up to a sum of squares of 6.

*F* = (32 / 2) / (6 / 9) = 16.00 / 0.67 = 24.00, with {{degrees_of_freedom}} = 2 and 9, giving *p* < .001.

## How to read the output

Statly reports the {{f_statistic}}, two degrees of freedom (between groups, within groups), and a {{p_value}}. A large *F* relative to its degrees of freedom, paired with a small *p*-value, means at least one group's average really differs from the others. Here, *p* < .001 is strong evidence the three teaching methods don't all produce the same average quiz score. A significant result doesn't say which groups differ, that takes a follow-up pairwise comparison.

## How to report it (APA 7)

Template: `There was a significant difference in {outcome} across the {k} groups, *F*({df1}, {df2}) = {F}, *p* = {p}, eta-squared = {eta2}.`

Filled example: There was a significant difference in quiz score across the three teaching methods, *F*(2, 9) = 24.00, *p* < .001, eta-squared = .84.

## Common mistakes

Don't stop at a significant *F* and assume every group differs from every other group. You need follow-up pairwise comparisons (with a correction for {{multiple_comparisons}}) to find out where the difference is. Also don't ignore unequal variances between groups, check that assumption first, and switch to Welch's ANOVA if it doesn't hold.
