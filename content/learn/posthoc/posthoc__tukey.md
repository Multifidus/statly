---
id: posthoc.tukey
title: "Tukey HSD"
category: posthoc
summary: "Compares every pair of groups after a significant ANOVA, while controlling the overall false-positive rate."
related: [anova.one_way, anova.factorial, multiple_comparisons, posthoc.games_howell]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Tukey's Honestly Significant Difference (HSD) test compares every possible pair of group means after a significant ANOVA. It's a type of {{post_hoc}} test, meaning you run it after finding an overall significant result, to figure out which specific groups actually differ from each other.

## When to use it

Use Tukey HSD after a one-way or factorial ANOVA comes back significant, when you have three or more groups with roughly equal variances and similar group sizes. It's one of the most common post hoc tests because it controls the {{family_wise_error_rate}}, the chance of getting at least one false positive across all your {{pairwise_comparison}}s, while still being reasonably powerful.

## An everyday analogy

Picture a baking contest with four entries. The judges announce that the entries clearly differ in quality overall, but that doesn't say which specific cakes beat which. Tukey HSD is like going back and comparing every pair of cakes head to head, but using a fair scoring rule so you don't falsely call a tie a real win just because you made so many comparisons.

## A worked example

Following a significant one-way ANOVA on knowledge-test scores across Control, Intervention A, and Intervention B (Scenario B), a researcher runs Tukey HSD on all three pairs.

| Comparison | Mean difference | *p* (adjusted) |
|---|---|---|
| Control vs. Intervention A | -2.50 | .008 |
| Control vs. Intervention B | -1.00 | .21 |
| Intervention A vs. Intervention B | 1.50 | .09 |

## How to read the output

Statly lists every pairwise comparison with a mean difference, a {{confidence_interval}}, and an adjusted {{p_value}}. Only the Control vs. Intervention A comparison falls below .05 here, so that's the one pair with a statistically detectable difference. The adjustment built into Tukey HSD already accounts for testing three pairs at once, so you can read these *p*-values directly without applying a separate correction.

## How to report it (APA 7)

Template: `A Tukey HSD post hoc test showed that {group1} (*M* = {m1}) scored significantly {higher/lower} than {group2} (*M* = {m2}), *p* = {p}.`

Filled example: A Tukey HSD post hoc test showed that Intervention A (*M* = 7.50) scored significantly higher than Control (*M* = 5.00), *p* = .008.

## Common mistakes

Don't run Tukey HSD without a significant omnibus ANOVA first, it's meant as a follow-up test, not a stand-alone comparison tool. Also don't use Tukey HSD when your groups have very different variances or very different sizes, Games-Howell is the better choice in that situation.
