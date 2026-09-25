---
id: t_independent
title: "Independent-samples t-test"
category: tests
summary: "Compares the average scores of two separate, unrelated groups on a continuous outcome."
related: [t_paired, t_one_sample, mann_whitney, anova_one_way, cohens_d, homogeneity_of_variance]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

The independent-samples t-test compares the average score of two separate, unrelated groups on the same outcome. It checks whether the gap between the two group means is bigger than random chance alone would produce. The two groups must be {{independent_groups}}: each person or item belongs to one group only, never both.

## When to use it

Use this test when you have exactly two groups, a {{continuous}} outcome like a test score, and each participant contributes data to only one group. If you have three or more groups, use a one-way ANOVA instead. If the same people are measured twice, use a paired-samples t-test instead, since the two sets of scores aren't independent.

## An everyday analogy

Picture comparing the average commute time for people who bike to work against people who drive. Nobody counts in both groups, so you're simply asking whether one group's typical time looks different from the other's, more than you'd expect from ordinary day-to-day variation.

## A worked example

A researcher compares a 10-point quiz score for 5 students in the Control group against 5 students in the Intervention A group (Scenario B).

| | Control | Intervention A |
|---|---|---|
| Scores | 4, 5, 6, 5, 5 | 7, 8, 6, 7, 7 |
| *M* | 5.00 | 7.00 |
| *SD* | 0.71 | 0.71 |

Both groups spread out the same amount, so Statly pools the two variances: (0.5 + 0.5) / 2 = 0.5. The {{standard_error}} of the difference between the means is the square root of 0.5 x (1/5 + 1/5), which is 0.45.

*t* = (7.00 - 5.00) / 0.45 = 4.47, with {{degrees_of_freedom}} = 5 + 5 - 2 = 8, giving *p* = .002.

## How to read the output

Statly reports *t*, the degrees of freedom, and a {{p_value}}. A larger *t* (further from zero) means a bigger gap between the two group means relative to how much scores naturally bounce around within each group. Here, *p* = .002 is well under the usual .05 cutoff, so this small example is strong evidence the two groups really differ, not just a fluke of sampling. Pair the test with an {{effect_size}} like Cohen's *d* to see how big that difference is in practical terms.

## How to report it (APA 7)

Template: `There was a significant difference in {outcome} between {group1} (*M* = {m1}, *SD* = {sd1}) and {group2} (*M* = {m2}, *SD* = {sd2}), *t*({df}) = {t}, *p* = {p}, *d* = {d}.`

Filled example: There was a significant difference in quiz score between the Control group (*M* = 5.00, *SD* = 0.71) and the Intervention A group (*M* = 7.00, *SD* = 0.71), *t*(8) = 4.47, *p* = .002, *d* = 2.83.

## Common mistakes

Don't run an independent-samples t-test on the same people measured twice, that's a paired design and needs a paired-samples t-test instead. Also don't assume equal variances without checking. If one group spreads out a lot more than the other, use Welch's version of the t-test, which doesn't require equal variances.
