---
id: posthoc.simple_effects
title: "Simple Effects Analysis"
category: posthoc
summary: "Follows up a significant interaction by testing one factor's effect separately at each level of the other factor."
related: [anova.factorial, anova.mixed, posthoc.pairwise]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

A simple effects analysis is a follow-up test you run after finding a significant {{interaction_effect}} in a factorial or mixed ANOVA. Instead of asking whether a factor matters on average, it asks whether that factor matters at one specific level of the other factor at a time, one slice of the design at a time.

## When to use it

Use simple effects when your ANOVA interaction is significant, since the main effects alone can be misleading once factors interact. For example, if Group x Time interacts significantly, you'd test the effect of Group separately at Pretest and separately at Posttest, rather than trusting one overall Group main effect.

## An everyday analogy

Picture a cooking interaction: a spice works great in a stew but ruins a salad. Saying "the spice has no overall effect" would miss the point, since it does help, just only in one dish. Simple effects analysis is like testing the spice separately in the stew and separately in the salad, instead of averaging its effect across both.

## A worked example

Following a significant Group x Time interaction on knowledge-test scores (Control vs. Intervention A, at Pretest and Posttest, Scenario B), a researcher tests the effect of Group separately at each time point.

| Time point | *t* | df | *p* |
|---|---|---|---|
| Pretest | 0.40 | 4 | .71 |
| Posttest | 4.90 | 4 | .008 |

## How to read the output

Statly reports a separate test, often a *t*-test or one-way ANOVA, for each slice of the design you're checking. Here, groups don't differ at Pretest but differ strongly at Posttest, which explains the interaction: the intervention created a gap that wasn't there before. Always pair simple effects with a multiple comparisons correction, since you're now running several tests instead of one.

## How to report it (APA 7)

Template: `Simple effects analysis showed no significant difference between {group1} and {group2} at {level1}, *t*({df}) = {t1}, *p* = {p1}, but a significant difference at {level2}, *t*({df}) = {t2}, *p* = {p2}.`

Filled example: Simple effects analysis showed no significant difference between Control and Intervention A at Pretest, *t*(4) = 0.40, *p* = .71, but a significant difference at Posttest, *t*(4) = 4.90, *p* = .008.

## Common mistakes

Don't run simple effects tests when the interaction wasn't significant in the first place, they add unnecessary comparisons and risk false positives. Also don't forget to correct for multiple comparisons across the simple effects tests you run, since each additional slice you test adds another chance for a false positive.
