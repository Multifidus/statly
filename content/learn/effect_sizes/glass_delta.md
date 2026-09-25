---
id: glass_delta
title: "Glass's delta"
category: effect_sizes
summary: "Measures the size of a difference between two groups using only the control group's standard deviation."
related: [cohens_d, hedges_g, t_test.independent, anova.welch, homogeneity_of_variance]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Glass's delta measures the gap between two group means, like Cohen's d, but it divides by only one group's {{standard_deviation}}, usually the control or comparison group. This matters when the two groups don't have similar spread, which breaks the assumption behind Cohen's pooled SD.

## When to use it

Use Glass's delta when your two groups likely differ in variability, not just in average score. For example, a new teaching method might change how spread out student scores are, not just the average. It's also a good choice when one group is a clear baseline or control and the other group's spread might not be trustworthy.

## An everyday analogy

Imagine judging how much taller plants grew after fertilizer, using only the untreated plants as your ruler for "typical" variation. If the fertilized plants suddenly grew at wildly different rates, you wouldn't want that new chaos to change your ruler. You'd stick with the steady, untreated group's spread instead.

## A worked example

Control group (n = 5): 5, 5, 6, 5, 6. Intervention A group (n = 5): 6, 8, 5, 9, 7.

| Group | Scores | Mean | SD |
|---|---|---|---|
| Control | 5, 5, 6, 5, 6 | 5.40 | 0.55 |
| Intervention A | 6, 8, 5, 9, 7 | 7.00 | 1.58 |

The Intervention A group's SD is almost three times larger. Pooling them would hide that difference in spread, so use only the control group's SD:

Glass's delta = (7.00 - 5.40) / 0.55 = 2.92

## How to read the output

Statly labels this value Glass's delta whenever the two groups' SDs differ enough that pooling wouldn't make sense. Read it the same way as Cohen's d: it's the size of the gap in control-group standard deviation units. A large gap between the two groups' SDs is itself worth reporting, since it can mean the intervention changed consistency, not just the average.

## How to report it (APA 7)

Template: `There was a significant difference in scores between {group1} (*M* = {m1}, *SD* = {sd1}) and {group2} (*M* = {m2}, *SD* = {sd2}), *t*({df}) = {t}, *p* = {p}, *Δ* = {delta}.`

Filled example: There was a non-significant difference in scores between Control (*M* = 5.40, *SD* = 0.55) and Intervention A (*M* = 7.00, *SD* = 1.58), *t*(4.95) = 2.14, *p* = .086, *Δ* = 2.92.

## Benchmarks (and why to be careful)

The usual small/medium/large cutoffs (0.20, 0.50, 0.80) still work as a rough guide for Glass's delta, but they came from general psychology research, not classrooms. Education effect sizes are often judged against results from similar programs in the same subject and grade level, not one generic scale. A Δ = 2.92 from a tiny pilot class, like the example above, deserves a much bigger grain of salt than the same number from a large, well-controlled study.

## Common mistakes

Don't pick whichever group's SD gives you the bigger effect size. Always use the control or baseline group's SD, decided before you see the results. Also don't use Glass's delta as your default. If the two groups' spreads are actually similar, Cohen's d or Hedges' g uses more of your data and gives a more stable estimate.
