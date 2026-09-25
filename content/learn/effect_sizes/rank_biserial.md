---
id: rank_biserial
title: "Rank-biserial correlation"
category: effect_sizes
summary: "Measures effect size for Mann-Whitney, Wilcoxon, or sign test results, based on how much rank overlap the two groups or conditions have."
related: [mann_whitney, wilcoxon_signed_rank, sign_test, r_effect, kruskal_wallis]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Rank-biserial correlation is an effect size for {{rank}}-based tests, like Mann-Whitney U or Wilcoxon signed-rank. It compares the ranks two groups, or two conditions, earned, and reports how far apart they are on a scale from -1 to 1. A value near 0 means the groups' ranks overlapped a lot. A value near 1 or -1 means one group consistently outranked the other.

## When to use it

Use it alongside a Mann-Whitney U test for two independent groups, or a Wilcoxon signed-rank test for paired data, whenever your data is {{ordinal}} or you can't trust a *t*-test's assumptions. It's a natural pairing, since both tests already work with ranks.

## An everyday analogy

Picture lining up every student from two classes by score, low to high. If most students from one class end up near the top of the line and most from the other end up near the bottom, the rank-biserial correlation will be large. If the two classes are mixed together, it'll be close to 0.

## A worked example

Control group (n = 4): 4, 5, 6, 5. Intervention A group (n = 4): 6, 7, 8, 7.

Rank all 8 scores together, lowest to highest, giving tied scores the average of their ranks:

| Score | 4 | 5 | 5 | 6 | 6 | 7 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Rank | 1 | 2.5 | 2.5 | 4.5 | 4.5 | 6.5 | 6.5 | 8 |

Sum of Control's ranks (4, 5, 6, 5) = 1 + 2.5 + 4.5 + 2.5 = 10.5

Mann-Whitney *U* for Control = 10.5 - [4(4+1)/2] = 10.5 - 10 = 0.5

Rank-biserial *r* = 1 - [2*U* / (*n1* x *n2*)] = 1 - (2 x 0.5 / 16) = 1 - .0625 = .94

## How to read the output

Statly reports the rank-biserial *r* next to the *U* statistic and *p*-value. A value close to 1 or -1 means the two groups barely overlapped in rank, a very consistent effect. A value close to 0 means the groups' scores were mixed together with no clear pattern.

## How to report it (APA 7)

Template: `A Mann-Whitney test showed a significant difference in {outcome} between {group1} and {group2}, *U* = {u}, *p* = {p}, *r* = {r}.`

Filled example: A Mann-Whitney test showed a significant difference in quiz score between Control and Intervention A, *U* = 0.50, *p* = .029, *r* = .94.

## Benchmarks (and why to be careful)

The usual small/medium/large cutoffs of about .10, .30, and .50 come from general research using Pearson-style correlations, not classroom studies using ranks. Education researchers usually judge a rank-biserial *r* against results from similar programs in the same subject and age group, since even a modest-looking *r* can reflect a practically important difference in a small class.

## Common mistakes

Don't calculate rank-biserial correlation from raw scores without ranking them first, it only works on the ranks. Also don't assume a huge value like .94 from a tiny sample, like the four-student example above, will hold up in a larger group. Small samples can produce very large or very small effect sizes just by chance.
