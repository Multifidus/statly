---
id: generalized_eta_squared
title: "Generalized Eta Squared"
category: effect_sizes
summary: "An eta-squared variant built so effect sizes stay comparable across between-subjects, within-subjects, and mixed designs."
related: [eta_squared, partial_eta_squared, anova.mixed, anova.repeated_measures]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

{{generalized_eta_squared}} is a version of eta squared. It lets you compare effect sizes across different study designs, including between-subjects, {{within_subjects}}, and mixed designs. Regular eta squared and partial eta squared can give different numbers depending on how a study is designed, even when the true effect is the same size. Generalized eta squared fixes this by accounting for the design itself.

## When to use it

Use generalized eta squared when you report effect sizes from a repeated-measures or mixed ANOVA. This helps readers compare your effect size to studies that used a different design, like a plain between-subjects ANOVA. It is now the recommended choice for these designs in published research.

## An everyday analogy

Picture two race times measured in different units, one in minutes and one in seconds. You can't compare them until you convert to the same unit. Generalized eta squared works the same way. It converts each study's effect size to the same "unit," no matter how many times the original design measured each person.

## A worked example

A researcher runs a mixed ANOVA on knowledge-test scores by Group (Control vs. Intervention A) and Time (Pretest vs. Posttest), and finds a Group x Time interaction (Scenario B). Statly computes this for you. Here's how to read what it gives you: rather than hand-calculating the variance components, you read the value directly from the output table.

| Effect | *F* | df | *p* | Generalized eta squared |
|---|---|---|---|---|
| Group x Time | 12.80 | 1, 4 | .023 | .58 |

## How to read the output

Statly reports generalized eta squared next to the *F* value for each effect. Read it on the same 0 to 1 scale as regular eta squared. It is roughly the share of total variation the effect explains. Trust it more than plain eta squared or partial eta squared when you compare results across different study designs.

## How to report it (APA 7)

Template: `There was a significant {effect} on {outcome}, *F*({df1}, {df2}) = {F}, *p* = {p}, generalized eta squared = {value}.`

Filled example: There was a significant Group x Time interaction on knowledge-test score, *F*(1, 4) = 12.80, *p* = .023, generalized eta squared = .58.

## Benchmarks (and why to be careful)

The rough guide used for eta squared, 0.01 small, 0.06 medium, 0.14 large, is often used for generalized eta squared too. But these labels came from general behavioral research, not education. Education effects, especially interaction effects in classroom studies, often run smaller than lab-based benchmarks suggest. Compare your value to similar published education studies instead of relying on the generic labels alone.

## Common mistakes

Don't mix generalized eta squared from one study with partial eta squared from another when you compare effect sizes. They are calculated differently and are not on the same scale. Also don't assume generalized eta squared always beats the alternatives. For a plain between-subjects design with no repeated measures, it gives the same value as regular eta squared anyway.
