---
id: linearity
title: "Linearity"
category: assumptions
summary: "Checks whether the relationship between two continuous variables follows a straight line, before you trust a test built for straight-line patterns."
related: [pearson, spearman, outliers, descriptives]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Linearity means the relationship between two {{continuous}} variables follows a roughly straight line, a {{linear_relationship}}. It's not curving, leveling off, or bending partway through. Pearson correlation and linear regression are built to find straight-line patterns. They can badly understate, or completely miss, a relationship that curves instead.

## When to use it

Check linearity before you run a Pearson correlation or a linear regression on two continuous variables. It matters most when you suspect diminishing returns or a ceiling effect. These are cases where a relationship can be strong, but not straight.

## An everyday analogy

Think about study time and quiz scores. The first 20 minutes of studying might boost a score a lot. The next 20 minutes helps some more, but less. After an hour, extra studying barely moves the score at all. The student has learned most of what the material can teach. That's a real relationship. But it curves and flattens instead of climbing in a straight line. That's the kind of pattern linearity checks are built to catch.

## A worked example

A researcher records 6 students' study time (in minutes) and their quiz scores (0-100 scale):

| Student | Study minutes | Quiz score |
|---|---|---|
| 1 | 10 | 40 |
| 2 | 20 | 60 |
| 3 | 30 | 72 |
| 4 | 40 | 78 |
| 5 | 50 | 80 |
| 6 | 60 | 81 |

Plot these points and you'll see scores climb steeply at first. From 10 to 30 minutes, scores jump from 40 to 72. Then they level off. From 40 to 60 minutes, scores only rise from 78 to 81. That's a curve, not a straight line. Quiz scores still rise with more study time overall, just not at a steady rate.

## How to read the output

Statly shows a scatterplot of your two variables. For regression, it also shows a residual plot, the leftover error for each point after fitting a {{best_fit_line}}. A straight-line relationship shows points scattered evenly in a band around the line, with no visible curve. Here, the scatterplot shows an obvious bend. A residual plot would show a clear arc instead of a random scatter. Both are signs that a straight line isn't the right fit.

## What Statly checks

Statly checks linearity visually, not with one significance test. It shows a scatterplot of the two variables, and, when relevant, a residual plot from the fitted line. There's no strict numeric cutoff. You're looking for a real bend or curve in the pattern, not just random scatter around a straight line.

## What to do if it fails

If the relationship curves, a straight-line Pearson correlation will understate how strong it really is. Try a {{monotonic_relationship}} test instead, like Spearman's correlation. It only needs one variable to consistently rise, or fall, as the other does. It doesn't need the pattern to be perfectly straight. You can also transform one variable, a log transform often straightens out a diminishing-returns curve like this one, then recheck the scatterplot. Or fit a curved (polynomial) model if your question calls for regression specifically.

## Common mistakes

Don't judge linearity from {{r_squared}} or *r* alone. A curved relationship can still produce a moderately large *r*, just smaller than the true relationship deserves. Also don't skip the scatterplot just because a correlation came back significant. Significance tells you the relationship probably isn't zero. It doesn't tell you the pattern is actually straight.
