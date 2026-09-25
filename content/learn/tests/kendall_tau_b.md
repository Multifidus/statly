---
id: kendall_tau_b
title: "Kendall's tau-b"
category: tests
summary: "Measures how strongly two ranked variables agree, by counting matching and mismatched pairs instead of using ranks directly."
related: [spearman, pearson, mann_whitney, outliers]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Kendall's tau-b is another way to measure how closely two variables move together, using {{rank}}s like Spearman does. But instead of correlating the rank numbers themselves, it looks at every possible pair of data points and asks whether the pairs agree in order (both variables go up together) or disagree (one goes up while the other goes down). The result, *tau*_b, ranges from -1 to 1 and handles {{ties}} more carefully than Spearman does, which makes it a good pick for small samples or data with a lot of repeated values.

## When to use it

Use Kendall's tau-b when your data are {{ordinal}} and you have several tied scores, or when your sample is small enough that you want the most cautious, conservative estimate of the relationship. It tends to report a smaller number than Spearman for the same data, which isn't a mistake, it's just measuring agreement a different way.

## An everyday analogy

Picture two judges ranking the same 8 contestants. Instead of comparing their scorecards number by number, you check every possible pair of contestants and see how often the judges agree on who should rank higher. The more pairs they agree on, the stronger the match.

## A worked example

Using the same 8 students from Intervention A:

| Student | Hours studied | Quiz score |
|---|---|---|
| 1 | 2 | 10 |
| 2 | 3 | 12 |
| 3 | 3 | 11 |
| 4 | 4 | 14 |
| 5 | 5 | 13 |
| 6 | 6 | 16 |
| 7 | 7 | 15 |
| 8 | 8 | 18 |

Comparing every pair of students, most pairs agree: the student with more hours studied almost always has the higher quiz score too, with only a couple of small mismatches. Working through all 28 possible pairs gives *tau*_b = .84, *p* = .004.

## How to read the output

Statly reports *tau*_b and a {{p_value}}. Because tau-b counts agreeing and disagreeing pairs rather than correlating rank numbers directly, its values usually run smaller than Spearman's *rho* for the same data even when both point to the same relationship. Compare tau-b values only to other tau-b values, not to *rho* or Pearson's *r*.

## How to report it (APA 7)

Template: `There was a {strength} {positive/negative} association between {variable1} and {variable2}, *tau*_b = {tau}, *p* = {p}, *N* = {n}.`

Filled example: There was a strong positive association between hours studied and quiz score, *tau*_b = .84, *p* = .004, *N* = 8.

## Common mistakes

Don't compare a tau-b value straight to an *r* or *rho* value and assume they should match, they're built on different math and tau-b is typically the smaller number even for the same relationship. Also don't use tau-b as proof of cause and effect. Like any correlation, it only shows that two things tend to move together in the same or opposite direction.
