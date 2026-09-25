---
id: posthoc.conover
title: "Conover's Test"
category: posthoc
summary: "A more powerful rank-based post hoc test after Friedman or Kruskal-Wallis, compared to Nemenyi."
related: [friedman, kruskal_wallis, posthoc.nemenyi]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Conover's test is a {{post_hoc}} test used after a significant Friedman test (or Kruskal-Wallis) to compare pairs of conditions using ranked data. It's built to be more powerful than the Nemenyi test, meaning it's better at catching real differences, while still controlling for the fact that you're running several comparisons at once.

## When to use it

Use Conover's test after a significant Friedman test on {{repeated_measures}} data, or after Kruskal-Wallis, when you want more power than Nemenyi provides and you're comfortable with a slightly less conservative correction. It's a good default choice for education researchers comparing several repeated conditions, like performance across three teaching methods used with the same class.

## An everyday analogy

Picture a cooking competition where the same panel of judges ranks three dishes at each of several dinners. Instead of comparing raw scores, which each judge might use differently, you compare how each dish tended to rank against the others across all the dinners. Conover's test is a sharper way of teasing apart which specific dishes differ in their typical ranking, compared to a more cautious method like Nemenyi.

## A worked example

A teacher has 6 students try three review methods across three weeks and rates confidence (1-5) after each. A Friedman test comes back significant, so the teacher runs Conover's test.

| Comparison | Test statistic | Adjusted *p* |
|---|---|---|
| Method A vs. Method B | 2.95 | .021 |
| Method A vs. Method C | 1.10 | .40 |
| Method B vs. Method C | 3.40 | .009 |

## How to read the output

Statly reports a test statistic and an adjusted *p*-value for every pair of conditions, based on their average ranks across participants. A pair with an adjusted *p*-value under .05 differs significantly in typical rank. Here, Method A differs from Method B, and Method B differs from Method C, but Method A and Method C look similar.

## How to report it (APA 7)

Template: `Conover's post hoc test showed that {condition1} and {condition2} differed significantly in rank, adjusted *p* = {p}.`

Filled example: Conover's post hoc test showed that Method B and Method C differed significantly in rank, adjusted *p* = .009.

## Common mistakes

Don't confuse Conover's test with Nemenyi's, they answer the same question but Conover's is less conservative and usually preferred once you already have a significant omnibus test. Also don't apply Conover's test to independent groups data measured only once, it's built for the repeated, ranked structure that comes from a Friedman design.
