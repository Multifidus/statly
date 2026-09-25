---
id: correlation.partial
title: "Partial correlation"
category: tests
summary: "Measures the relationship between two variables after removing the influence of a third variable."
related: [correlation.pearson, correlation.matrix, regression.linear]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

A {{partial_correlation}} measures how strongly two variables relate to each other. It removes the shared influence of a third variable first, called a {{covariate}}. An ordinary correlation between two variables can be misleading if both are also connected to something else. Partial correlation strips that third variable's influence out of both variables. Then it correlates what's left.

## When to use it

Use partial correlation when you suspect a third variable might be driving, or partly driving, the relationship between your two main variables. For example, a knowledge-test score and time spent on homework might both be related to a student's prior achievement. You'd want to see if the score-homework link holds up once prior achievement is accounted for. It works with {{continuous}} variables. It assumes a roughly {{linear_relationship}} between each pair.

## An everyday analogy

Picture noticing that people who own more umbrellas also own more raincoats, so it looks like buying one causes you to buy the other. But both are really driven by a third thing: how much it rains where you live. Partial correlation is like asking, if everyone lived somewhere with the exact same rainfall, would umbrellas and raincoats still go together? Removing rainfall's influence shows the true, direct relationship, if any, between the other two.

## A worked example

In Scenario B, a researcher has a knowledge-test score, hours of tutoring, and a prior-achievement score for 8 students, and wants to know if tutoring hours relate to test score once prior achievement is accounted for.

| Student | Test score | Tutoring hours | Prior achievement |
|---|---|---|---|
| 1 | 12 | 2 | 60 |
| 2 | 14 | 3 | 65 |
| 3 | 16 | 3 | 75 |
| 4 | 18 | 5 | 80 |
| 5 | 13 | 2 | 62 |
| 6 | 17 | 4 | 78 |
| 7 | 15 | 3 | 70 |
| 8 | 19 | 5 | 85 |

The plain correlation between test score and tutoring hours is *r* = .95. That looks huge, but prior achievement is also strongly linked to both. Statly first finds each variable's correlation with prior achievement. Then it uses those to remove prior achievement's shared influence from both test score and tutoring hours. Only then does it correlate what remains. The partial correlation drops to *r* = .61. That's still a solid relationship, but noticeably smaller once prior achievement is controlled for.

## How to read the output

Statly reports the partial correlation coefficient, its degrees of freedom, and a {{p_value}}. It also shows the plain, uncontrolled correlation for comparison. If the partial correlation is much smaller than the plain one, the third variable was doing a lot of the work in the original relationship. If the two values are close, the covariate wasn't explaining much. Here, the drop from .95 to .61 shows prior achievement accounts for part, but not all, of the tutoring-score link.

## How to report it (APA 7)

Template: `Controlling for {covariate}, {variable1} and {variable2} were {significantly/not significantly} correlated, *r*({df}) = {value}, *p* = {p}.`

Filled example: Controlling for prior achievement, tutoring hours and test score were significantly correlated, *r*(5) = .61, *p* = .108.

## Common mistakes

Don't control for a variable that's actually a result of one of your two main variables, rather than a separate cause of both. That can remove a real relationship instead of a confound. Also don't assume a partial correlation proves the covariate explains the whole story. Other unmeasured variables could still matter. And remember: partial correlation, like ordinary correlation, only captures linear relationships. It can miss a real curved pattern between variables.
