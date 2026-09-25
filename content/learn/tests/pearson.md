---
id: pearson
title: "Pearson correlation"
category: tests
summary: "Measures how strongly two continuous variables move together in a straight-line pattern."
related: [spearman, kendall_tau_b, point_biserial, linearity, outliers, r_effect]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Pearson correlation measures how closely two {{continuous}} variables track each other in a straight line. The result is a number called *r*, which ranges from -1 to 1. A positive *r* means that as one variable goes up, the other tends to go up too. A negative *r* means one goes up while the other goes down. An *r* near 0 means there's little to no straight-line relationship.

## When to use it

Use Pearson correlation when you have two continuous variables measured on the same people or units, and you want to know whether they rise and fall together. It only picks up on {{linear_relationship}}s, so check a scatterplot first. If the pattern curves or bends, Pearson can miss it or understate it, and Spearman or Kendall's tau-b are better choices.

## An everyday analogy

Think about height and shoe size. Taller people tend to have bigger feet, on average. Pearson correlation is a way to put a number on how tightly that pattern holds, from "barely related" to "walk in lockstep."

## A worked example

A researcher tracks 8 students' pretest and posttest scores (0-100 scale) from the linked pre/post gain-score study.

| Student | Pretest | Posttest |
|---|---|---|
| 1 | 50 | 58 |
| 2 | 55 | 60 |
| 3 | 60 | 65 |
| 4 | 65 | 70 |
| 5 | 70 | 74 |
| 6 | 75 | 80 |
| 7 | 80 | 88 |
| 8 | 85 | 90 |

Both columns climb together in a steady, roughly straight-line pattern: as pretest scores rise, posttest scores rise right along with them. Running the numbers gives *r* = .99, a very strong positive correlation. With *n* = 8, the {{degrees_of_freedom}} are 8 - 2 = 6, and *t*(6) = 19.77, *p* < .001.

## How to read the output

Statly reports *r*, its {{p_value}}, and often *r*² (r-squared), which tells you the percentage of variance in one variable that lines up with the other. Here, *r*² = .98, meaning pretest scores explain about 98% of the spread in posttest scores for this small group. A small *p*-value tells you the correlation is unlikely to be random noise, but it says nothing about how strong the relationship is. Always look at *r* itself, and at the scatterplot, before trusting the number.

## How to report it (APA 7)

Template: `There was a {strength} {positive/negative} correlation between {variable1} and {variable2}, *r*({df}) = {r}, *p* = {p}.`

Filled example: There was a strong positive correlation between pretest score and posttest score, *r*(6) = .99, *p* < .001.

## Common mistakes

Don't assume a strong correlation means one variable causes the other. Pearson correlation only tells you two variables move together, not why. Also don't run Pearson on data with a curved pattern or big outliers. A single extreme point can drag *r* way up or down and make the relationship look stronger or weaker than it really is.
