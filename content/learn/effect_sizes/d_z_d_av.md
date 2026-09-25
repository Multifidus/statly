---
id: d_z_d_av
title: "d_z and d_av (paired effect sizes)"
category: effect_sizes
summary: "Two ways to measure effect size for paired or repeated-measures data, one based on the spread of the differences and one on the average spread of both measurements."
related: [t_paired, wilcoxon_signed_rank, cohens_d, hedges_g, descriptives]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

When the same people are measured twice, like a pretest and posttest, you need a different effect size than Cohen's d for independent groups. *d_z* divides the mean difference by the {{standard_deviation}} of the difference scores themselves. *d_av* divides that same mean difference by the average of the pretest and posttest SDs instead. The two usually give different numbers for the same data.

## When to use it

Use *d_z* or *d_av* after a paired or repeated-measures test, like a paired *t*-test, when the same people or units are measured under two conditions. Pick *d_av* for an effect size that's comparable to Cohen's d from an independent-groups study, since it uses raw-score spread instead of the spread of differences. Pick *d_z* when you care about how consistent each person's change was.

## An everyday analogy

Imagine timing the same runners before and after a training program. *d_z* asks how consistent everyone's improvement was, relative to how much people varied from each other. *d_av* asks how big the average improvement was, relative to how spread out runners' times normally are. Both are useful, they just answer slightly different questions.

## A worked example

Four students' scores on a 0-100 outcome, before and after a program (Scenario C):

| Student | Pretest | Posttest | Difference |
|---|---|---|---|
| 1 | 60 | 70 | 10 |
| 2 | 70 | 75 | 5 |
| 3 | 65 | 80 | 15 |
| 4 | 75 | 85 | 10 |

Mean difference = 10.00, SD of differences = 4.08

*d_z* = 10.00 / 4.08 = 2.45

Pretest SD = 6.45, posttest SD = 6.45, average SD = 6.45

*d_av* = 10.00 / 6.45 = 1.55

## How to read the output

Statly reports both values when you run a paired test, so you can compare them. *d_z* tends to run larger than *d_av* when people's changes are more consistent than their raw scores are spread out, which is common with repeated measures on the same people. Neither number is wrong, they just use a different denominator.

## How to report it (APA 7)

Template: `There was a significant increase in scores from {condition1} (*M* = {m1}, *SD* = {sd1}) to {condition2} (*M* = {m2}, *SD* = {sd2}), *t*({df}) = {t}, *p* = {p}, *d_z* = {dz}.`

Filled example: There was a significant increase in scores from pretest (*M* = 67.50, *SD* = 6.45) to posttest (*M* = 77.50, *SD* = 6.45), *t*(3) = 4.90, *p* = .016, *d_z* = 2.45.

## Benchmarks (and why to be careful)

The familiar 0.20/0.50/0.80 cutoffs for small, medium, and large effects came from general behavioral research, not classrooms. *d_z* in particular tends to run larger than independent-groups effect sizes for a similar real-world change, since paired designs remove person-to-person variation from the denominator. Compare your result to other pre and post studies in the same subject and age group, not just a generic chart.

## Common mistakes

Don't compare a *d_z* directly to a Cohen's d from an independent-groups study. They're built from different kinds of variation, and *d_z* usually comes out larger for a similar-sized real change. Also don't report just one of *d_z* or *d_av* without saying which you used, since readers may assume you mean the other.
