---
id: sign_test
title: "Sign test"
category: tests
summary: "Compares two related measurements using only the direction of each change, the simplest and least assumption-heavy paired test."
related: [wilcoxon_signed_rank, t_test.paired, mcnemar, rank_biserial, descriptives]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

The sign test checks whether {{paired}} measurements tend to move in one direction, using only the *sign* of each difference (did it go up or down), not how big the change was. It throws away more information than the Wilcoxon signed-rank test, but it makes almost no assumptions about your data, which makes it a useful fallback.

## When to use it

Use it when you have two related measurements per person, and you either can't trust the size of the differences (maybe your scale is too coarse to compare magnitudes fairly) or you just want the simplest possible test. It also works when Wilcoxon's assumption, that the differences are roughly symmetric, seems shaky.

## An everyday analogy

Imagine you don't have a scale to weigh how much each plant grew, you can only tell whether each one got taller or not. The sign test is what you're left with: just counting ups and downs, then asking if that split looks like plain chance.

## A worked example

Using the same eight students from the paired outcome scenario:

| Student | Pre | Post | Difference | Sign |
|---|---|---|---|---|
| 1 | 50 | 54 | 4 | + |
| 2 | 55 | 55 | 0 | (dropped) |
| 3 | 60 | 66 | 6 | + |
| 4 | 62 | 60 | -2 | - |
| 5 | 58 | 64 | 6 | + |
| 6 | 65 | 70 | 5 | + |
| 7 | 70 | 68 | -2 | - |
| 8 | 52 | 60 | 8 | + |

Student 2's tied score drops out, leaving *n* = 7 pairs: 5 positive signs and 2 negative signs. The sign test asks: if ups and downs were equally likely by chance, how surprising is a 5-2 split?

That's a binomial probability with *n* = 7 and *p* = .5. Adding up the chance of getting 2 or fewer of the less-common sign (0, 1, or 2 negatives out of 7):

P(0) + P(1) + P(2) = 1/128 + 7/128 + 21/128 = 29/128 ≈ .227

Doubling for a two-tailed test: *p* = .453.

## How to read the output

Statly reports the counts of positive and negative differences and a {{p_value}} from the binomial distribution. There's no {{test_statistic}} to interpret beyond the counts themselves, a small *p*-value means the split between "went up" and "went down" is unlikely to happen by chance alone.

## How to report it (APA 7)

Template: `A sign test showed a {significant/non-significant} tendency for scores to {increase/decrease}, with {k} of {n} pairs moving in that direction, *p* = {p}.`

Filled example: A sign test showed a non-significant tendency for scores to increase, with 5 of 7 pairs moving in that direction, *p* = .453.

## Common mistakes

Don't use the sign test as your default paired test just because it's simple, it throws away the size of each change, so it has less {{power}} than Wilcoxon signed-rank or a paired t-test when those are valid. Also remember to drop tied (zero-difference) pairs before counting, they don't count as evidence either way.
