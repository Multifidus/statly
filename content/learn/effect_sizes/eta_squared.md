---
id: eta_squared
title: "Eta squared"
category: effect_sizes
summary: "Measures the percentage of total variance in an outcome explained by group membership in an ANOVA."
related: [anova.one_way, anova.welch, partial_eta_squared, omega_squared, epsilon_squared]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Eta squared tells you what percentage of the total {{variance}} in your outcome is explained by which group someone was in. It comes straight out of a one-way ANOVA's {{sum_of_squares}} values: the {{between_groups_variance}} divided by the total variance.

## When to use it

Report eta squared alongside a one-way or repeated-measures ANOVA result, whenever you want to say not just "the groups differed" but "here's how much of the variation in scores group membership actually explains."

## An everyday analogy

Imagine everyone's height varies for lots of reasons: genetics, diet, age. Eta squared is like asking, if I only knew which school someone attended, how much of that height variation could I explain? If school explains a lot, eta squared is high. If height varies mostly for other reasons, eta squared is low.

## A worked example

Three groups take the same 10-point quiz (Scenario B), three students each:

| Group | Scores | Mean |
|---|---|---|
| Control | 4, 5, 6 | 5.00 |
| Intervention A | 6, 7, 8 | 7.00 |
| Intervention B | 7, 8, 9 | 8.00 |

Grand mean (all 9 scores) = 6.67

Between-groups sum of squares = 3(5.00-6.67)² + 3(7.00-6.67)² + 3(8.00-6.67)² = 14.00

Within-groups sum of squares = 2.00 + 2.00 + 2.00 = 6.00

Total sum of squares = 14.00 + 6.00 = 20.00

Eta squared = 14.00 / 20.00 = .70

## How to read the output

Statly reports eta squared as a value between 0 and 1, alongside the ANOVA's *F* statistic and *p*-value. A value of .70 means group membership accounts for 70% of the variance in scores. The remaining 30% comes from other sources, including individual differences within each group.

## How to report it (APA 7)

Template: `There was a significant effect of {factor} on {outcome}, *F*({df1}, {df2}) = {f}, *p* = {p}, eta-squared = {eta2}.`

Filled example: There was a significant effect of teaching method on quiz score, *F*(2, 6) = 7.00, *p* = .027, eta-squared = .70.

## Benchmarks (and why to be careful)

Cohen's rough guide treats eta squared around .01 as small, .06 as medium, and .14 as large, but those cutoffs came from general research, not education specifically. Eta squared tends to run larger with fewer groups and smaller samples, like the tiny nine-student example above. Compare your eta squared to similar published studies in the same subject and grade level instead of leaning on a fixed chart.

## Common mistakes

Don't use eta squared to compare across studies with different numbers of groups, it isn't designed for that and can mislead you. Also don't treat a large eta squared alone as proof the difference matters in a classroom. A statistically explained 70% of variance in a nine-student pilot needs to be replicated before you trust it.
