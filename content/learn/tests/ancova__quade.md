---
id: ancova.quade
title: "Quade's Test (Rank ANCOVA)"
category: tests
summary: "A rank-based alternative to ANCOVA for when the usual ANCOVA assumptions don't hold."
related: [ancova, kruskal_wallis, mann_whitney]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Quade's test is a {{nonparametric}} version of ANCOVA. It compares group means while adjusting for a covariate, just like regular ANCOVA. But it works on {{rank}}-transformed scores instead of raw scores. This makes it safer when your data are skewed, have outliers, or fail ANCOVA's other rules.

## When to use it

Use Quade's test when you want to control for a covariate like a pretest, but your data clearly fail ANCOVA's assumptions, such as normality or equal regression slopes. Think of it as a solid backup plan, not a first choice. Ranking the data throws away some information about how far apart scores really are.

## An everyday analogy

Picture judging a baking contest where you care about improvement, not just final taste. Comparing exact scores is risky, since one judge scores harshly and another scores generously. Instead, you rank the entries from worst to best. Quade's test compares those adjusted ranks across groups instead of comparing raw numbers.

## A worked example

A researcher compares posttest scores across Control, Intervention A, and Intervention B, adjusting for pretest score, but the posttest data are strongly skewed with a couple of extreme scores (Scenario B).

| Group | Pretest | Posttest |
|---|---|---|
| Control | 4, 5, 5 | 5, 5, 6 |
| Intervention A | 4, 4, 5 | 8, 20, 9 |
| Intervention B | 5, 4, 6 | 6, 7, 7 |

That one score of 20 would badly throw off a regular ANCOVA. Quade's test first ranks the pretest scores and the posttest scores on their own. It then works with the leftover part of each rank after removing the covariate's effect. Statly runs this ranking and adjustment for you and reports a test statistic and *p*-value.

## How to read the output

Statly reports an {{f_statistic}} based on the ranked, adjusted scores, with degrees of freedom and a {{p_value}}. Read it the same way as a regular ANCOVA result. A significant *p*-value means the groups differ even after you account for the covariate. Because the test works on ranks, not raw scores, it is less thrown off by that one extreme value of 20.

## How to report it (APA 7)

Template: `A Quade's test showed a significant effect of {group variable} on {outcome} after adjusting for {covariate}, *F*({df1}, {df2}) = {F}, *p* = {p}.`

Filled example: A Quade's test showed a significant effect of group on posttest score after adjusting for pretest score, *F*(2, 5) = 5.10, *p* = .046.

## Common mistakes

Don't pick Quade's test just because it sounds safer. If your data meet regular ANCOVA's assumptions, ANCOVA has more power to find real effects. Also remember that ranking loses information about exact distances between scores. Effect sizes from Quade's test are not directly comparable to effect sizes from ordinary ANCOVA.
