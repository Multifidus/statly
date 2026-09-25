---
id: ancova
title: "ANCOVA (Analysis of Covariance)"
category: tests
summary: "Compares group means on an outcome while statistically adjusting for a related pretest or background variable."
related: [t_test.independent, anova.one_way, homogeneity_of_regression_slopes, cohens_f, education.gain_score]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

ANCOVA compares group means on an outcome, but first it adjusts for a {{covariate}}, a related variable like a pretest score. This gives you a fairer comparison because it accounts for differences that existed before your groups even started. Instead of just asking "did the groups end up different," ANCOVA asks "did the groups end up different, once we account for where they started."

## When to use it

Use ANCOVA when you have three or more groups, a continuous outcome, and a pretest or other background measure that is related to that outcome. It works well when groups weren't perfectly matched at the start, since it statistically levels the playing field rather than throwing away the pretest information the way a simple gain score does.

## An everyday analogy

Picture a golf handicap. Two golfers finish a round with different scores, but one started the season as a beginner and one as a near-pro. A handicap adjusts each score based on skill level before comparing them. ANCOVA does the same thing with a pretest: it adjusts each group's outcome based on where that group started.

## A worked example

A researcher compares posttest knowledge-test scores (0-10 scale) across Control, Intervention A, and Intervention B, using each student's pretest score as the covariate (Scenario B).

| Group | Pretest (M) | Posttest (M) |
|---|---|---|
| Control | 4.5 | 5.0 |
| Intervention A | 4.0 | 7.5 |
| Intervention B | 4.8 | 6.5 |

Intervention A started slightly lower on the pretest but ended up highest on the posttest. A plain comparison of posttest means would understate how much Intervention A actually helped. ANCOVA fits a regression line between pretest and posttest, then reports each group's {{estimated_marginal_means}}, the posttest score each group would have if every group had started at the same average pretest level. Statly runs this adjustment for you, so you never need to compute the regression by hand.

## How to read the output

Statly reports an {{f_statistic}}, degrees of freedom, a *p*-value, and the estimated marginal means for each group after adjustment. A significant *p*-value means the groups still differ once you control for the pretest. Compare the adjusted means, not the raw posttest means, since the adjusted ones reflect a fairer comparison. Statly also reports an effect size such as Cohen's *f* or partial eta squared alongside the test.

## How to report it (APA 7)

Template: `After adjusting for {covariate}, there was a significant effect of {group variable} on {outcome}, *F*({df1}, {df2}) = {F}, *p* = {p}, partial eta squared = {value}.`

Filled example: After adjusting for pretest score, there was a significant effect of group on posttest knowledge score, *F*(2, 11) = 6.42, *p* = .014, partial eta squared = .54.

## Common mistakes

Don't use ANCOVA without checking that the covariate-outcome relationship is similar across groups, this is the homogeneity of regression slopes assumption, and it breaks the adjustment if it fails. Also don't confuse ANCOVA with a simple gain score approach (posttest minus pretest); ANCOVA usually gives a more precise, less biased comparison, especially when groups differ at pretest.
