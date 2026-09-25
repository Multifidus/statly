---
id: r_squared
title: "R-squared"
category: effect_sizes
summary: "Measures the proportion of variation in an outcome that a regression model explains."
related: [regression.linear, correlation.pearson, f_squared]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

R-squared tells you how much of the variation in your outcome a regression model accounts for. It ranges from 0 to 1. An R-squared of 0 means the predictors explain none of the variation in the outcome, and an R-squared of 1 means they explain all of it. It is the squared version of the {{correlation}} between the predicted values and the actual observed values.

## When to use it

Use R-squared any time you run a regression, whether it has one predictor or several, to summarize how well the whole model explains the outcome. It is one of the first numbers researchers check after fitting a regression model, alongside the significance of individual predictors.

## An everyday analogy

Picture trying to guess a student's exam score. If you knew nothing about them, your guesses would be scattered and often far off. If you knew how many hours they studied, your guesses would land much closer to their actual scores, most of the time. R-squared measures how much closer your guesses get once you use the predictor, compared to not using it at all.

## A worked example

Using the linear regression example predicting posttest score from hours of practice for 6 students, the model's line explained most, but not all, of the differences between students' scores. Statly reports R-squared = .96 for that model.

| Quantity | Value |
|---|---|
| Total variation in scores | Full spread of the 6 scores around their mean |
| Variation explained by hours of practice | 96% of that spread |
| Variation left unexplained | 4% of that spread |

## How to read the output

Statly reports R-squared as a decimal between 0 and 1, often alongside the percentage version. An R-squared of .96 means the predictor or predictors in the model account for 96% of the differences between students' outcome scores, leaving only 4% unexplained by the model. Higher values mean tighter, more predictable relationships. With more than one predictor, Statly also reports an adjusted version that corrects for the number of predictors in the model, which is more honest when comparing models with different numbers of predictors.

## How to report it (APA 7)

Template: `The model explained {percent}% of the variance in {outcome}, *R²* = {r2}, *F*({df1}, {df2}) = {f}, *p* = {p}.`

Filled example: The model explained 96% of the variance in posttest score, *R²* = .96, *F*(1, 4) = 87.98, *p* < .001.

## Benchmarks (and why to be careful)

There is no single universal cutoff for a "good" R-squared, since it depends heavily on the field and what you are studying. In tightly controlled lab settings, R-squared values above .50 are common. In education research, where many outside factors influence student outcomes, an R-squared of .10 to .20 can still represent a meaningful, useful relationship. Compare your R-squared to similar published studies in the same area rather than judging it against a fixed number.

## Common mistakes

Don't assume a high R-squared means your model has found a causal relationship. A model can explain a lot of variation while still reflecting other, unmeasured factors driving both the predictor and the outcome. Also don't compare R-squared values across studies with very different sample sizes or numbers of predictors without adjusting for those differences, since adding more predictors can inflate a plain R-squared even when they don't add real explanatory value.
