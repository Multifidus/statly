---
id: reliability.kendall_w
title: "Kendall's coefficient of concordance (W) for rater agreement"
category: tests
summary: "Measures how much several raters agree in the way they rank the same set of items."
related: [reliability.fleiss_kappa, kendalls_w]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Kendall's *W*, also called the coefficient of concordance, measures how much several raters agree when they {{rank}} the same set of items from best to worst, rather than rating them on a scale or sorting them into categories. It ranges from 0, meaning the raters' rankings look unrelated, to 1, meaning every rater produced the exact same ranking.

## When to use it

Use this version of Kendall's *W* when several raters each rank the same set of items, projects, or people in order, like three teachers each ranking 8 student projects from best to worst for a school showcase. This page covers *W* as its own reliability check for ranking data. It's different from the Kendall's *W* effect size reported alongside the Friedman test: that version measures agreement across repeated conditions within one group of subjects, while this reliability version measures agreement between separate raters or judges producing independent rankings of the same items.

## An everyday analogy

Picture three coaches each ranking 6 players from strongest to weakest after tryouts, without talking to each other first. If all three coaches put roughly the same players near the top and the same players near the bottom, their rankings show strong concordance. If their rankings look scattered and unrelated to each other, concordance is low, and you'd want more coaches or a clearer rubric before trusting any one ranking.

## A worked example

In Scenario A, 3 raters each rank 5 student projects from 1 (best) to 5 (worst).

| Project | Rater 1 | Rater 2 | Rater 3 | Sum of ranks |
|---|---|---|---|---|
| A | 1 | 2 | 1 | 4 |
| B | 2 | 1 | 3 | 6 |
| C | 3 | 3 | 2 | 8 |
| D | 4 | 5 | 4 | 13 |
| E | 5 | 4 | 5 | 14 |

The rank sums spread out clearly from 4 up to 14, showing the raters mostly agree on the order, with only small swaps like Project A and B near the top. Statly compares the variance of these rank sums to the maximum possible variance if all raters had agreed perfectly, giving Kendall's *W* = .90 for this example.

## How to read the output

Statly reports *W* between 0 and 1, along with a {{chi_square_statistic}} and {{p_value}} testing whether the agreement is stronger than you'd expect by chance. Values near 1 mean strong agreement among raters, values near 0 mean the rankings look essentially unrelated. As a rough guide, *W* above .70 suggests strong concordance. Here, *W* = .90 with a significant *p*-value tells you the three raters' rankings agree closely and this agreement is unlikely to be a fluke.

## How to report it (APA 7)

Template: `Agreement among raters' rankings was strong, *W* = {value}, {chi_square}({df}) = {value}, *p* = {p}.`

Filled example: Agreement among raters' rankings was strong, *W* = .90, &chi;²(4) = 10.80, *p* = .029.

## Common mistakes

Don't confuse this reliability use of Kendall's *W* with the effect size reported after a Friedman test, they answer different questions even though the formula is related. Also don't use *W* on ratings or scores, it's built for ranks, so convert scale ratings to ranks first if that's what you have. And remember *W* with only a few raters and items, like this 3-rater, 5-project example, can shift a lot with a bigger panel.
