---
id: regression.linear
title: "Linear regression"
category: tests
summary: "Predicts a continuous outcome from one or more predictors using a straight-line equation."
related: [correlation.pearson, r_squared, regression.hierarchical]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Linear regression predicts a {{continuous}} outcome from one or more predictor variables. It fits a straight line through your data, then uses that line's equation to describe how the outcome changes as a predictor changes. The equation has two main pieces: an {{intercept}}, the predicted outcome when the predictor is zero, and a {{regression_coefficient}} (often called *b*) for each predictor, which tells you how much the outcome moves for each one-unit increase in that predictor.

## When to use it

Use simple linear regression when you have one continuous predictor and one continuous outcome, and you want to both describe the relationship and make predictions from it. Use multiple linear regression when you have two or more predictors. If you only want to know how strongly two variables move together, without predicting one from the other, a correlation is simpler. If your outcome is a yes/no category instead of a number, use logistic regression instead.

## An everyday analogy

Picture guessing a student's exam score from the number of hours they studied. If you plotted hours studied against exam score for a group of students, you would see a rough upward trend. Linear regression draws the single straight line that best follows that trend, so you can plug in a new number of study hours and read off a predicted score.

## A worked example

A teacher records hours spent on practice problems and posttest scores (0-20 scale) for 6 students (Scenario B).

| Student | Hours (*X*) | Score (*Y*) |
|---|---|---|
| 1 | 1 | 8 |
| 2 | 2 | 10 |
| 3 | 3 | 11 |
| 4 | 4 | 14 |
| 5 | 5 | 15 |
| 6 | 6 | 18 |

The mean of *X* is 3.5 and the mean of *Y* is 12.67. Statly finds the {{best_fit_line}} using the slope formula: *b* = sum of (X - mean X)(Y - mean Y), divided by sum of (X - mean X)squared. Working through the sums gives *b* = 1.97, and the intercept *a* = 12.67 - (1.97 x 3.5) = 5.77.

The fitted equation is: Score = 5.77 + 1.97 x Hours.

## How to read the output

Statly reports the intercept, the regression coefficient (*b*) for each predictor, a {{standard_error}} for each coefficient, a *t*-value and *p*-value testing whether each coefficient differs from zero, and {{r_squared}} for the whole model. Here, *b* = 1.97 means each extra hour of practice predicts about 2 more points on the posttest, holding nothing else constant since there is only one predictor. A significant *p*-value for a coefficient means that predictor's relationship with the outcome is unlikely to be due to chance. R-squared tells you what share of the variation in scores the model explains overall.

## How to report it (APA 7)

Template: `{Predictor} significantly predicted {outcome}, *b* = {b}, *SE* = {se}, *t*({df}) = {t}, *p* = {p}. The overall model explained {r2}% of the variance in {outcome}, *R²* = {r2_value}, *F*({df1}, {df2}) = {f}, *p* = {p}.`

Filled example: Hours of practice significantly predicted posttest score, *b* = 1.97, *SE* = 0.21, *t*(4) = 9.38, *p* < .001. The overall model explained 96% of the variance in posttest score, *R²* = .96, *F*(1, 4) = 87.98, *p* < .001.

## Common mistakes

Don't assume a strong regression line means one variable causes the other. A relationship this clean can still come from something else driving both variables. Also don't use the model to predict far outside the range of predictor values you actually observed, like guessing a score for 20 hours of practice when your data only ran from 1 to 6 hours. The straight-line pattern may not hold out there.
