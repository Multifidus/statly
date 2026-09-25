---
id: regression.ordinal
title: "Ordinal regression"
category: tests
summary: "Predicts an ordered categorical outcome, like low/medium/high, from one or more predictors."
related: [regression.logistic, proportional_odds]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Ordinal regression predicts an {{ordinal}} outcome, one with ordered categories like low, medium, and high, from one or more predictors. It extends the idea behind logistic regression to outcomes with more than two ordered levels. Statly estimates a single coefficient for each predictor that describes its effect across all the category boundaries at once, assuming that effect is roughly the same at each boundary.

## When to use it

Use ordinal regression when your outcome has three or more categories with a natural order, like a rating scale collapsed into low/medium/high engagement, but the gaps between categories are not necessarily equal. If your outcome only has two categories, use logistic regression. If your outcome is a true continuous number, use linear regression instead.

## An everyday analogy

Picture predicting whether a student's engagement in class is rated low, medium, or high based on how many extracurricular activities they join. The categories have a clear order, low is less than medium is less than high, but you cannot treat them as evenly spaced numbers the way you could a test score. Ordinal regression respects that order without pretending the categories are a plain number line.

## A worked example

A researcher records number of extracurricular activities and a teacher-rated engagement level (Low, Medium, High) for 9 students (Scenario B, adapted).

| Student | Activities | Engagement |
|---|---|---|
| 1 | 0 | Low |
| 2 | 1 | Low |
| 3 | 1 | Medium |
| 4 | 2 | Medium |
| 5 | 2 | Medium |
| 6 | 3 | High |
| 7 | 3 | High |
| 8 | 4 | High |
| 9 | 0 | Low |

Statly fits this iteratively, the same way it fits logistic regression, since there is no simple hand formula. Here is what the output table looks like:

| Predictor | *B* | *SE* | *p* | Odds ratio |
|---|---|---|---|---|
| Activities | 1.42 | 0.58 | .014 | 4.14 |
| Threshold: Low\|Medium | -1.10 | 0.72 | .126 | -- |
| Threshold: Medium\|High | 2.35 | 0.98 | .017 | -- |

## How to read the output

Statly reports a coefficient (*B*) and odds ratio for each predictor, plus one threshold value for each boundary between adjacent categories. The predictor's odds ratio applies across all boundaries the same way, that is the core assumption of this model. Here, an odds ratio of 4.14 for activities means each extra activity multiplies the odds of being in a higher engagement category by about 4.14, whether comparing low to medium-or-higher or medium to high. The threshold values mark where each category boundary sits on the underlying scale and are usually not the focus of interpretation.

## How to report it (APA 7)

Template: `{Predictor} was a significant predictor of {outcome}, *B* = {b}, *SE* = {se}, *p* = {p}, *OR* = {or}.`

Filled example: Number of extracurricular activities was a significant predictor of engagement level, *B* = 1.42, *SE* = 0.58, *p* = .014, *OR* = 4.14.

## Common mistakes

Don't use ordinal regression without checking the proportional odds assumption first, since the whole model relies on each predictor having a similar effect at every category boundary. Also don't treat the ordered categories as if they were equally spaced numbers and run a plain linear regression instead. That approach ignores the fact that the gap between low and medium might not match the gap between medium and high.
