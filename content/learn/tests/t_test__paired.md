---
id: t_test.paired
title: "Paired-samples t-test"
category: tests
summary: "Compares two related measurements from the same people or matched pairs."
related: [t_test.independent, t_test.one_sample, wilcoxon_signed_rank, sign_test, anova.repeated_measures, d_z_d_av]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

The paired-samples t-test compares two measurements taken from the same people or matched pairs, like a before-and-after score. Instead of comparing two separate groups, it looks at the difference within each pair, then checks whether the average difference is bigger than you'd expect from chance.

## When to use it

Use this test when the same people (or matched pairs) are measured twice on a continuous outcome, such as before and after a program. Because the two sets of scores come from the same source, they're {{paired}}, not independent, so this test, not the independent-samples version, is the right fit.

## An everyday analogy

Think about weighing the same six people before and after a two-week diet plan. You're not comparing one random group of people to another, you're tracking each person's own change and asking whether the typical change is more than day-to-day weight fluctuation would explain.

## A worked example

A teacher measures the same 6 students' reading confidence composite score (1-5 scale) before and after a new read-aloud program (Scenario A).

| Student | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Pre | 2 | 3 | 2 | 4 | 3 | 2 |
| Post | 4 | 4 | 3 | 5 | 4 | 3 |
| Difference | 2 | 1 | 1 | 1 | 1 | 1 |

*M*(difference) = 1.17, *SD*(difference) = 0.41. The {{standard_error}} is 0.41 / sqrt(6) = 0.17.

*t* = 1.17 / 0.17 = 7.00, with {{degrees_of_freedom}} = 6 - 1 = 5, giving *p* < .001.

## How to read the output

Statly reports *t*, the degrees of freedom, and a {{p_value}}, based on the average of the within-pair differences rather than the raw scores themselves. Here, *p* < .001 means a difference this large and this consistent across all 6 students would be very unlikely if the read-aloud program had no real effect.

## How to report it (APA 7)

Template: `There was a significant difference between {condition1} (*M* = {m1}, *SD* = {sd1}) and {condition2} (*M* = {m2}, *SD* = {sd2}), *t*({df}) = {t}, *p* = {p}, *d* = {d}.`

Filled example: There was a significant difference between reading confidence before (*M* = 2.67, *SD* = 0.82) and after (*M* = 3.83, *SD* = 0.75) the read-aloud program, *t*(5) = 7.00, *p* < .001, *d* = 2.86.

## Common mistakes

Don't treat paired data as if it came from two independent groups, that throws away the pairing information and inflates the standard error. Also don't confuse this with a repeated-measures ANOVA. Use the paired t-test for exactly two time points, and a repeated-measures ANOVA for three or more.
