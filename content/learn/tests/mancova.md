---
id: mancova
title: "MANCOVA (Multivariate Analysis of Covariance)"
category: tests
summary: "Compares groups on several outcome variables at once while adjusting for a covariate like a pretest."
related: [manova, ancova, box_m]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

MANCOVA combines MANOVA and ANCOVA. It tests whether groups differ across two or more outcomes considered together, while also adjusting for a {{covariate}}, such as a pretest score, that might already explain some of the difference between groups.

## When to use it

Use MANCOVA when you have three or more groups, two or more related continuous outcomes, and a background variable you want to control for before comparing groups. It's common in education research when you measure several posttest outcomes, like a knowledge score and a confidence score, and want to account for a shared pretest.

## An everyday analogy

Picture comparing three coaching programs on both game performance and stamina, but the athletes didn't all start at the same fitness level. MANCOVA is like the golf handicap idea from ANCOVA, but applied to two scoreboards at once: it adjusts both outcomes for starting fitness before comparing the coaching programs.

## A worked example

A researcher compares knowledge-test and confidence-survey scores across Control, Intervention A, and Intervention B, adjusting for each student's pretest knowledge score, with about 5 students per group (Scenario B).

| Group | Pretest | Knowledge (M) | Confidence (M) |
|---|---|---|---|
| Control | 4.5 | 5.0 | 12.0 |
| Intervention A | 4.0 | 7.5 | 14.5 |
| Intervention B | 4.8 | 6.0 | 17.0 |

Statly computes this for you. Here's how to read what it gives you: it fits the model with the covariate included, then reports a combined multivariate test.

| Test | Value | *F* | df | *p* |
|---|---|---|---|---|
| Pillai's trace | 0.58 | 2.95 | 4, 22 | .041 |

## How to read the output

Statly reports Pillai's trace, an *F* value, degrees of freedom, and a *p*-value for the overall multivariate effect, adjusted for the covariate. A significant result means groups still differ across the combined outcomes after accounting for the covariate. As with MANOVA, Statly follows this with univariate ANCOVA results for each outcome separately, so you can see which outcome is driving the difference.

## How to report it (APA 7)

Template: `After adjusting for {covariate}, a MANCOVA showed a significant effect of {group variable} on the combined outcomes, Pillai's trace = {value}, *F*({df1}, {df2}) = {F}, *p* = {p}.`

Filled example: After adjusting for pretest knowledge score, a MANCOVA showed a significant effect of group on the combined outcomes, Pillai's trace = 0.58, *F*(4, 22) = 2.95, *p* = .041.

## Common mistakes

Don't include a covariate that's actually affected by group membership, like a measure taken after the intervention started, that biases the adjustment. Also don't forget to check that groups have similar covariance patterns across outcomes before trusting the result, an assumption checked with Box's M test.
