---
id: anova.mixed
title: "Mixed ANOVA"
category: tests
summary: "Tests a between-group factor and a within-subject factor, like group and time, on the same outcome."
related: [anova.factorial, anova.repeated_measures, sphericity, posthoc.simple_effects]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

A mixed ANOVA combines two kinds of factors in one test: a {{between_subjects}} factor, like group, and a {{within_subjects}} factor, like time, where the same people are measured more than once. It reports a main effect for group, a main effect for time, and an interaction that asks whether groups change differently over time.

## When to use it

Use a mixed ANOVA when you have separate groups of participants, and you measure each participant on the same outcome at two or more time points, such as pretest, posttest, and follow-up. This is one of the most common designs in education research, since it can show not just whether groups differ, but whether they're changing at different rates.

## An everyday analogy

Picture tracking three different workout programs over three months, weighing each participant at the start, middle, and end. You care whether the programs differ overall, whether people generally change over time, and, most importantly, whether some programs produce faster progress than others. That last question, whether the trend over time depends on which program someone is in, is the interaction a mixed ANOVA is built to catch.

## A worked example

A researcher tracks knowledge-test scores (0-10) at Pretest and Posttest for Control and Intervention A, with 3 students per group (Scenario B).

| Group | Pretest | Posttest |
|---|---|---|
| Control | 4, 5, 5 | 5, 5, 6 |
| Intervention A | 4, 5, 4 | 8, 9, 8 |

Both groups start close together, but Intervention A jumps much higher by posttest. That's a Group x Time interaction: the change over time depends on which group a student is in. Statly fits this design, checks {{sphericity}} for the within-subject factor, and reports each effect.

## How to read the output

Statly reports the main effect of Group, the main effect of Time, and the Group x Time interaction, each with *F*, degrees of freedom, and a *p*-value. A significant interaction, like in this example, means you shouldn't stop at the main effects. Instead, follow up by testing the effect of Time separately within each group, or the effect of Group separately at each time point, using simple effects tests.

## How to report it (APA 7)

Template: `There was a significant Group x Time interaction on {outcome}, *F*({df1}, {df2}) = {F}, *p* = {p}, eta squared = {value}.`

Filled example: There was a significant Group x Time interaction on knowledge-test score, *F*(1, 4) = 12.80, *p* = .023, eta squared = .76.

## Common mistakes

Don't treat the main effect of Group as the whole story when the interaction is significant, the group difference might only show up at certain time points. Also don't skip the sphericity check for the within-subject factor when there are three or more time points, violating it can inflate your false positive rate.
