---
id: wilcoxon_one_sample
title: "Wilcoxon one-sample test"
category: tests
summary: "Tests whether a sample's median differs from a fixed value, without assuming the data are normally distributed."
related: [t_test.one_sample, wilcoxon_signed_rank, sign_test]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

The Wilcoxon one-sample test is a {{nonparametric}} way to check whether a single sample's typical value differs from some fixed {{benchmark_comparison}} number, like zero. It's the nonparametric alternative to the one-sample *t*-test, used when your data don't look roughly normal, especially with a small sample. Instead of using the raw values directly, it ranks how far each score sits from the benchmark and how consistently scores fall above or below it.

## When to use it

Use this test when you have one group of {{paired}} or single-sample values, often a gain or difference score, and want to compare it against a fixed benchmark, such as testing whether students' gain scores are greater than zero. Choose it over the one-sample *t*-test when your data are skewed, have outliers, or otherwise fail the {{normality}} check, especially with a small sample where the *t*-test's normality assumption matters more.

## An everyday analogy

Picture a coach checking whether a team's sprint times improved this season compared to a fixed target time, but a couple of runners had wildly unusual days that would throw off a plain average. Instead of comparing raw averages, the coach ranks how far each runner's time sits from the target and looks at whether most runners tend to land above or below it. That ranking approach isn't thrown off by one or two extreme times the way an average would be.

## A worked example

In Scenario D, 7 students have gain scores (posttest minus pretest) on a 0-100 outcome, and the researcher wants to know if gains are greater than a benchmark of 0.

| Student | Gain score |
|---|---|
| 1 | 8 |
| 2 | 3 |
| 3 | -2 |
| 4 | 12 |
| 5 | 6 |
| 6 | 15 |
| 7 | 4 |

Statly ranks the gain scores by their distance from 0, ignoring sign, then sums the ranks separately for positive and negative gains. Here, 6 of 7 students improved, and the one decline (-2) was the smallest gain in absolute size, so it gets the lowest rank. The sum of positive ranks is much larger than the sum of negative ranks, giving a test statistic *W* = 26, *p* = .031.

## How to read the output

Statly reports the *W* statistic and a {{p_value}}. A small *p*-value means the sample's values are consistently on one side of the benchmark more than chance alone would produce. Here, *p* = .031 is below the usual .05 cutoff, so students' gains are significantly greater than the benchmark of 0. Statly typically reports the median gain alongside the test, since the Wilcoxon one-sample test is built around ranks rather than the mean.

## How to report it (APA 7)

Template: `The median {measure} was significantly {higher/lower} than {benchmark}, *W* = {value}, *p* = {p}.`

Filled example: The median gain score was significantly higher than 0, *W* = 26, *p* = .031.

## Common mistakes

Don't use this test when your gain or difference scores look roughly normal and your sample is reasonably large, the one-sample *t*-test will usually give you more statistical power in that case. Also don't confuse this test with the Wilcoxon signed-rank test used to compare two related sets of scores, this version compares one sample against a fixed outside value, not against a second variable. And remember ties, values exactly equal to the benchmark, get dropped or handled specially, so report how many cases were excluded for that reason.
