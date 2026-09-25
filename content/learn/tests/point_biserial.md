---
id: point_biserial
title: "Point-biserial correlation"
category: tests
summary: "Measures how strongly a continuous outcome relates to a variable with only two categories."
related: [t_independent, pearson, cohens_d, r_effect]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Point-biserial correlation measures the relationship between a continuous variable and a {{dichotomous_variable}}, meaning a variable with only two possible values, like pass/fail or group A/group B. Under the hood it's just Pearson's *r* computed on data where one variable happens to be two-valued, so the result, *r*_pb, still ranges from -1 to 1 and means the same thing: how strongly the two variables move together.

## When to use it

Use point-biserial correlation when you want to know whether a two-category grouping variable relates to a continuous score, such as whether belonging to one group versus another lines up with higher or lower outcomes. It gives the same information as an independent-samples t-test, just expressed as a correlation instead of a mean difference.

## An everyday analogy

Imagine sorting runners into "wore new shoes" and "wore old shoes," then looking at whether that simple yes/no split lines up with faster or slower race times. Point-biserial correlation puts a number on how well that two-way split tracks with the continuous times.

## A worked example

A researcher splits 8 students from the linked pre/post gain-score study into an earlier cohort (0) and a later cohort (1), and looks at their gain scores (posttest minus pretest).

| Student | Cohort | Gain score |
|---|---|---|
| 1 | 0 | 4 |
| 2 | 0 | 6 |
| 3 | 0 | 5 |
| 4 | 0 | 7 |
| 5 | 1 | 10 |
| 6 | 1 | 12 |
| 7 | 1 | 9 |
| 8 | 1 | 14 |

The later cohort's gain scores (9 to 14) sit clearly above the earlier cohort's (4 to 7). Correlating cohort against gain score gives *r*_pb = .88, with {{degrees_of_freedom}} = 6, *t*(6) = 4.49, *p* = .004.

## How to read the output

Statly reports *r*_pb and a {{p_value}}, the same way it reports Pearson's *r*. A positive value means the group coded 1 tends to score higher, a negative value means the group coded 0 tends to score higher. The sign depends entirely on which group you coded as 0 and which as 1, so always check your coding before interpreting the direction.

## How to report it (APA 7)

Template: `There was a {strength} {positive/negative} correlation between {group variable} and {outcome}, *r*_pb({df}) = {r}, *p* = {p}.`

Filled example: There was a strong positive correlation between cohort and gain score, *r*_pb(6) = .88, *p* = .004.

## Common mistakes

Don't forget that point-biserial correlation assumes your two-category variable is a true either/or grouping, not a continuous variable you chopped into two pieces. Splitting a continuous variable at the median just to force a point-biserial correlation throws away real information and can make the relationship look weaker or stronger than it is. Also remember the sign only tells you direction, not which group is "better," that depends on what the coding means.
