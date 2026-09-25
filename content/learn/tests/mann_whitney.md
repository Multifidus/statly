---
id: mann_whitney
title: "Mann-Whitney U test"
category: tests
summary: "Compares two independent groups on ranks instead of raw scores, for when your data aren't normal enough to trust a t-test."
related: [t_test.independent, kruskal_wallis, wilcoxon_signed_rank, rank_biserial, normality, outliers]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

The Mann-Whitney U test checks whether two independent groups tend to score differently. It is a {{nonparametric}} test, which means it does not assume your data follow a {{normal_distribution}}. Instead of comparing means, it sorts all the scores from both groups together and compares their {{rank}}s. If one group's scores tend to land higher in that combined ranking, the test picks up on it.

## When to use it

Use the Mann-Whitney U test when you have two separate, unrelated groups (an {{independent_groups}} design), your outcome is {{ordinal}} or continuous, and you can't safely assume normality. It's the go-to substitute for the independent-samples t-test when your sample is small, your data are skewed, or you have outliers you can't explain away.

## An everyday analogy

Picture two lines of runners crossing a finish line, all mixed together. Instead of timing every runner, you just look at the order they finished in. If one team's runners tend to cross earlier, that team wins on rank even without stopwatches.

## A worked example

A researcher compares a 10-point quiz score between the Control group and Intervention A group.

| Group | Scores |
|---|---|
| Control | 4, 5, 5, 6, 7 |
| Intervention A | 6, 7, 8, 8, 9 |

Combine all 10 scores, sort them, and assign ranks. Tied scores share the average of the ranks they would have taken.

| Score | 4 | 5 | 5 | 6 | 6 | 7 | 7 | 8 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|---|
| Rank | 1 | 2.5 | 2.5 | 4.5 | 4.5 | 6.5 | 6.5 | 8.5 | 8.5 | 10 |

Now add up the ranks that belong to each group:

- Control ranks: 1 + 2.5 + 2.5 + 4.5 + 6.5 = 17
- Intervention A ranks: 4.5 + 6.5 + 8.5 + 8.5 + 10 = 38

With *n*1 = *n*2 = 5:

- *U*1 = 17 - 5(6)/2 = 17 - 15 = 2
- *U*2 = 38 - 5(6)/2 = 38 - 15 = 23

*U* is the smaller of the two, so *U* = 2. Using the normal approximation (mean = *n*1*n*2/2 = 12.5, *SD* = 4.79), *z* = (2 - 12.5) / 4.79 = -2.19, which gives *p* = .028. For samples this small, most software (including Statly) reports an exact *p*-value instead of this approximation, but the two usually land close together.

## How to read the output

Statly reports *U*, a *z*-score (for larger samples), and a {{p_value}}. A small *U* (relative to the maximum possible) means the two groups barely overlap in rank. Check the {{effect_size}} too, usually rank-biserial correlation, since a significant result alone doesn't tell you how big the difference is.

## How to report it (APA 7)

Template: `A Mann-Whitney U test showed a {significant/non-significant} difference between {group1} (Mdn = {mdn1}) and {group2} (Mdn = {mdn2}), *U* = {U}, *z* = {z}, *p* = {p}.`

Filled example: A Mann-Whitney U test showed a significant difference between Control (*Mdn* = 5.00) and Intervention A (*Mdn* = 7.00), *U* = 2, *z* = -2.19, *p* = .028.

## Common mistakes

Don't run this test and then report group means in your write-up. Since the test works on ranks, report medians instead, they match what the test actually compared. Also don't assume a significant Mann-Whitney result always means "different medians." Technically it tests whether one group's values tend to be larger than the other's across the whole distribution, which usually but not always lines up with a median difference.
