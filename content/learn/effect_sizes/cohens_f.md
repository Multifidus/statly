---
id: cohens_f
title: "Cohen's f"
category: effect_sizes
summary: "Measures the size of a group effect in an ANOVA-family test, useful for both reporting results and planning sample size."
related: [anova.one_way, eta_squared, power.anova]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

{{cohens_f}} measures how large a group effect is in an ANOVA-family test. It's closely related to eta squared, but it's expressed on a scale that plugs directly into power analysis, making it especially useful when you're planning a study's sample size ahead of time, not just describing results after the fact.

## When to use it

Use Cohen's *f* when you want an effect size for a one-way ANOVA, factorial ANOVA, or ANCOVA result, particularly if you're also running a power analysis to decide how many participants you need. If you just want a quick, easy-to-explain effect size for a report, eta squared is often simpler to communicate.

## An everyday analogy

Picture three coffee shops competing on customer wait times. Cohen's *f* is like a single number summarizing how much wait times bounce around between shops, compared to how much they naturally bounce around within any one shop on a normal day. A bigger number means the shops differ more from each other than a typical day's random ups and downs would explain.

## A worked example

A researcher runs a one-way ANOVA on knowledge-test scores across Control, Intervention A, and Intervention B, and finds eta squared = 0.35 (Scenario B).

Cohen's *f* converts from eta squared using: *f* = sqrt(eta squared / (1 - eta squared))

*f* = sqrt(0.35 / 0.65) = sqrt(0.54) = 0.73

## How to read the output

Statly reports Cohen's *f* alongside the ANOVA's *F* value and eta squared. A bigger *f* means group means are more spread out relative to the natural spread of scores within each group. Statly also uses this value behind the scenes when you run a power analysis for an ANOVA design.

## How to report it (APA 7)

Template: `There was a significant effect of {group variable} on {outcome}, *F*({df1}, {df2}) = {F}, *p* = {p}, *f* = {value}.`

Filled example: There was a significant effect of group on knowledge-test score, *F*(2, 12) = 5.60, *p* = .019, *f* = 0.73.

## Benchmarks (and why to be careful)

Cohen's rough guide calls *f* = 0.10 small, 0.25 medium, and 0.40 large. These come from general behavioral research, not classrooms specifically. Education interventions often produce smaller effects than lab studies, so an *f* around 0.20 to 0.25 might represent a genuinely valuable program effect in a school setting, even though it only reads as "small to medium" on Cohen's generic scale. Always compare against effect sizes from similar education studies before judging whether a result is meaningful.

## Common mistakes

Don't confuse Cohen's *f* with Cohen's *d*, they're on different scales and built for different designs, *d* compares two groups, *f* summarizes any number of groups in an ANOVA. Also don't skip context from your specific field when judging the size of *f*, generic benchmarks can be misleading for education research.
