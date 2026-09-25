---
id: manova
title: "MANOVA (Multivariate Analysis of Variance)"
category: tests
summary: "Tests group differences across two or more outcome variables at once, instead of running a separate test for each one."
related: [anova.one_way, mancova, box_m, multivariate_normality]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

MANOVA tests whether groups differ across several {{dependent_variable}}s considered together, instead of testing each outcome separately. It looks at the whole pattern of outcomes at once, which can catch group differences that no single outcome shows clearly on its own, and it also protects you from running too many separate tests.

## When to use it

Use MANOVA when you have three or more groups and two or more related continuous outcomes measured on the same people, like a reading score and a writing score from the same students. If your outcomes are unrelated to each other, or you only care about one outcome at a time, separate one-way ANOVAs are simpler and easier to interpret.

## An everyday analogy

Picture judging three training programs using both a fitness test and a flexibility test. Looking at fitness alone might show no difference, and flexibility alone might show no difference either, but together, the combined pattern, better fitness paired with slightly lower flexibility in one program, tells a clearer story. MANOVA looks at both measures together instead of one at a time.

## A worked example

A researcher compares two outcomes, a knowledge-test score and a confidence-survey score, across Control, Intervention A, and Intervention B, with about 5 students per group (Scenario B).

| Group | Knowledge (M) | Confidence (M) |
|---|---|---|
| Control | 5.0 | 12.0 |
| Intervention A | 7.5 | 14.5 |
| Intervention B | 6.0 | 17.0 |

Intervention A pulls ahead on knowledge, while Intervention B pulls ahead on confidence. Neither outcome alone tells the full story of how the groups differ. Statly computes this for you. Here's how to read what it gives you: it fits the multivariate model and reports a combined test statistic.

| Test | Value | *F* | df | *p* |
|---|---|---|---|---|
| {{pillais_trace}} | 0.61 | 3.22 | 4, 24 | .028 |

## How to read the output

Statly reports Pillai's trace by default, since it holds up well even when assumptions are slightly violated, along with an *F* value, degrees of freedom, and a *p*-value. A significant result means the groups differ across the combined set of outcomes. From there, Statly typically shows univariate follow-up tests, one ANOVA per outcome, so you can see which specific outcome or outcomes are driving the overall difference.

## How to report it (APA 7)

Template: `A one-way MANOVA showed a significant effect of {group variable} on the combined outcomes, Pillai's trace = {value}, *F*({df1}, {df2}) = {F}, *p* = {p}.`

Filled example: A one-way MANOVA showed a significant effect of group on the combined outcomes, Pillai's trace = 0.61, *F*(4, 24) = 3.22, *p* = .028.

## Common mistakes

Don't run a MANOVA just to avoid running multiple ANOVAs when your outcomes aren't actually related to each other, that defeats the purpose and makes the result harder to interpret. Also don't skip the univariate follow-ups, a significant MANOVA tells you the groups differ somewhere in the combined outcomes, but not which specific outcome is responsible.
