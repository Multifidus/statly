---
id: regression.hierarchical
title: "Hierarchical regression"
category: tests
summary: "Adds predictors to a regression model in ordered blocks to see how much each block improves prediction."
related: [regression.linear, f_squared]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Hierarchical regression builds a regression model in steps, or blocks, instead of putting every predictor in at once. You choose the order based on theory, like entering background variables first, then the variable you actually care about. At each step, Statly reports how much the model's {{r_squared}} improves, called *R²* change, which shows whether the new block of predictors adds meaningful prediction power beyond what came before.

## When to use it

Use hierarchical regression when you want to test whether a specific predictor or set of predictors explains extra variation in your outcome, above and beyond variables you already expect to matter. It is common when researchers want to control for background factors, like prior achievement, before checking whether a new program or variable adds anything.

## An everyday analogy

Picture predicting how well a plant grows. You already know sunlight matters, so you enter that first and see how well it predicts growth on its own. Then you add watering schedule as a second block and check how much better the prediction gets. If growth prediction barely improves, watering schedule is not adding much once sunlight is accounted for.

## A worked example

A researcher predicts posttest scores (0-20 scale) for 8 students (Scenario B). Block 1 enters pretest score alone. Block 2 adds a dummy-coded variable for group (0 = Control, 1 = Intervention A).

| Step | Predictors entered | *R²* | *R²* change |
|---|---|---|---|
| 1 | Pretest score | .42 | -- |
| 2 | Pretest score, Group | .68 | .26 |

Block 1 shows pretest score alone explains 42% of the variance in posttest scores. Adding group membership in Block 2 raises that to 68%, an increase of .26, or 26 more percentage points of explained variance.

## How to read the output

Statly reports *R²* for each step, the *R²* change from the previous step, and an *F*-test for whether that change is statistically significant. A significant *R²* change means the newly added block explains variance the earlier block could not, even after accounting for what came before. Look at the coefficients within the final block too, since a predictor's *b* value there reflects its effect after controlling for everything entered earlier.

## How to report it (APA 7)

Template: `Adding {block name} in Step {step} significantly improved the model, *ΔR²* = {delta_r2}, *ΔF*({df1}, {df2}) = {f}, *p* = {p}.`

Filled example: Adding group membership in Step 2 significantly improved the model, *ΔR²* = .26, *ΔF*(1, 5) = 5.20, *p* = .034.

## Common mistakes

Don't choose the order of your blocks after looking at the results. The whole point of hierarchical regression is that the order reflects your theory or research question, decided before you run the analysis. Also don't confuse this with stepwise regression, where a computer algorithm picks which predictors to add automatically. Hierarchical regression is always driven by the researcher's own reasoning about which variables belong in which block.
