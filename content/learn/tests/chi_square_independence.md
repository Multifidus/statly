---
id: chi_square_independence
title: "Chi-square test of independence"
category: tests
summary: "Checks whether two categorical variables are related, using a table of counts."
related: [fisher_exact, chi_square_gof, mcnemar, cramers_v_phi, independence]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

The chi-square test of independence checks whether two {{categorical_variable}}s are related to each other. You arrange your counts in a {{contingency_table}}, a grid showing how many cases fall into each combination of categories, and the test compares those {{observed_frequency}} counts to the counts you'd expect if the two variables had nothing to do with each other.

## When to use it

Use this test when you have two categorical variables, like group membership and pass/fail, and you want to know if knowing one tells you anything about the other. It works best when your expected counts in each cell of the table are reasonably large, usually at least 5. If your table is small or sparse, Fisher's exact test is the safer pick.

## An everyday analogy

Think about checking whether people who own cats are more or less likely to also own a dog. You'd count up every combination, cat and dog, cat and no dog, no cat and dog, no cat and no dog, then see if the pattern looks different from what random chance alone would produce.

## A worked example

A researcher checks whether pass/fail rate on a quiz differs by teaching method, across 30 students split evenly into three groups of 10.

| | Control | Intervention A | Intervention B | Row total |
|---|---|---|---|---|
| Pass | 4 | 6 | 8 | 18 |
| Fail | 6 | 4 | 2 | 12 |
| Column total | 10 | 10 | 10 | 30 |

If pass/fail had nothing to do with group, you'd expect each cell to follow the overall pass rate (18/30 = 60% pass, 12/30 = 40% fail) applied evenly across the 10 students in each group:

| | Control | Intervention A | Intervention B |
|---|---|---|---|
| Pass (expected) | 6 | 6 | 6 |
| Fail (expected) | 4 | 4 | 4 |

Adding up (observed - expected)² / expected for all six cells gives the {{chi_square_statistic}}: 0.67 + 0 + 0.67 + 1 + 0 + 1 = 3.33. With {{degrees_of_freedom}} = (rows - 1) x (columns - 1) = 2, this gives *p* = .189.

## How to read the output

Statly reports *chi*²(df, *N*), a {{p_value}}, and the observed versus expected counts. A large chi-square value relative to its degrees of freedom, paired with a small *p*-value, means the categories line up differently than chance alone would predict. Here, *p* = .189 is above the usual .05 cutoff, so this small example doesn't provide strong evidence that pass rate differs by group.

## How to report it (APA 7)

Template: `There was {a/no} significant relationship between {variable1} and {variable2}, *chi*²({df}, *N* = {n}) = {chi2}, *p* = {p}.`

Filled example: There was no significant relationship between teaching method and pass/fail rate, *chi*²(2, *N* = 30) = 3.33, *p* = .189.

## Common mistakes

Don't run a chi-square test of independence with small expected counts in any cell, the approximation gets unreliable and Fisher's exact test is the better choice. Also don't mistake "significant" for "large." A big sample can make even a tiny, practically meaningless relationship come out statistically significant, so pair this test with an effect size like Cramer's V.
