---
id: r_effect
title: "r (rank-based effect size)"
category: effect_sizes
summary: "Converts a nonparametric test's Z score into a correlation-like effect size between -1 and 1."
related: [wilcoxon_signed_rank, mann_whitney, rank_biserial, sign_test, t_test.paired]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

This *r* effect size turns the {{z_score}} from a {{nonparametric}} test, like a Wilcoxon signed-rank test or Mann-Whitney U test, into a number between -1 and 1. It works like a correlation: values near 0 mean little effect, values near 1 or -1 mean a strong, consistent effect across your sample.

## When to use it

Use this *r* whenever Statly's output for a nonparametric test includes a Z score, typically the Wilcoxon signed-rank test, the Mann-Whitney U test, or the sign test. It gives you a standardized effect size to report alongside a test that doesn't produce a mean difference the way a *t*-test does.

## An everyday analogy

Think of it as asking: out of everyone whose rank changed, how consistently did it move in one direction? If almost everyone's rank shifted the same way, *r* is close to 1. If ranks moved every which way with no clear pattern, *r* is close to 0.

## A worked example

Six students in a reading confidence survey (Scenario A) are measured before and after a new read-aloud program. Statly's Wilcoxon signed-rank test on their scores produces *Z* = -2.20.

*r* = *Z* / sqrt(*N*) = -2.20 / sqrt(6) = -2.20 / 2.45 = -.90

## How to read the output

Statly reports *r* alongside the Z score and *p*-value from the nonparametric test it came from. The sign just shows direction, based on which condition Statly listed first, so check the sign against your actual data. Take the size of *r*, ignoring the sign, as the strength of the effect.

## How to report it (APA 7)

Template: `There was a significant difference in {outcome} from {condition1} to {condition2}, *Z* = {z}, *p* = {p}, *r* = {r}.`

Filled example: There was a significant increase in reading confidence scores from pretest to posttest, *Z* = -2.20, *p* = .028, *r* = -.90.

## Benchmarks (and why to be careful)

Rough guides call *r* = .10 small, .30 medium, and .50 large, but these came from general psychology research, not classroom studies. In education, an *r* of .20 or .25 from a well-run study can represent a genuinely meaningful change. Compare your result to similar programs in the same subject and grade level rather than a fixed chart.

## Common mistakes

Don't confuse this *r* with a {{correlation}} between two separate variables. It's calculated from a single test's Z score, not from pairing two measurements. Also don't drop the sign entirely when writing up results. Even though benchmarks use its absolute value, the sign tells you the direction of the effect.
