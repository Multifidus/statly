---
id: posthoc.dunn
title: "Dunn's Test"
category: posthoc
summary: "Compares every pair of groups after a significant Kruskal-Wallis test, using ranked data."
related: [kruskal_wallis, posthoc.conover, multiple_comparisons]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Dunn's test is a {{post_hoc}} test used after a significant Kruskal-Wallis test. It compares every pair of groups using the {{rank}}s of the data instead of the raw scores, and applies a correction so testing many pairs doesn't inflate your false-positive rate.

## When to use it

Use Dunn's test when your overall Kruskal-Wallis test comes back significant and you want to know which specific groups differ. It fits naturally with Kruskal-Wallis because both use ranks, which makes Dunn's test the standard nonparametric follow-up when your data are ordinal, skewed, or have outliers.

## An everyday analogy

Picture ranking every runner in a race that combined three different training programs, then asking which specific pairs of programs had noticeably different typical rankings. You're not comparing exact race times, since those might not be reliable, you're comparing where each program's runners tended to land in the overall order.

## A worked example

Following a significant Kruskal-Wallis test on knowledge-test scores across Control, Intervention A, and Intervention B (Scenario B), a researcher runs Dunn's test with a Bonferroni correction.

| Comparison | *z* | Adjusted *p* |
|---|---|---|
| Control vs. Intervention A | 2.85 | .013 |
| Control vs. Intervention B | 1.40 | .48 |
| Intervention A vs. Intervention B | 1.10 | .81 |

## How to read the output

Statly reports a *z* statistic and an adjusted *p*-value for each pair, based on the average rank each group held in the combined data set. A pair with an adjusted *p*-value under .05 has significantly different typical ranks. Here, only Control vs. Intervention A stands out.

## How to report it (APA 7)

Template: `Dunn's test with a Bonferroni correction showed that {group1} and {group2} differed significantly in rank, *z* = {z}, adjusted *p* = {p}.`

Filled example: Dunn's test with a Bonferroni correction showed that Control and Intervention A differed significantly in rank, *z* = 2.85, adjusted *p* = .013.

## Common mistakes

Don't run Dunn's test without a significant Kruskal-Wallis result first, it's meant as a follow-up, not a stand-alone tool. Also don't confuse a significant Dunn's test with a difference in means, since it's telling you about ranks, describe the result in terms of typical rank or median, not average score.
