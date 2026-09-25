---
id: kruskal_wallis
title: "Kruskal-Wallis test"
category: tests
summary: "Compares three or more independent groups on ranks, the nonparametric alternative to a one-way ANOVA."
related: [anova_one_way, anova_welch, mann_whitney, friedman, epsilon_squared, homogeneity_of_variance]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

The Kruskal-Wallis test checks whether three or more independent groups differ in their typical scores. It's the {{nonparametric}} cousin of the one-way ANOVA. Like the Mann-Whitney U test, it works on {{rank}}s: it lines up every score from every group in one big ranking, then checks whether some groups' ranks are bunched noticeably higher or lower than others.

## When to use it

Use it when you have three or more {{independent_groups}}, an {{ordinal}} or continuous outcome, and you can't trust the ANOVA's normality assumption, maybe because your sample is small, skewed, or has outliers you can't explain.

## An everyday analogy

Think of three relay teams whose runners all cross one shared finish line, mixed together. You don't need stopwatch times to see which team tends to finish first, just look at where each team's runners land in the overall order.

## A worked example

A researcher compares a 10-point quiz score across Control, Intervention A, and Intervention B (Scenario B), 4 students per group.

| Group | Scores |
|---|---|
| Control | 4, 5, 6, 5 |
| Intervention A | 6, 7, 8, 7 |
| Intervention B | 8, 9, 9, 8 |

Rank all 12 scores together, averaging ranks for {{ties}}:

| Score | 4 | 5 | 5 | 6 | 6 | 7 | 7 | 8 | 8 | 8 | 9 | 9 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Rank | 1 | 2.5 | 2.5 | 4.5 | 4.5 | 6.5 | 6.5 | 9 | 9 | 9 | 11.5 | 11.5 |

Sum the ranks within each group:

- Control (4, 5, 6, 5): 1 + 2.5 + 4.5 + 2.5 = 10.5
- Intervention A (6, 7, 8, 7): 4.5 + 6.5 + 9 + 6.5 = 26.5
- Intervention B (8, 9, 9, 8): 9 + 11.5 + 11.5 + 9 = 41

With *N* = 12 and 4 students per group:

*H* = [12 / (*N*(*N*+1))] x sum(R²/*n*) - 3(*N*+1)
*H* = [12/156] x (10.5²/4 + 26.5²/4 + 41²/4) - 3(13)
*H* = 0.0769 x 623.375 - 39 = 47.95 - 39 = 8.95

Because several scores were tied, software applies a small tie correction, which nudges this up to *H* = 9.21 with *df* = 2, giving *p* = .010.

## How to read the output

Statly reports *H*, the {{degrees_of_freedom}} (number of groups minus 1), and a {{p_value}}. A significant Kruskal-Wallis result tells you at least one group differs from the others, but not which ones. Follow up with pairwise {{post_hoc}} comparisons (with a {{multiple_comparisons}} correction) to find out where the difference is.

## How to report it (APA 7)

Template: `A Kruskal-Wallis test showed a {significant/non-significant} difference in {outcome} across the {k} groups, *H*({df}) = {H}, *p* = {p}.`

Filled example: A Kruskal-Wallis test showed a significant difference in quiz score across the three groups, *H*(2) = 9.21, *p* = .010.

## Common mistakes

Don't stop at "the groups differ" and skip the follow-up comparisons, a significant Kruskal-Wallis result doesn't tell you which groups drove it. Also, report group medians (not means) alongside the result, since the test compares rank patterns, not averages.
