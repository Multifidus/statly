---
id: partial_eta_squared
title: "Partial eta squared"
category: effect_sizes
summary: "Measures the percentage of variance a single factor explains after setting aside variance from other factors in the design."
related: [anova_rm, anova_one_way, eta_squared, omega_squared, epsilon_squared]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Partial eta squared measures how much {{variance}} one factor explains, after setting aside the variance from any other factors in your design. In a simple one-way ANOVA with just one factor, there's nothing else to set aside, so partial eta squared and regular eta squared come out equal. They only diverge once you add a second factor, like group and time together.

## When to use it

Use partial eta squared for ANOVA designs with more than one factor, such as a two-way ANOVA (group by time) or a repeated-measures ANOVA with multiple factors. It lets you report each factor's effect size without the other factors' variance diluting it.

## An everyday analogy

Imagine grading how much a tutoring program raised scores, while some students also happened to study more at home. Partial eta squared asks: of the variance left over after accounting for at-home study, how much does the tutoring program explain? It isolates one factor's contribution from the rest.

## A worked example

With one factor, like the three-group quiz study from the eta squared page (Scenario B, teaching method only), partial eta squared uses the same formula:

| Group | Scores | Mean |
|---|---|---|
| Control | 4, 5, 6 | 5.00 |
| Intervention A | 6, 7, 8 | 7.00 |
| Intervention B | 7, 8, 9 | 8.00 |

Between-groups sum of squares = 14.00, within-groups sum of squares = 6.00

Partial eta squared = 14.00 / (14.00 + 6.00) = .70

This matches regular eta squared exactly, because teaching method is the only factor in the design. If a second factor, like pretest versus posttest, were added, the denominator would only include that factor's leftover variance, and the two numbers would separate.

## How to read the output

Statly reports partial eta squared for each factor in a multi-factor ANOVA. Compare factors within the same study using partial eta squared, since it's built to isolate each factor's own contribution. Don't compare it across studies with different designs, since the leftover variance it's based on depends on what else was in the model.

## How to report it (APA 7)

Template: `There was a significant effect of {factor} on {outcome}, *F*({df1}, {df2}) = {f}, *p* = {p}, partial eta-squared = {peta2}.`

Filled example: There was a significant effect of teaching method on quiz score, *F*(2, 6) = 7.00, *p* = .027, partial eta-squared = .70.

## Benchmarks (and why to be careful)

The same rough cutoffs used for eta squared, about .01 small, .06 medium, .14 large, get applied to partial eta squared too, but they weren't built from classroom data. Partial eta squared can run higher in designs with several factors. Compare it to similar multi-factor studies in the same subject and setting, not a generic chart.

## Common mistakes

Don't add up the partial eta squared values for every factor in a study and expect them to total 100%. Each one is calculated against a different leftover-variance denominator, so they can add up to more than one. Also don't report partial eta squared from a one-way design as if it's more informative than regular eta squared. In that specific case, they're the same number.
