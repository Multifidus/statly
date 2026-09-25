---
id: t_one_sample
title: "One-sample t-test"
category: tests
summary: "Checks whether a single group's average score differs from one specific, known value."
related: [t_paired, t_independent, wilcoxon_signed_rank, sign_test, descriptives]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

The one-sample t-test checks whether the average score in one group differs from some fixed number you already know or expect, like a scale's midpoint or a past year's norm. It compares your sample's {{mean}} to that single target value, not to another group.

## When to use it

Use this test when you have one group, a continuous outcome, and a specific number in mind to compare it to, something you decided on before looking at your data. It's a common fit for checking whether a survey's average score differs from the neutral midpoint of the scale.

## An everyday analogy

Imagine a factory that's supposed to fill bottles with exactly 500 ml of water. You grab a handful of bottles off the line and measure them. You're not comparing the bottles to each other, you're asking whether their average differs from the 500 ml target the factory promised.

## A worked example

A teacher gives a 5-item reading confidence survey (1 = strongly disagree, 5 = strongly agree) to 6 students before starting a new read-aloud program (Scenario A). She wants to know if their average starting confidence differs from the scale's neutral midpoint, 3.

| Student | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Score | 2 | 3 | 2 | 4 | 3 | 2 |

*M* = 2.67, *SD* = 0.82. The {{standard_error}} is 0.82 / sqrt(6) = 0.33.

*t* = (2.67 - 3.00) / 0.33 = -1.00, with {{degrees_of_freedom}} = 6 - 1 = 5, giving *p* = .363.

## How to read the output

Statly reports *t*, the degrees of freedom, and a {{p_value}}, comparing your sample mean to the target value you specified. It runs this as a {{two_tailed_test}} by default, checking for a difference in either direction, higher or lower than the target. Here, *p* = .363 is far above the usual .05 cutoff, so this small class's starting confidence isn't meaningfully different from the scale's neutral midpoint. The small gap is likely just ordinary sampling noise.

## How to report it (APA 7)

Template: `{Outcome} did {not} differ significantly from {test value}, *M* = {m}, *SD* = {sd}, *t*({df}) = {t}, *p* = {p}.`

Filled example: Starting reading confidence did not differ significantly from the scale midpoint of 3, *M* = 2.67, *SD* = 0.82, *t*(5) = -1.00, *p* = .363.

## Common mistakes

Don't pick your comparison value after seeing the data, decide on it beforehand or the test loses its meaning. Also don't use this test when you actually have two groups or two time points to compare, that calls for an independent-samples or paired-samples t-test instead.
