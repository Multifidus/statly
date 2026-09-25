---
id: cramers_v_phi
title: "Cramer's V and phi"
category: effect_sizes
summary: "Measure the strength of association between two categorical variables in a contingency table, phi for 2x2 tables and Cramer's V for larger ones."
related: [chi_square_independence, fisher_exact, odds_ratio, descriptives, chi_square_gof]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Phi and Cramer's V both measure how strongly two {{categorical_variable}}s are related in a {{contingency_table}}, based on a chi-square test of independence. Phi only works for a 2x2 table, two groups by two categories. Cramer's V is the more general version, and works for larger tables too.

## When to use it

Use phi when you have a 2x2 table, like two groups by pass and fail. Use Cramer's V for any bigger table, like three groups by pass and fail. Report either one alongside a chi-square test of independence to show not just whether the variables are related, but how strongly.

## An everyday analogy

Imagine sorting students by which teaching method they got and whether they passed a test. If passing rates look about the same no matter the method, phi or Cramer's V will be close to 0. If one method clearly produces far more passes than the others, the value climbs toward 1.

## A worked example

Pass and fail counts for three teaching methods, five students each (Scenario B):

| Group | Pass | Fail |
|---|---|---|
| Control | 2 | 3 |
| Intervention A | 4 | 1 |
| Intervention B | 3 | 2 |

Expected count in every cell works out to 3 for Pass and 2 for Fail, since group sizes and totals split evenly. Summing (observed - expected)² / expected across all six cells gives chi-square = 1.67, with *df* = 2.

Cramer's V = sqrt[chi-square / (*N* x min(rows-1, cols-1))] = sqrt[1.67 / (15 x 1)] = sqrt(.11) = .33

Now look at just Control and Intervention A as a 2x2 table:

| Group | Pass | Fail |
|---|---|---|
| Control | 2 | 3 |
| Intervention A | 4 | 1 |

For this 2x2 table, chi-square = 1.67 with *df* = 1 and *N* = 10.

phi = sqrt(chi-square / *N*) = sqrt(1.67 / 10) = sqrt(.17) = .41

## How to read the output

Statly reports phi automatically for 2x2 tables and Cramer's V for anything larger, alongside the chi-square {{test_statistic}} and *p*-value. Both range from 0, no association, to 1, a perfect association. Read them like a correlation strength, not a percentage of variance.

## How to report it (APA 7)

Template: `There was a significant association between {variable1} and {variable2}, chi-square({df}, *N* = {n}) = {chi2}, *p* = {p}, *V* = {v}.`

Filled example: There was a non-significant association between teaching method and pass and fail outcome, chi-square(2, *N* = 15) = 1.67, *p* = .434, *V* = .33.

## Benchmarks (and why to be careful)

Rough guides for a table like the 3-group example call *V* around .07 small, .21 medium, and .35 large, and these cutoffs shift with table size. They weren't built from education data specifically. A modest-looking association between teaching method and pass and fail can still matter in a classroom. Compare your *V* or phi to similar studies in the same subject area rather than leaning on a single generic chart.

## Common mistakes

Don't use phi on a table bigger than 2x2, it isn't built for that, Cramer's V is the correct choice instead. Also don't treat a small *V* or phi as proof there's no real relationship. Small samples, like the fifteen-student example above, can easily produce a weak-looking association even when a real pattern exists, so check the *p*-value and consider replicating with more data.
