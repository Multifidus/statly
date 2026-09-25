---
id: hedges_g
title: "Hedges' g"
category: effect_sizes
summary: "Adjusts Cohen's d for small-sample bias, giving a more accurate effect size estimate."
related: [cohens_d, glass_delta, t_independent, d_z_d_av, descriptives]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Hedges' g is Cohen's d with a small correction applied. Cohen's d slightly overestimates the true effect size when your {{sample_size}} is small, and Hedges' g fixes that by multiplying d by a correction factor. The smaller your samples, the more this correction matters.

## When to use it

Use Hedges' g instead of Cohen's d when you compare two independent groups with fewer than about 20 people per group. With large samples, the two measures come out almost the same, so the correction barely changes anything.

## An everyday analogy

Think of it like a small handicap in golf. A raw score doesn't tell the whole story if course conditions favored a small group of players. Hedges' g applies a fair adjustment so a small sample doesn't look like a bigger effect than it really is.

## A worked example

Using the same two groups as the Cohen's d example:

| Group | Scores | Mean | SD |
|---|---|---|---|
| Control | 4, 5, 6, 5 | 5.00 | 0.82 |
| Intervention A | 6, 7, 8, 7 | 7.00 | 0.82 |

Cohen's d = 2.45, with *df* = *n1* + *n2* - 2 = 6.

Correction factor J = 1 - [3 / (4 x *df* - 1)] = 1 - (3/23) = 0.87

Hedges' g = *d* x J = 2.45 x 0.87 = 2.13

## How to read the output

Statly reports Hedges' g right next to Cohen's d when your groups are small. Expect g to be a little smaller than d, since the correction always shrinks the estimate slightly. Interpret it the same way as Cohen's d: it's how many {{standard_deviation}}s apart the two group means are.

## How to report it (APA 7)

Template: `There was a significant difference in scores between {group1} (*M* = {m1}, *SD* = {sd1}) and {group2} (*M* = {m2}, *SD* = {sd2}), *t*({df}) = {t}, *p* = {p}, *g* = {g}.`

Filled example: There was a significant difference in scores between Control (*M* = 5.00, *SD* = 0.82) and Intervention A (*M* = 7.00, *SD* = 0.82), *t*(6) = 3.46, *p* = .013, *g* = 2.13.

## Benchmarks (and why to be careful)

The same small/medium/large labels used for Cohen's d (0.20, 0.50, 0.80) get applied to Hedges' g. Those numbers came from general research, not classrooms. In education research, published effects are often smaller. Judge your g against similar studies in your subject and grade level rather than a generic chart.

## Common mistakes

Don't apply the correction twice. If Statly already reports Hedges' g, it's already adjusted, so you don't need to multiply it again. Also remember the correction only matters with small samples. Don't expect a big difference from Cohen's d when your groups each have 50 or more people.
