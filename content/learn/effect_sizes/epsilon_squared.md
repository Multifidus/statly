---
id: epsilon_squared
title: "Epsilon squared"
category: effect_sizes
summary: "Another less-biased alternative to eta squared, similar to omega squared, for estimating variance explained by group membership."
related: [eta_squared, omega_squared, anova.one_way, kruskal_wallis, anova.welch]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Epsilon squared, like omega squared, corrects eta squared's tendency to overestimate the {{variance}} explained by group membership, especially in small samples. It uses a slightly different formula than omega squared, but the two usually land close to each other, and both improve on plain eta squared for small studies.

## When to use it

Use epsilon squared as a less biased alternative to eta squared, particularly with small samples. It's also commonly reported for the Kruskal-Wallis test, as a rank-based version of this same idea.

## An everyday analogy

Think of two bathroom scales that both try to correct for the fact that your regular scale reads a bit heavy. They won't give the exact same number, but both should read closer to your true weight than the uncorrected scale does.

## A worked example

Using the same three-group quiz data as eta squared and omega squared (Scenario B):

Between-groups {{sum_of_squares}} = 14.00, within-groups sum of squares = 6.00, total sum of squares = 20.00, mean square within = 1.00, *k* = 3 groups

Epsilon squared = [SS_between - (*k*-1) x MS_within] / SS_total

Epsilon squared = [14.00 - 2(1.00)] / 20.00 = 12.00 / 20.00 = .60

## How to read the output

Statly reports epsilon squared as a value close to, but not identical to, omega squared for the same data. Both are more conservative than eta squared. Read it the same way: the estimated percentage of variance in your outcome explained by group membership.

## How to report it (APA 7)

Template: `There was a significant effect of {factor} on {outcome}, *F*({df1}, {df2}) = {f}, *p* = {p}, epsilon-squared = {epsilon2}.`

Filled example: There was a significant effect of teaching method on quiz score, *F*(2, 6) = 7.00, *p* = .027, epsilon-squared = .60.

## Benchmarks (and why to be careful)

Epsilon squared usually falls close to omega squared and below eta squared for the same data, so applying eta squared's rough cutoffs (about .01, .06, .14) to it can undersell a real effect. Compare epsilon squared to similar published studies in the same subject and grade level, since education effects often don't match general-research benchmarks.

## Common mistakes

Don't report epsilon squared and omega squared as if they're interchangeable with eta squared. All three answer a similar question but use different formulas and rarely match exactly. Also don't pick whichever of the three gives you the biggest number, decide which one you'll use before you see the results.
