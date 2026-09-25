---
id: f_squared
title: "f² (Cohen's f-squared)"
category: effect_sizes
summary: "Measures how much a predictor or set of predictors explains in a regression or ANCOVA model."
related: [regression.linear, r_squared, power.regression]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

{{f_squared}} measures the size of an effect in regression or ANCOVA, showing how much a predictor, or a whole set of predictors, adds to how well the model explains the outcome. It's the regression-world equivalent of Cohen's *f*, and it's built directly from {{r_squared}}, the proportion of variance a model explains.

## When to use it

Use f² when you want an effect size for a regression predictor, a set of predictors, or an ANCOVA covariate's contribution, especially if you're also planning sample size with a power analysis. It's particularly useful for describing how much one predictor adds on top of others already in the model.

## An everyday analogy

Picture predicting a runner's race time using their training hours. Adding a second predictor, sleep quality, might explain more of the differences in race times. f² measures how much extra explanatory power that second predictor adds, compared to how much is still left unexplained.

## A worked example

A researcher builds a regression predicting posttest score from pretest score alone (R² = 0.40), then adds a second predictor, hours of practice, and finds the fuller model explains more (R² = 0.55, Scenario B style data).

f² = (R²_full - R²_reduced) / (1 - R²_full)

f² = (0.55 - 0.40) / (1 - 0.55) = 0.15 / 0.45 = 0.33

## How to read the output

Statly reports f² alongside the R² change and the significance test for adding a predictor. A bigger f² means that predictor (or set of predictors) is contributing more unique explanatory power to the model. Here, adding hours of practice contributed a fairly substantial amount beyond pretest score alone.

## How to report it (APA 7)

Template: `Adding {predictor} significantly improved the model, *R*² change = {value}, *F*({df1}, {df2}) = {F}, *p* = {p}, *f*² = {value}.`

Filled example: Adding hours of practice significantly improved the model, *R*² change = .15, *F*(1, 9) = 3.60, *p* = .09, *f*² = 0.33.

## Benchmarks (and why to be careful)

Cohen's rough guide calls f² = 0.02 small, 0.15 medium, and 0.35 large. These labels come from general behavioral science, not education research specifically. A predictor with f² = 0.10 might still represent a practically useful piece of a model predicting student outcomes, even though it reads as closer to "small" on the generic scale. Compare against effect sizes from similar education models before deciding how much a predictor's contribution matters.

## Common mistakes

Don't compute f² from R² values that come from different sample sizes or different outcome variables, the comparison only makes sense within the same model and data set. Also don't treat a small f² as unimportant without context, a modest but reliable predictor can still matter a lot in a practical, real-world model.
