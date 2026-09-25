---
id: spearman
title: "Spearman correlation"
category: tests
summary: "Measures how strongly two variables move together using ranks, so it still works when the pattern isn't a straight line."
related: [pearson, kendall_tau_b, mann_whitney, outliers, wilcoxon_signed_rank]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Spearman correlation measures how closely two variables move together, but instead of using the raw numbers, it first converts each variable to {{rank}}s and correlates those. This makes it a {{nonparametric}} test. The result, called *rho* (or *r*_s), also ranges from -1 to 1, and it picks up on any {{monotonic_relationship}}, meaning the pattern is steadily rising or steadily falling, even if it isn't a perfectly straight line.

## When to use it

Use Spearman correlation when your data are {{ordinal}} (like rankings or rating scales), or when your continuous data have a curved or lopsided pattern that would trip up Pearson correlation. It's also a safer choice when you have outliers, since ranking pulls extreme values back toward the pack.

## An everyday analogy

Imagine ranking runners by finish order instead of timing them to the second. You lose some detail, but you can still tell if the person who trains more tends to finish higher, even if the exact time gaps are uneven or messy.

## A worked example

A researcher looks at 8 students in Intervention A, comparing hours studied to their quiz score.

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

Rank each column from lowest to highest, giving tied values the average of the ranks they'd share:

| Student | Hours rank | Score rank |
|---|---|---|
| 1 | 1 | 1 |
| 2 | 2.5 | 3 |
| 3 | 2.5 | 2 |
| 4 | 4 | 5 |
| 5 | 5 | 4 |
| 6 | 6 | 7 |
| 7 | 7 | 6 |
| 8 | 8 | 8 |

The two rank columns line up closely, students who rank high on hours studied almost always rank high on quiz score too. Correlating the ranks gives *rho* = .95, with *p* < .001.

## How to read the output

Statly reports *rho* and a {{p_value}}. Read *rho* the same way you'd read Pearson's *r*, values near 1 or -1 mean a strong relationship, values near 0 mean a weak one. Because Spearman works on ranks, it won't tell you the size of a change in real units, only whether the order holds up.

## How to report it (APA 7)

Template: `There was a {strength} {positive/negative} correlation between {variable1} and {variable2}, *r*_s({df}) = {rho}, *p* = {p}.`

Filled example: There was a strong positive correlation between hours studied and quiz score, *r*_s(6) = .95, *p* < .001.

## Common mistakes

Don't use Spearman when you actually care about the exact size of a linear relationship, ranking throws that detail away. Also don't confuse Spearman with Kendall's tau-b. They both work on ranks and often agree in direction, but they aren't computed the same way and their numbers aren't interchangeable in a write-up.
