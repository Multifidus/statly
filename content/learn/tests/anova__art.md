---
id: anova.art
title: "Aligned Rank Transform (ART) ANOVA"
category: tests
summary: "A nonparametric way to test factorial designs, including interactions, when your data can't be ranked with a simple test."
related: [anova.factorial, kruskal_wallis, friedman]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

The {{art_procedure}} is a nonparametric way to run a factorial ANOVA, including the interaction, when your data don't meet ANOVA's rules. Simple rank tests like Kruskal-Wallis can't test interactions between two factors. ART can. It transforms the data through a special {{rank_transform}} step, then runs an ordinary ANOVA on the transformed values.

## When to use it

Use ART ANOVA when you have a factorial design, meaning two or more categorical factors and maybe an interaction between them. Use it when your outcome is skewed, has outliers, or is ordinal rather than truly continuous. It works well in education research with small samples or Likert-based outcomes, where a normal factorial ANOVA would be risky.

## An everyday analogy

Picture judging a talent show with two categories, Age Group and Act Type. The scores from different judges are not on a consistent scale. Instead of trusting the raw scores, you convert every score to a rank first. This keeps the structure of both categories intact, so you can compare ranks fairly across groups. ART works the same way. It carefully aligns the data before ranking, so the interaction test still works.

## A worked example

A researcher studies posttest scores (0-10) by Group (Control vs. Intervention A) and Session Length (Short vs. Long), but the scores are skewed with a couple of extreme values (Scenario B).

| | Short | Long |
|---|---|---|
| Control | 3, 4, 4 | 4, 5, 5 |
| Intervention A | 5, 6, 20 | 7, 8, 8 |

That score of 20 would throw off a regular factorial ANOVA. Statly runs the aligned rank transform for you. It handles the alignment and ranking steps, then fits the ANOVA on the transformed data. The results come back in a familiar factorial ANOVA table.

## How to read the output

Statly reports the same layout as a factorial ANOVA. You get a main effect for each factor and an interaction, each with an *F* value, degrees of freedom, and a *p*-value. These are calculated on the aligned, ranked data. Read the table the same way you would read a factorial ANOVA table. A significant interaction still means you should follow up with simple effects, now computed on the ranked scale.

## How to report it (APA 7)

Template: `An aligned rank transform ANOVA showed a significant interaction between {factor1} and {factor2} on {outcome}, *F*({df1}, {df2}) = {F}, *p* = {p}.`

Filled example: An aligned rank transform ANOVA showed a significant interaction between Group and Session Length on posttest score, *F*(1, 8) = 7.02, *p* = .029.

## Common mistakes

Don't run a plain rank test like Kruskal-Wallis when you need an interaction test. It can't give you one. Also don't apply a simple rank transform to a factorial design by hand. The alignment step matters, and skipping it gives wrong results. This is why Statly handles the transformation for you instead of asking you to compute it.
