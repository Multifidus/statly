---
id: anova_rm
title: "Repeated-measures ANOVA"
category: tests
summary: "Compares three or more measurements taken from the same people or units over time or conditions."
related: [t_paired, friedman, sphericity, partial_eta_squared, anova_one_way]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

A repeated-measures ANOVA compares three or more measurements taken from the same people or units, like scores at pretest, posttest, and follow-up. It's the multi-timepoint extension of the paired-samples t-test: instead of one before-and-after difference, it looks at the pattern of change across several {{repeated_measures}} on the same source.

## When to use it

Use this test when the same people are measured three or more times (or under three or more conditions) on a continuous outcome, and you want to know whether the average score changes across those time points. Because each person contributes every measurement, the comparisons are {{within_subjects}} rather than {{between_subjects}}.

## An everyday analogy

Picture tracking the same four runners' lap times at the start, middle, and end of a training season. You're not comparing one runner to another, you're asking whether the group's typical lap time changes across the season, using each runner as their own baseline.

## A worked example

A researcher gives the same 10-point quiz to 4 students in the Intervention A group (Scenario B) at pretest, posttest, and follow-up.

| Student | Pretest | Posttest | Follow-up |
|---|---|---|---|
| 1 | 3 | 5 | 4 |
| 2 | 4 | 6 | 5 |
| 3 | 5 | 7 | 7 |
| 4 | 2 | 4 | 3 |
| *M* | 3.50 | 5.50 | 4.75 |

The grand mean across all 12 scores is 4.58. Splitting the total variation into parts, how much each student's own average differs from the grand mean, how much the condition means differ from the grand mean, and how much is left over as unexplained noise, gives a {{sum_of_squares}} of 8.17 for the time effect and 0.50 for the leftover error.

*F* = (8.17 / 2) / (0.50 / 6) = 4.08 / 0.08 = 49.00, with {{degrees_of_freedom}} = 2 and 6, giving *p* < .001.

## How to read the output

Statly reports the {{f_statistic}}, two degrees of freedom (time, error), and a {{p_value}}. A significant result means the average score changes across at least two of the time points, but not which ones. Statly also checks {{sphericity}}, whether the differences between every pair of time points spread out about equally, and applies a correction if that assumption looks shaky.

## How to report it (APA 7)

Template: `There was a significant change in {outcome} across the {k} time points, *F*({df1}, {df2}) = {F}, *p* = {p}, partial eta-squared = {peta2}.`

Filled example: There was a significant change in quiz score across pretest, posttest, and follow-up, *F*(2, 6) = 49.00, *p* < .001, partial eta-squared = .94.

## Common mistakes

Don't use this test when some students are missing a time point, a repeated-measures ANOVA needs complete data for every person at every measurement. Also don't skip the sphericity check. When it fails and Statly can't apply a correction, the Friedman test, which works on ranks instead of raw scores, is a solid nonparametric alternative.
