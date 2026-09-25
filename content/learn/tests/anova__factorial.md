---
id: anova.factorial
title: "Factorial (Two-Way) ANOVA"
category: tests
summary: "Tests two grouping variables at once, plus whether they interact, on a continuous outcome."
related: [anova.one_way, anova.mixed, eta_squared, posthoc.simple_effects]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

A factorial ANOVA, often a two-way ANOVA, tests two {{independent_variable}}s on the same continuous outcome at the same time. It reports two {{main_effect}}s, one for each factor on its own, plus an {{interaction_effect}}, which asks whether the effect of one factor depends on the level of the other.

## When to use it

Use a factorial ANOVA when you have two categorical grouping variables and want to know how they each affect an outcome, and whether they combine in a way that's more than just adding the two effects together. Both factors must involve different, unrelated participants (a {{between_subjects}} design). If one factor involves the same people measured repeatedly, use a mixed ANOVA instead.

## An everyday analogy

Picture testing whether a new recipe (butter vs. oil) and baking temperature (325°F vs. 375°F) each affect how a cake turns out. Butter might work better at one temperature but worse at another. A factorial ANOVA can tell you whether recipe matters on average, whether temperature matters on average, and whether the best recipe actually depends on which temperature you use.

## A worked example

A researcher studies knowledge-test scores (0-10) by Group (Control vs. Intervention A) and Session Length (Short vs. Long), with 3 students in each of the four combinations (Scenario B).

| | Short | Long |
|---|---|---|
| Control | 4, 5, 5 | 5, 6, 5 |
| Intervention A | 6, 6, 7 | 8, 9, 9 |

Intervention A looks better than Control overall, and Long sessions look better than Short overall, but the gap between Control and Intervention A grows a lot in the Long condition. That pattern, where one factor's effect changes depending on the other factor, is what an interaction effect captures. Statly fits the full model and reports each piece separately.

## How to read the output

Statly reports three rows: the main effect of Group, the main effect of Session Length, and their interaction, each with an *F* value, degrees of freedom, and a {{p_value}}. Check the interaction first. If it's significant, be cautious about interpreting the main effects alone, since the story depends on which combination you're looking at, and you'll usually want to follow up with simple effects tests. If the interaction isn't significant, you can interpret each main effect on its own.

## How to report it (APA 7)

Template: `There was a significant interaction between {factor1} and {factor2} on {outcome}, *F*({df1}, {df2}) = {F}, *p* = {p}, eta squared = {value}.`

Filled example: There was a significant interaction between Group and Session Length on posttest score, *F*(1, 8) = 9.14, *p* = .016, eta squared = .28.

## Common mistakes

Don't interpret a significant main effect while ignoring a significant interaction sitting right next to it, the interaction can completely change what a main effect means. Also don't run a factorial ANOVA when one of your factors is really a repeated measure of the same people, that calls for a mixed ANOVA instead.
