---
id: posthoc.games_howell
title: "Games-Howell Test"
category: posthoc
summary: "Compares every pair of groups after ANOVA when group variances or sample sizes are unequal."
related: [anova.welch, posthoc.tukey, homogeneity_of_variance]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

The Games-Howell test is a {{post_hoc}} test that compares every pair of group means after an ANOVA, similar to Tukey HSD, but it doesn't assume the groups have equal variances or equal sample sizes. It adjusts each pairwise comparison using that specific pair's own variances, rather than one shared, pooled variance.

## When to use it

Use Games-Howell after a significant Welch's ANOVA, or any time your groups clearly have unequal spread or very different sample sizes. This comes up often in education research, where a small pilot group might have much more variable scores than a larger comparison group.

## An everyday analogy

Picture comparing running times between a large city marathon field and a small, tight-knit group of elite runners. The city field has wildly different pace times, while the elite group barely varies. Treating both groups as if they spread out the same amount would be unfair. Games-Howell adjusts each comparison based on how much each specific group actually varies.

## A worked example

Following a significant Welch's ANOVA on knowledge-test scores where Intervention A has 4 students with tightly clustered scores and Control has 8 students with widely spread scores (Scenario B), a researcher runs Games-Howell.

| Comparison | Mean difference | *p* (adjusted) |
|---|---|---|
| Control vs. Intervention A | -2.20 | .019 |
| Control vs. Intervention B | -0.80 | .34 |
| Intervention A vs. Intervention B | 1.40 | .12 |

## How to read the output

Statly reports the same layout as Tukey HSD: a mean difference, a confidence interval, and an adjusted *p*-value for every pair. Read it the same way, a *p*-value below .05 means that specific pair differs significantly. The main difference is under the hood, Games-Howell doesn't force every comparison to use the same shared variance estimate, which makes it more trustworthy here.

## How to report it (APA 7)

Template: `A Games-Howell post hoc test showed that {group1} (*M* = {m1}) scored significantly {higher/lower} than {group2} (*M* = {m2}), *p* = {p}.`

Filled example: A Games-Howell post hoc test showed that Intervention A (*M* = 7.20) scored significantly higher than Control (*M* = 5.00), *p* = .019.

## Common mistakes

Don't default to Tukey HSD just because it's more familiar when your variances are clearly unequal, Games-Howell is the more honest choice there. Also don't assume Games-Howell is always the safer pick, if your variances truly are equal, Tukey HSD has slightly more power to detect real differences.
