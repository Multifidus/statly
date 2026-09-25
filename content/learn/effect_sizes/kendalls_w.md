---
id: kendalls_w
title: "Kendall's W"
category: effect_sizes
summary: "Measures the size of a Friedman test's effect, based on how much agreement there is in the rankings across conditions."
related: [friedman, anova_rm, wilcoxon_signed_rank, sphericity, descriptives]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Kendall's W is the effect size that goes with a Friedman test. It measures how much agreement there is across your sample in how conditions get ranked, on a scale from 0 (no agreement, rankings look random) to 1 (everyone ranked the conditions in exactly the same order).

## When to use it

Report Kendall's W alongside a Friedman test result, whenever you have three or more repeated measurements on the same people or units and want to say how strong, not just how likely, the pattern of differences is.

## An everyday analogy

Imagine asking five friends to rank three coffee shops from favorite to least favorite. If they all rank the same shop first, Kendall's W is close to 1, there's strong agreement. If their rankings are all over the place, Kendall's W is close to 0.

## A worked example

Five students rank across pretest, posttest, and follow-up on the same 10-point quiz (Scenario B), as in the Friedman test example:

| Student | Pretest rank | Posttest rank | Follow-up rank |
|---|---|---|---|
| 1 | 1 | 3 | 2 |
| 2 | 1 | 3 | 2 |
| 3 | 2 | 1 | 3 |
| 4 | 1 | 3 | 2 |
| 5 | 1 | 3 | 2 |
| **Sum** | **6** | **13** | **11** |

The Friedman chi-square_r for this data is 5.20, with *n* = 5 students and *k* = 3 conditions.

Kendall's W = chi-square_r / [*n*(*k*-1)] = 5.20 / [5(2)] = 5.20 / 10 = .52

## How to read the output

Statly reports Kendall's W right next to the Friedman test's chi-square_r, {{degrees_of_freedom}}, and *p*-value. A W of .52 means there's moderate agreement in how students' scores ranked across the three time points, not perfect, but a clear pattern.

## How to report it (APA 7)

Template: `A Friedman test showed a {significant/non-significant} difference in {outcome} across the {k} conditions, chi-square_r({df}) = {chi2}, *p* = {p}, *W* = {w}.`

Filled example: A Friedman test showed a non-significant difference in quiz score across pretest, posttest, and follow-up, chi-square_r(2) = 5.20, *p* = .074, *W* = .52.

## Benchmarks (and why to be careful)

Rough cutoffs treat *W* around .1 as weak agreement, .3 as moderate, and .5 or above as strong, but these weren't developed specifically for classroom data. In education research, moderate agreement across a small group, like the five students above, may reflect a real and useful pattern even if the Friedman test itself falls short of significance. Weigh Kendall's W alongside similar studies in your subject area, not a fixed scale alone.

## Common mistakes

Don't interpret Kendall's W without also checking the Friedman test's *p*-value. A moderate W can show up even when the pattern could plausibly be due to chance, especially with a small sample. Also don't confuse Kendall's W with Kendall's tau-b, they share a name but measure different things: agreement across raters or conditions versus correlation between two variables.
