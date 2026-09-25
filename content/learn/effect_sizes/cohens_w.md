---
id: cohens_w
title: "Cohen's w"
category: effect_sizes
summary: "Measures the size of the relationship or difference detected by a chi-square test."
related: [chi_square.independence, chi_square.goodness_of_fit, cramers_v_phi]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Cohen's w measures how big a relationship or difference a {{chi_square_statistic}} test detected, not just whether it is real. It works for both a chi-square test of independence, which checks whether two categorical variables relate to each other, and a chi-square goodness-of-fit test, which checks whether observed counts match an expected pattern. A larger Cohen's w means a stronger relationship or a bigger mismatch from what was expected.

## When to use it

Use Cohen's w alongside any chi-square test to report the size of the effect, not just its {{p_value}}. It works for tables of any size, including simple 2x2 tables and larger ones. For a 2x2 table specifically, Cohen's w gives the same value as phi.

## An everyday analogy

Picture asking whether students' favorite subject (Math, Reading, Science) differs by classroom (Room A, Room B). A chi-square test tells you whether the pattern of preferences across classrooms is unlikely to be chance. Cohen's w tells you how strongly classroom and subject preference are linked, from barely related to strongly related.

## A worked example

A researcher records which of two study strategies 8 students preferred, split by group (Control vs. Intervention A).

| | Preferred Strategy 1 | Preferred Strategy 2 |
|---|---|---|
| Control | 3 | 1 |
| Intervention A | 1 | 3 |

A chi-square test of independence on this table gives *&chi;²*(1) = 2.00. With a total sample size of 8, Cohen's w = square root of (chi-square divided by *N*) = square root of (2.00 / 8) = 0.50.

## How to read the output

Statly reports Cohen's w alongside the chi-square statistic and its *p*-value. Here, w = 0.50 suggests a fairly strong relationship between group and strategy preference in this small sample, even though the *p*-value from such a tiny sample might not fall below {{alpha}}. Always look at both numbers together: the *p*-value tells you whether the pattern is likely real, and w tells you how big that pattern is.

## How to report it (APA 7)

Template: `There was {a/no} significant association between {variable1} and {variable2}, *&chi;²*({df}) = {chi2}, *p* = {p}, *w* = {w}.`

Filled example: There was no significant association between group and strategy preference, *&chi;²*(1) = 2.00, *p* = .157, *w* = 0.50.

## Benchmarks (and why to be careful)

Cohen's rough guide calls *w* = 0.10 small, 0.30 medium, and 0.50 large. These benchmarks came from general behavioral research, not classrooms specifically. Relationships between categorical variables in education studies, like program type and pass rate, often land on the smaller end of this scale even when they matter practically. Compare your *w* to similar studies in your specific area before deciding whether it counts as meaningful.

## Common mistakes

Don't report Cohen's w without also reporting the chi-square test it came from. A reader needs both the significance test and the effect size to fully judge the result. Also don't use Cohen's w interchangeably with Cramer's V without checking your table size. They match exactly for a 2x2 table, but for larger tables, Cramer's V adjusts for the table's dimensions in a way plain Cohen's w does not.
