---
id: cochran_q
title: "Cochran's Q test"
category: tests
summary: "Tests whether pass or fail rates differ across three or more related measurements on the same subjects."
related: [mcnemar, friedman]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Cochran's *Q* test checks whether the proportion of "yes" or "pass" outcomes changes across three or more related measurements taken on the same subjects. It's an extension of McNemar's test, which only handles two related measurements, to three or more. The outcome must be {{dichotomous_variable}}, like pass/fail or correct/incorrect, and the same subjects must appear in every measurement.

## When to use it

Use Cochran's *Q* when the same group of people is measured on a pass/fail or yes/no outcome three or more times, such as the same students taking three different quiz forms and being marked pass or fail on each. It's the categorical, {{repeated_measures}} cousin of the Friedman test, which handles ranked or continuous repeated measures instead of simple pass/fail outcomes.

## An everyday analogy

Picture the same group of students attempting three different obstacle courses, each scored simply as "cleared" or "did not clear." Cochran's *Q* asks whether students clear these three courses at noticeably different rates, or whether the pass rate stays about the same across all three, with differences you'd expect just from normal ups and downs.

## A worked example

In Scenario B, 8 students each take three quiz forms, scored pass (1) or fail (0).

| Student | Form 1 | Form 2 | Form 3 |
|---|---|---|---|
| 1 | 1 | 1 | 0 |
| 2 | 1 | 0 | 0 |
| 3 | 1 | 1 | 1 |
| 4 | 0 | 1 | 0 |
| 5 | 1 | 1 | 0 |
| 6 | 1 | 0 | 0 |
| 7 | 1 | 1 | 1 |
| 8 | 0 | 1 | 0 |

Pass rates are 6 of 8 for Form 1, 6 of 8 for Form 2, and 2 of 8 for Form 3, a clear drop on Form 3. Cochran's *Q* compares each student's pattern across the three forms and weighs how much the pass rate swings from form to form against how much students' overall pass counts vary. Statly's calculation gives *Q* = 7.00 with {{degrees_of_freedom}} = 2, and *p* = .030.

## How to read the output

Statly reports the *Q* statistic, its degrees of freedom (the number of measurements minus 1), and a {{p_value}}. A significant result means pass rates differ across the measurements somewhere, but it doesn't say which pairs differ. Here, *p* = .030 is below the usual .05 cutoff, so the pass rate really does shift across the three quiz forms, with Form 3 looking noticeably harder. Follow up with pairwise comparisons, like McNemar's test between specific pairs of forms, to pin down exactly where the difference lies.

## How to report it (APA 7)

Template: `Pass rates differed significantly across the {k} conditions, *Q*({df}) = {value}, *p* = {p}.`

Filled example: Pass rates differed significantly across the three quiz forms, *Q*(2) = 7.00, *p* = .030.

## Common mistakes

Don't use Cochran's *Q* when your outcome has more than two categories or is a continuous score, it only handles pass/fail-style data. Also don't run it with only two related measurements, that's exactly what McNemar's test is for. And remember a significant Cochran's *Q* only tells you pass rates differ somewhere among the conditions, it doesn't identify which specific pairs differ without a follow-up test.
