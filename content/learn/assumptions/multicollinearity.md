---
id: multicollinearity
title: "Multicollinearity"
category: assumptions
summary: "Checks that your regression predictors aren't so strongly correlated with each other that they confuse the model."
related: [regression.linear, regression.hierarchical, correlation.pearson]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Multicollinearity means two or more predictors in a regression model overlap a lot with each other, not just with the outcome. When predictors overlap too much, the model can't tell which one is really driving the effect. The individual {{regression_coefficient}} values can get shaky and hard to trust.

## When to use it

Check for multicollinearity any time you run a regression with two or more predictors. Do this before you look at the individual coefficients. It matters most when two predictors measure almost the same thing, like a prior test score and a grade point average.

## An everyday analogy

Picture guessing basketball skill from height or shoe size. In your sample, tall people almost always have big feet too. The two clues move together so closely that you can't tell which one truly explains skill, even if both seem to relate to it.

## A worked example

A researcher predicts posttest score from both pretest score and a reading-confidence total, for 8 students (Scenario A and B combined). Pretest score and reading-confidence total turn out to correlate at *r* = .91 with each other. That is much higher than either one correlates with the posttest outcome.

## How to read the output

Statly reports a {{variance_inflation_factor}}, or VIF, for each predictor. A VIF near 1 means that predictor does not overlap much with the others. As a rough guide, a VIF above 5, and especially above 10, signals a problem worth fixing. In this example, both pretest score and reading-confidence total would likely show high VIF values, since they overlap so much.

## What Statly checks

Statly finds each predictor's VIF by seeing how well that predictor can be guessed from all the other predictors combined. A high VIF means that predictor adds little new information once the others are already in the model.

## What to do if it fails

If VIF flags a problem, try dropping one of the overlapping predictors, especially if two variables measure nearly the same thing. You could also combine them into one score, or use a method built to handle overlapping predictors. Whatever you pick, say in your write-up that you checked for this, so readers trust the coefficients.

## Common mistakes

Don't assume a high overall {{r_squared}} means this problem is not there. A model can predict well overall while its individual coefficients are still shaky from overlap. Also don't ignore VIF just because each predictor's *p*-value looks fine. Overlap can inflate standard errors enough to hide a real effect, so a weak *p*-value might still hide something that matters.
