---
id: proportional_odds
title: "Proportional odds assumption"
category: assumptions
summary: "Checks that each predictor in an ordinal regression has roughly the same effect across every category boundary."
related: [regression.ordinal]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

The {{proportional_odds_assumption}} is a rule for ordinal regression. It says each predictor's effect must be about the same size, no matter which pair of outcome categories you compare. The jump from low to medium engagement should work like the jump from medium to high engagement.

## When to use it

Check this rule any time you run an ordinal regression with three or more ordered outcome levels. Do this before you trust the single coefficient the model gives each predictor. If the rule clearly fails, that single coefficient is misleading. The real effect changes depending on which pair of categories you look at.

## An everyday analogy

Picture a set of stairs where each step should be the same height. This rule assumes moving from the bottom step to the middle step takes the same effort as moving from the middle step to the top step. If one step is much taller, treating them as equal hides something real about the stairs.

## A worked example

A researcher runs an ordinal regression. It predicts engagement level (Low, Medium, High) from number of extracurricular activities, for 9 students (Scenario B, adapted). The model assumes activities affect the Low-to-Medium jump the same way as the Medium-to-High jump.

## How to read the output

Statly reports a test, often a likelihood-ratio test. It compares the simple model that assumes this rule holds to a more flexible model that lets each predictor's effect change by pair. A *p*-value above your {{alpha}} supports the rule, so the simple model is fine. A *p*-value below it suggests the effect really does shift across pairs.

## What Statly checks

Statly compares model fit with and without this rule in place. It reports whether dropping the rule meaningfully improves fit. It also shows separate results for each pair of categories, so you can compare the coefficients by eye.

## What to do if it fails

If this rule fails, try a model that lets effects vary by pair, sometimes called a partial proportional odds model. You could also merge categories if two pairs behave alike, or run separate simple logistic regressions for each pair instead. If you do this, say clearly that you moved away from the standard model.

## Common mistakes

Don't skip this check just because overall model fit looks fine. A model can fit well overall while still badly breaking this rule for one predictor. Also don't assume a large sample fixes this on its own. Unlike some other rules, this kind of problem does not fade away as sample size grows.
