---
id: outliers
title: "Outliers"
category: assumptions
summary: "Checks for data points that sit far outside the rest of your scores and could be distorting your results."
related: [normality, descriptives, pearson, t_one_sample]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

An {{outlier}} is a data point that sits far away from the rest of your scores, unusually high, unusually low, or in the case of two related variables, unusually far off the general pattern. A single outlier can pull an average, inflate a standard deviation, or distort a correlation, so it's worth spotting before you trust your results.

## When to use it

Check for outliers before running almost any test, especially ones based on means and standard deviations, like a *t*-test or Pearson correlation, since those are the most sensitive to extreme values. It matters most with small samples, where one unusual score has an outsized effect on the whole result.

## An everyday analogy

Imagine 7 coworkers compare their commute times, and 6 of them take 15 to 20 minutes while one drives in from two towns over and takes 90 minutes. Averaging all 7 commute times gives a "typical" commute that doesn't represent anyone well. Spotting that one outlier, and deciding how to handle it, matters before you claim to know the "average commute."

## A worked example

A teacher records posttest reading-confidence scale totals for 8 students: 14, 15, 15, 16, 16, 17, 18, 45. Seven of the scores cluster between 14 and 18, but one student's score of 45 sits far outside that range (the scale's realistic maximum is 25, so this also looks like a data-entry error worth double-checking).

Using the {{interquartile_range}} rule: the first quartile (*Q*1) is 15 and the third quartile (*Q*3) is 17.5, so the IQR is 17.5 - 15 = 2.5. The upper fence is *Q*3 + 1.5 x IQR = 17.5 + 3.75 = 21.25. Since 45 is well above 21.25, it's flagged as an outlier.

## How to read the output

Statly flags points using the IQR rule, {{z_score}}s, and, for two or more variables at once, {{mahalanobis_distance}}. In this example, the IQR rule clearly flags the score of 45. Notice that the z-score method is less reliable here: the outlier itself inflates the standard deviation, pulling the z-score down toward the flagging threshold. That's a common trap, an extreme value can partly hide itself by distorting the very statistic used to detect it. The IQR rule, based on quartiles, resists this problem better.

## What Statly checks

Statly checks single variables with the IQR rule (flagging points beyond 1.5 times the IQR past *Q*1 or *Q*3) and z-scores (flagging points more than about 2 to 3 standard deviations from the mean). For analyses involving multiple variables at once, like multiple regression, it checks Mahalanobis distance, which flags points that are unusual across the combination of variables, even if no single variable looks extreme on its own.

## What to do if it fails

First, check whether the outlier is a data-entry mistake or an impossible value, like the score of 45 here on a scale that tops out at 25, and fix or remove it if so. If it's a real, valid value, consider running your analysis both with and without it to see how much it changes your results. Switching to a {{nonparametric}} test (which works on ranks and is much less sensitive to extreme values) is another solid option, as is using a trimmed or winsorized mean instead of the regular mean. Whatever you choose, report what you did and why.

## Common mistakes

Don't automatically delete every outlier you find, some are real, meaningful data points, and removing them without a good reason can bias your results. Also don't rely on z-scores alone in small samples, as this example shows, a single extreme value can inflate the standard deviation enough to mask itself.
