---
id: descriptives
title: "Descriptive statistics"
category: tests
summary: "The summary numbers, like mean, median, and spread, that describe your data before you run any test on it."
related: [normality, outliers, t_one_sample, mann_whitney, kruskal_wallis, friedman]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Descriptive statistics summarize a set of scores in a few plain numbers: how many there are, where the middle sits, and how spread out they are. Unlike the other pages in this library, descriptives don't test a hypothesis or produce a {{p_value}}. They're the foundation everything else is built on. Before you run a t-test, a Mann-Whitney test, or anything else, you look at the descriptives first to understand what you're working with.

## When to use it

Always. Run descriptives before any other analysis, every time. They help you spot problems early: a {{sample_size}} too small to trust, an {{outlier}} dragging your mean around, or a {{skewness}} value warning you that a test assuming a {{normal_distribution}} might not fit.

## An everyday analogy

Before you judge a class's test performance, you'd want the basics: how many students took it, what the typical score was, and whether scores were tightly bunched or all over the place. That's exactly what descriptives give you, a quick snapshot before you dig deeper.

## A worked example

Eight students in the Control group (Scenario B) take a 10-point quiz:

**Scores:** 5, 6, 6, 7, 7, 7, 8, 9

| Statistic | Value | How it's found |
|---|---|---|
| *n* | 8 | count of scores |
| Sum | 55 | 5+6+6+7+7+7+8+9 |
| {{mean}} | 6.88 | 55 / 8 |
| {{median}} | 7.00 | average of the 4th and 5th sorted scores (7, 7) |
| Q1 | 6.00 | median of the lower half (5, 6, 6, 7) |
| Q3 | 7.50 | median of the upper half (7, 7, 8, 9) |
| {{interquartile_range}} | 1.50 | Q3 - Q1 = 7.50 - 6.00 |
| Min / Max | 5 / 9 | smallest and largest score |
| {{standard_deviation}} | 1.25 | see below |
| {{standard_error}} | 0.44 | *SD* / sqrt(*n*) = 1.25 / 2.83 |

To find the standard deviation by hand: subtract the mean (6.875) from each score, square each difference, add them up, divide by *n* - 1, then take the square root.

Sum of squared differences = 10.875. Divide by *n* - 1 = 7: 10.875 / 7 = 1.554. Square root: *SD* = 1.25.

Statly also reports {{skewness}} (here, about 0.24, close to zero, so the scores are roughly symmetric) and {{kurtosis}} (about -0.60, meaning the distribution is a bit flatter than a normal curve, with fewer extreme scores than expected).

You can also break scores into categories. If a score of 7 or higher counts as "passing":

| Category | Count | Percent |
|---|---|---|
| Passing (>= 7) | 5 | 62.5% |
| Not passing (< 7) | 3 | 37.5% |

## How to read the output

Look at mean and median together. When they're close, your data are roughly symmetric. When they're far apart, that's a sign of skew or an outlier pulling the mean away from the typical score. A large standard deviation relative to the mean means scores are spread out, a small one means they're clustered tightly. Use the standard error when you want to know how precisely your sample mean estimates the true population mean, it shrinks as your sample size grows.

## How to report it (APA 7)

Descriptives usually go in a table, or as a short sentence when you're introducing a variable. Template: `{Variable} scores ranged from {min} to {max} (*Mdn* = {median}, *M* = {mean}, *SD* = {sd}, *n* = {n}).`

Filled example: Quiz scores ranged from 5 to 9 (*Mdn* = 7.00, *M* = 6.88, *SD* = 1.25, *n* = 8).

For a full table, list each variable with its *n*, *M*, *SD*, median, min, and max in columns, one row per variable.

## Common mistakes

Don't report only the mean and skip the spread, two groups can have the same mean but look completely different once you see the standard deviation. Also, don't treat the mean as automatically the best summary number. When scores are skewed or have outliers, the median often describes the "typical" score more fairly.
