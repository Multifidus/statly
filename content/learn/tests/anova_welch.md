---
id: anova_welch
title: "Welch's ANOVA"
category: tests
summary: "Compares the average scores of three or more independent groups without assuming equal variances."
related: [anova_one_way, kruskal_wallis, t_independent, homogeneity_of_variance, omega_squared]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Welch's ANOVA compares the average scores of three or more independent groups on a continuous outcome, just like a one-way ANOVA, but it doesn't assume the groups have equal {{variance}}. It adjusts the degrees of freedom and weights each group by how precisely its own mean is estimated, giving more say to groups with less spread.

## When to use it

Use this test instead of a standard one-way ANOVA whenever your groups' spreads look noticeably different, especially if the group sizes are unequal too. It's often the safer default for comparing three or more groups, since real data rarely show perfect {{homogeneity_of_variance}} across groups.

## An everyday analogy

Imagine judging three archers by their average distance from the bullseye, but one archer's shots are always tightly clustered while another's are scattered all over the target. A fair comparison should weigh the tightly clustered archer's average more heavily, since it's a more reliable estimate. Welch's ANOVA does something similar with group variances.

## A worked example

A researcher compares a quiz score across Control, Intervention A, and Intervention B (Scenario B), 3 students per group, and the groups' spreads look quite different.

| | Control | Intervention A | Intervention B |
|---|---|---|---|
| Scores | 4, 5, 6 | 5, 7, 9 | 6, 9, 12 |
| *M* | 5.00 | 7.00 | 9.00 |
| Variance | 1.00 | 4.00 | 9.00 |

Intervention B's scores spread out nine times more than Control's, so pooling the variances the way a standard ANOVA does would be misleading. Welch's version weights each group by 1 / variance: Control gets a weight of 3, Intervention A gets 0.75, and Intervention B gets 0.33. Groups with less spread count for more.

Working through the weighted formula gives *F* = 2.66, with adjusted {{degrees_of_freedom}} = 2 and 3.38 (this second value is rarely a whole number, since it's adjusted for the unequal variances), giving *p* = .203.

## How to read the output

Statly reports the {{f_statistic}}, two degrees of freedom, and a {{p_value}}, the same way as a one-way ANOVA, but calculated with the variance-weighted adjustment. Here, *p* = .203 is above the usual {{alpha}} of .05, so this small example doesn't provide strong evidence the three groups truly differ, even though the raw means look spread out. The unequal variances make this result less certain than a standard ANOVA would suggest.

## How to report it (APA 7)

Template: `A Welch's ANOVA showed a {significant/non-significant} difference in {outcome} across the {k} groups, *F*({df1}, {df2}) = {F}, *p* = {p}.`

Filled example: A Welch's ANOVA showed a non-significant difference in quiz score across the three groups, *F*(2, 3.38) = 2.66, *p* = .203.

## Common mistakes

Don't default to a standard one-way ANOVA without checking whether the group variances are roughly equal, use {{levenes_test}} (or just compare the *SD*s) to check first. Also don't skip effect size reporting just because the adjusted degrees of freedom look unusual, omega squared or eta squared still describe how much of the variation the groups explain.
