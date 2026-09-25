---
id: fisher_exact
title: "Fisher's exact test"
category: tests
summary: "Checks whether two categorical variables in a small 2x2 table are related, without relying on a large-sample approximation."
related: [chi_square_independence, odds_ratio, mcnemar, cramers_v_phi]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Fisher's exact test checks whether two categorical variables are related in a 2x2 {{contingency_table}}, the same question the chi-square test of independence answers. The difference is how it gets there. Instead of approximating with the chi-square distribution, it calculates the exact probability of your table (or one even more lopsided) directly, which makes it trustworthy even when your counts are small.

## When to use it

Use Fisher's exact test instead of the chi-square test of independence when your table is 2x2 and at least one {{expected_frequency}} is small, usually under 5. The chi-square approximation gets shaky with small counts, but Fisher's exact test stays accurate no matter how few cases you have.

## An everyday analogy

Picture drawing marbles from two small jars to see if one jar has more red marbles than the other. With only a handful of marbles in each jar, you can't rely on a rule of thumb built for huge jars, so you work out the exact odds of the split you saw happening by chance.

## A worked example

A researcher compares pass/fail rates between Control and Intervention B, with only 18 students total in this small subsample.

| | Control | Intervention B | Row total |
|---|---|---|---|
| Pass | 2 | 7 | 9 |
| Fail | 6 | 3 | 9 |
| Column total | 8 | 10 | 18 |

With counts this small, an expected cell count (for example, Control-Pass would be expected around 4) falls below the usual guideline of 5, so Fisher's exact test is the safer choice over chi-square. Working out the exact probability of this table, and any more extreme split with the same row and column totals, gives *p* = .153.

## How to read the output

Statly reports a {{p_value}} directly, along with an odds ratio comparing the two groups. Here, the odds ratio is 0.14, meaning students in Control had lower odds of passing than students in Intervention B in this small sample. Since *p* = .153 is above .05, this sample doesn't give strong evidence of a real difference, though the small sample size limits how much weight to put on that.

## How to report it (APA 7)

Template: `A Fisher's exact test showed {a/no} significant relationship between {variable1} and {variable2}, *p* = {p}.`

Filled example: A Fisher's exact test showed no significant relationship between group and pass/fail rate, *p* = .153.

## Common mistakes

Don't report a chi-square statistic alongside Fisher's exact test, the test doesn't produce one, it works directly with probabilities instead. Also don't reach for Fisher's exact test out of habit on every 2x2 table. When your counts are comfortably large, the chi-square test of independence is simpler to explain and gives essentially the same answer.
