---
id: omega_squared
title: "Omega squared"
category: effect_sizes
summary: "A less-biased alternative to eta squared for estimating the percentage of variance a factor explains, especially with small samples."
related: [eta_squared, epsilon_squared, anova_one_way, anova_welch, partial_eta_squared]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Omega squared estimates the same thing as eta squared, the share of {{variance}} in your outcome explained by group membership. But it corrects for the fact that eta squared tends to overestimate this share, especially with small samples. It does this by subtracting out the amount of variance you'd expect to see explained just by chance.

## When to use it

Use omega squared instead of eta squared whenever your sample is small, roughly under 30 per group, or when you want a more conservative effect size to report or compare across studies.

## An everyday analogy

Imagine flipping coins and, just by luck, one person gets a few more heads than another. Eta squared would credit some of that luck as a real effect. Omega squared subtracts out the variance you'd expect from luck alone, so what's left is a fairer estimate of the true effect.

## A worked example

Using the same three-group quiz data as eta squared (Scenario B):

Between-groups sum of squares = 14.00, within-groups sum of squares = 6.00, total sum of squares = 20.00

Groups (*k*) = 3, within-groups {{degrees_of_freedom}} = 9 - 3 = 6, mean square within = 6.00 / 6 = 1.00

Omega squared = [SS_between - (*k*-1) x MS_within] / (SS_total + MS_within)

Omega squared = [14.00 - 2(1.00)] / (20.00 + 1.00) = 12.00 / 21.00 = .57

## How to read the output

Statly reports omega squared as a value that's usually a bit smaller than eta squared for the same data, since it's correcting for overestimation. Read it the same way: the percentage of variance in scores explained by group membership, just a more conservative estimate.

## How to report it (APA 7)

Template: `There was a significant effect of {factor} on {outcome}, *F*({df1}, {df2}) = {f}, *p* = {p}, omega-squared = {omega2}.`

Filled example: There was a significant effect of teaching method on quiz score, *F*(2, 6) = 7.00, *p* = .027, omega-squared = .57.

## Benchmarks (and why to be careful)

The same rough small/medium/large cutoffs used for eta squared (about .01, .06, .14) are sometimes applied to omega squared too, but omega squared naturally reads lower than eta squared for the same data. Using eta squared's chart on it can make a real effect look weaker than it is. Compare your omega squared to other published studies in the same subject and grade level, not a generic label.

## Common mistakes

Don't compare an omega squared from one study directly to an eta squared from another, they're calculated differently and aren't on the same scale. Also don't skip omega squared just because eta squared is easier to compute by hand. With small samples, the difference between the two can be large enough to change how you describe your results.
