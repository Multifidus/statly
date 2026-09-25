---
id: correlation.matrix
title: "Correlation matrix"
category: tests
summary: "Shows every pairwise correlation among several variables at once, with an option to correct for multiple comparisons."
related: [correlation.pearson, correlation.spearman, multiple_comparisons]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

A {{correlation_matrix}} is a table of correlations. It shows every possible pair of variables in a dataset at once. You don't have to run each correlation one at a time. If you have 4 variables, a full matrix shows all 6 unique pairwise correlations in one grid. This makes it easy to scan for the strongest and weakest relationships.

## When to use it

Use a correlation matrix when you have several {{continuous}} or ordinal variables. You want to see how they all relate to each other, not just one pair. This is common with several quiz items or subscale scores. You may want to check them for overlap before combining them into one total. A matrix runs many correlations at once. So turn on a {{multiple_comparisons}} correction. This helps you avoid mistaking chance patterns for real relationships.

## An everyday analogy

Imagine checking every pair of ingredients in a recipe box at once: flour and sugar, sugar and butter, flour and butter, and so on. That beats comparing two ingredients at a time. Laying every pairwise relationship out in one grid lets you spot which ingredients tend to show up together. You see it all in a single glance, instead of piecing it together from dozens of separate comparisons.

## A worked example

In Scenario B, a researcher has three quiz item scores (0-10 scale) for 8 students and wants to see how the items relate to each other.

| Student | Item A | Item B | Item C |
|---|---|---|---|
| 1 | 6 | 7 | 5 |
| 2 | 7 | 8 | 6 |
| 3 | 5 | 5 | 6 |
| 4 | 8 | 9 | 4 |
| 5 | 4 | 5 | 7 |
| 6 | 9 | 8 | 3 |
| 7 | 6 | 6 | 5 |
| 8 | 7 | 8 | 4 |

Statly computes all 3 pairwise correlations: Item A with Item B, Item A with Item C, and Item B with Item C. Item A and Item B move together closely (*r* = .87). Item C tends to move the opposite way from both (*r* = -.72 with Item A, *r* = -.66 with Item B). Statly ran 3 comparisons at once. So it applies a correction, such as Holm or Benjamini-Hochberg, before flagging any pair as statistically significant.

## How to read the output

Statly shows the matrix as a grid, often shaded by strength and direction. Each cell shows *r* and an adjusted {{p_value}}. Read down a row or across a column to see how one variable relates to everything else. Values near 1 or -1 mean a strong relationship. Values near 0 mean little to no linear relationship. Here, Item C's negative correlations with Items A and B stand out. This might mean it's worded in the opposite direction, or measuring something different. It's worth a closer look.

## How to report it (APA 7)

Template: `{Variable1} was {positively/negatively} correlated with {variable2}, *r*({df}) = {value}, *p* = {p} ({correction method}-corrected).`

Filled example: Item A was negatively correlated with Item C, *r*(6) = -.72, *p* = .043 (Holm-corrected).

## Common mistakes

Don't scan a correlation matrix for the biggest number and treat it as your main finding. Correct for the number of comparisons you ran first, since some pairs will look strong by chance alone. Also don't assume every pair used the same kind of correlation. Mixing continuous and ordinal variables sometimes calls for Spearman instead of Pearson for those specific pairs. And remember: correlation, even across a whole matrix, only shows that a relationship exists. It doesn't show which variable is driving which.
