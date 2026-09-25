---
id: posthoc.pairwise
title: "Pairwise t-tests (Bonferroni / Holm)"
category: posthoc
summary: "Runs a t-test on every pair of groups after ANOVA, with a correction to control false positives."
related: [t_test.independent, anova.one_way, multiple_comparisons]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Pairwise *t*-tests compare every possible pair of groups using ordinary independent-samples *t*-tests, then apply a correction, usually {{bonferroni_correction}} or the Holm method, to keep the overall false-positive rate under control. It's a more flexible, if slightly blunter, alternative to Tukey HSD.

## When to use it

Use pairwise *t*-tests as a post hoc follow-up after a significant ANOVA when you want a simple, widely understood method, or when you only care about a specific subset of comparisons rather than every possible pair. The Holm correction is usually preferred over plain Bonferroni, since it controls the same false-positive rate but rejects more true differences.

## An everyday analogy

Picture checking three friends' guesses against the actual answer to a trivia question, one comparison at a time. Each individual check is simple, but if you check enough pairs, you'll eventually flag a lucky guess as meaningful just by chance. The correction tightens the bar for "significant" on each individual check, so your overall risk of a false alarm across all the checks stays at your intended level.

## A worked example

Following a significant one-way ANOVA on knowledge-test scores across Control, Intervention A, and Intervention B (Scenario B), a researcher runs three pairwise *t*-tests with a Holm correction.

| Comparison | *t* | Raw *p* | Holm-adjusted *p* |
|---|---|---|---|
| Control vs. Intervention A | 4.47 | .002 | .006 |
| Intervention A vs. Intervention B | 2.10 | .058 | .058 |
| Control vs. Intervention B | 1.30 | .21 | .21 |

## How to read the output

Statly lists each comparison's *t* value, degrees of freedom, the raw *p*-value, and the adjusted *p*-value after the correction you chose. Always judge significance using the adjusted *p*-value, not the raw one. Here, only Control vs. Intervention A survives the Holm correction at the .05 level.

## How to report it (APA 7)

Template: `Pairwise comparisons with a Holm correction showed that {group1} (*M* = {m1}) differed significantly from {group2} (*M* = {m2}), *t*({df}) = {t}, adjusted *p* = {p}.`

Filled example: Pairwise comparisons with a Holm correction showed that Intervention A (*M* = 7.00) differed significantly from Control (*M* = 5.00), *t*(8) = 4.47, adjusted *p* = .006.

## Common mistakes

Don't report the raw, uncorrected *p*-values from pairwise comparisons, that reintroduces the false-positive problem the correction exists to fix. Also don't use plain Bonferroni by default when you have many comparisons, it's unnecessarily conservative; Holm gives the same protection with more power to detect real differences.
