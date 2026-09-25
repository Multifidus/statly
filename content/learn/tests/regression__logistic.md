---
id: regression.logistic
title: "Logistic regression"
category: tests
summary: "Predicts a two-category outcome, like pass or fail, from one or more predictors."
related: [regression.linear, odds_ratio, chi_square.independence]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Logistic regression predicts a {{dichotomous_variable}} outcome, one with only two categories like pass/fail or yes/no, from one or more predictors. Instead of fitting a straight line like linear regression, it fits an S-shaped curve that predicts the probability of the outcome happening. Statly reports each predictor's effect as an {{odds_ratio}}, which tells you how the odds of the outcome change as the predictor increases.

## When to use it

Use logistic regression when your outcome has exactly two categories and you want to know how one or more predictors relate to the chance of landing in one category versus the other. If your outcome has more than two ordered categories, like low/medium/high, use ordinal regression instead. If your outcome is continuous, use linear regression.

## An everyday analogy

Picture predicting whether a student passes or fails a course based on how many hours they studied per week. You cannot draw a simple straight line through pass/fail data the way you can through test scores, since the outcome only has two possible values. Logistic regression instead estimates a curve showing how the probability of passing rises as study hours increase.

## A worked example

A researcher records weekly study hours and pass/fail status for 8 students (Scenario B, adapted).

| Student | Study hours | Passed |
|---|---|---|
| 1 | 1 | No |
| 2 | 2 | No |
| 3 | 3 | No |
| 4 | 4 | Yes |
| 5 | 5 | Yes |
| 6 | 6 | Yes |
| 7 | 2 | No |
| 8 | 5 | Yes |

Statly fits this iteratively, since there is no simple formula like the one for linear regression. Here is what the output table looks like:

| Predictor | *B* | *SE* | *z* | *p* | Odds ratio |
|---|---|---|---|---|---|
| Study hours | 1.85 | 0.91 | 2.03 | .042 | 6.36 |
| Intercept | -6.02 | 3.05 | -1.97 | .049 | -- |

## How to read the output

Statly reports each predictor's coefficient (*B*) on the {{logit}} scale, a standard error, a *z*-test, a *p*-value, and the odds ratio. The odds ratio is usually easier to interpret than *B* directly. Here, an odds ratio of 6.36 for study hours means each extra hour of studying multiplies the odds of passing by about 6.36. An odds ratio above 1 means the odds increase as the predictor increases; below 1 means the odds decrease. A *p*-value under your {{alpha}} means that predictor's relationship with the outcome is unlikely to be due to chance.

## How to report it (APA 7)

Template: `{Predictor} was a significant predictor of {outcome}, *B* = {b}, *SE* = {se}, *p* = {p}, *OR* = {or}.`

Filled example: Weekly study hours was a significant predictor of passing, *B* = 1.85, *SE* = 0.91, *p* = .042, *OR* = 6.36.

## Common mistakes

Don't interpret the raw coefficient (*B*) the way you would a linear regression slope. It is on the logit scale, not the original units, so convert to an odds ratio first. Also don't run logistic regression with a very small sample or with an outcome where one category is rare. Odds ratios can become unstable and hard to trust when a category has only a handful of cases.
