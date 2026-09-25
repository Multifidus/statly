---
id: homogeneity_of_regression_slopes
title: "Homogeneity of Regression Slopes"
category: assumptions
summary: "Checks that the relationship between your covariate and your outcome is the same in every group before running ANCOVA."
related: [ancova, ancova.quade, linearity]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

ANCOVA depends on this assumption. It says the link between your {{covariate}}, like a pretest score, and your outcome should have roughly the same slope in every group. If that link looks different from group to group, ANCOVA's single adjustment stops making sense.

## When to use it

Check this assumption before you trust an ANCOVA result. It matters most when you suspect the covariate works differently across groups. For example, a pretest might predict posttest scores strongly in one teaching condition but weakly in another.

## An everyday analogy

Picture two coaches predicting a runner's race time from practice-lap time. For one team, faster practice laps reliably mean a faster race time. For the other team, practice laps barely predict anything, maybe because of a different pacing style. Using one shared rule for both teams would be misleading. The link between practice and race time is not the same in each group.

## A worked example

A researcher plans an ANCOVA on posttest knowledge scores, using pretest score as the covariate, across Control and Intervention A (Scenario B).

| Group | Pretest-posttest slope |
|---|---|
| Control | 0.85 |
| Intervention A | 0.20 |

In Control, a higher pretest strongly predicts a higher posttest. In Intervention A, pretest barely matters, maybe because the intervention lifted everyone's scores regardless of where they started. These two slopes are quite different, which is a warning sign for standard ANCOVA.

## How to read the output

Statly tests this by adding a Group x Covariate interaction term to the model. It reports an *F* value, degrees of freedom, and a {{p_value}}. A significant interaction here, *F*(1, 8) = 6.30, *p* = .036, means the slopes differ across groups. That is a problem for the standard ANCOVA adjustment.

## What Statly checks

Statly fits a model with an interaction between your grouping variable and your covariate. It then tests whether that interaction is significant. A non-significant interaction supports using standard ANCOVA. A significant one flags that the covariate-outcome link is not the same across groups.

## What to do if it fails

If this assumption fails, try Quade's test instead. It is the nonparametric, rank-based alternative to ANCOVA, and it is less sensitive to this problem. You could also report the Group x Covariate interaction itself. It may be a useful finding on its own, showing the covariate matters more for some groups than others.

## Common mistakes

Don't skip this check just because your overall ANCOVA result looks clean. An unequal slope can quietly distort the adjusted means with no obvious warning sign elsewhere. Also don't confuse this with homogeneity of variance. They test different things. One is about the covariate's link to the outcome. The other is about how spread out the outcome is within each group.
