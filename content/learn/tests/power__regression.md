---
id: power.regression
title: "Power analysis for regression"
category: tests
summary: "Estimates how many participants you need to reliably detect a predictor's effect in a multiple regression, accounting for the number of predictors."
related: [regression.linear, f_squared]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Power analysis for multiple regression tells you how many people you need. It helps you detect that a set of predictors explains a real share of variance in an outcome. It uses Cohen's *f*², an effect size scale built for regression. It also uses the number of predictors in your model, your {{alpha}} level, and your target {{power}}. Together these give you the sample size you need. Unlike a t-test or a simple correlation, the number of predictors itself changes how much data you need.

## When to use it

Use {{a_priori_power}} analysis before you collect data. This fits a study using regression to predict an outcome, like a test score, from a few predictors, like attendance and prior GPA. Use {{sensitivity_analysis}} when your sample size is already fixed. It tells you the smallest overall effect your model could still detect.

> **Before you collect data:** Run this analysis before you gather a single response. Do it as part of a Study Planner draft. Models with more predictors need more people to stay reliable. Decide your predictor list and your sample size together, ahead of time, to avoid an underpowered model.

## An everyday analogy

Picture predicting a runner's race time. First try using just their shoe brand. Then try using their shoe brand, training hours, and sleep habits together. The more factors you juggle, the more races you need to watch. Only then can you tell which factors truly matter, versus which just look important by chance.

## A worked example

Say you're planning a regression that predicts a knowledge test score from 2 predictors, prior GPA and attendance rate. You want to detect a medium effect, *f*² = 0.15, with 80% power at alpha = .05.

Standard power tables say you'd need about N = 68 people.

Say only 35 students are available. A sensitivity analysis with N = 35 and 2 predictors fixed would find the smallest *f*² your model could still detect. That's closer to *f*² = 0.30, a fairly large effect. A true medium-sized effect might go undetected at that sample size.

## How to read the output

For an a priori analysis, Statly reports the sample size you need. For a sensitivity analysis, it reports the smallest Cohen's *f*² you could detect. Both depend a lot on the number of predictors in your model. More predictors usually raise the sample size needed for the same power. Statly skips post hoc power, based on the *R*² or *f*² you actually observed. {{post_hoc_power_fallacy}} just restates your model's *p*-value in a new form. It adds no new information, which is why it's discouraged.

## How to report it (APA 7)

Template: `A sample of N = {n} would provide {power}% power to detect {effect description} (f2 = {f2}) with {k} predictors at alpha = {alpha}.`

Filled example: A sample of N = 68 would provide 80% power to detect a medium effect (*f*² = 0.15) with 2 predictors at alpha = .05.

## Common mistakes

Don't add predictors to a model without also raising your planned sample size. More predictors usually demand more data to detect the same true effect. Don't confuse the effect size for one predictor with the effect size for the whole model. *f*² in a power analysis usually means the overall model, unless you say otherwise. Also don't skip power planning just because regression feels flexible. An underpowered regression model can give unstable, misleading coefficient estimates.
