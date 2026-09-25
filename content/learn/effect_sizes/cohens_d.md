---
id: cohens_d
title: "Cohen's d"
category: effect_sizes
summary: "Measures the size of a difference between two independent group means in standard deviation units."
related: [t_independent, hedges_g, glass_delta, anova_welch, descriptives]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Cohen's d tells you how big a difference between two independent groups really is, not just whether it's real. It measures the gap between two group means in {{standard_deviation}} units. A *p*-value only tells you if a difference is likely due to chance. Cohen's d tells you how large that difference is, in a way you can compare across studies.

## When to use it

Use Cohen's d after an independent-samples {{t_statistic}} test, when you compare two separate groups (not the same people measured twice) and their spread of scores is roughly similar. If the two groups have very different amounts of spread, Glass's delta is a better choice.

## An everyday analogy

Picture two classes that took the same 10-point quiz. Knowing one class averaged 2 points higher tells you something. But if every student's score barely varies within each class, that 2-point gap feels huge. If scores range wildly in each class, the same gap feels small. Cohen's d puts the gap in context of how spread out the scores are.

## A worked example

Control group (n = 4): 4, 5, 6, 5. Intervention A group (n = 4): 6, 7, 8, 7.

| Group | Scores | Mean | SD |
|---|---|---|---|
| Control | 4, 5, 6, 5 | 5.00 | 0.82 |
| Intervention A | 6, 7, 8, 7 | 7.00 | 0.82 |

The two groups have almost identical spread, so pool their SDs:

pooled SD = sqrt[((4-1)(0.82)² + (4-1)(0.82)²) / (4+4-2)] = sqrt(4.00/6) = 0.82

Cohen's d = (7.00 - 5.00) / 0.82 = 2.45

## How to read the output

Statly reports Cohen's d alongside the *t* value it comes from. A positive d means the second group listed scored higher, a negative d means the first group did. The sign depends only on which group you list first, so check the direction against your actual data.

## How to report it (APA 7)

Template: `There was a significant difference in scores between {group1} (*M* = {m1}, *SD* = {sd1}) and {group2} (*M* = {m2}, *SD* = {sd2}), *t*({df}) = {t}, *p* = {p}, *d* = {d}.`

Filled example: There was a significant difference in scores between Control (*M* = 5.00, *SD* = 0.82) and Intervention A (*M* = 7.00, *SD* = 0.82), *t*(6) = 3.46, *p* = .013, *d* = 2.45.

## Benchmarks (and why to be careful)

Cohen's rough guide calls *d* = 0.20 small, 0.50 medium, and 0.80 large. Those labels came from general behavioral research, not education specifically. {{effect_size}}s in education studies often run smaller than in lab settings. An intervention with *d* = 0.30 might be a genuinely useful, above-average effect in a classroom study, even though Cohen's chart calls it "small." Compare your *d* to effect sizes from similar programs in the same subject and age group before deciding if a result matters.

## Common mistakes

Don't use Cohen's d in place of a real statistical test. It doesn't tell you whether a difference is likely due to chance on its own. Also don't compare a *d* from paired data, like pre and post scores from the same people, directly to a *d* from two independent groups. They're calculated differently and aren't quite on the same scale.
