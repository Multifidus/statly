---
id: validity.cfa
title: "Confirmatory factor analysis (CFA)"
category: tests
summary: "Tests whether survey items fit a specific, pre-planned structure of underlying factors."
related: [validity.efa, multivariate_normality]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Confirmatory factor analysis, or CFA, tests whether your survey data fit a specific structure that you decide on ahead of time, based on theory or an earlier exploratory factor analysis. Unlike EFA, you tell CFA exactly which items should load on which factor, and it tells you how well that planned structure matches the actual pattern in your data. Statly reports a set of {{model_fit_indices}} that summarize how good that match is, plus a standardized {{factor_loading}} for each item.

## When to use it

Use CFA once you already have a theory-driven or previously discovered factor structure and want to confirm it holds up in a new sample. It is common as a follow-up step after EFA, run on a fresh set of respondents, or when adapting an existing, published scale. If you are still exploring how many factors your items suggest, use EFA first instead.

## An everyday analogy

Picture handing an architect a finished blueprint and asking them to check whether a built house actually matches it, rather than asking them to design a floor plan from scratch by walking through the rooms. CFA works the same way: you supply the planned structure first, then Statly checks how well the real data matches that specific plan.

## A worked example

A researcher specifies that 4 reading-confidence items should all load on a single "Reading Confidence" factor (Scenario A, item level), based on an earlier EFA result.

Statly fits this iteratively, estimating the model that best reproduces the observed pattern of correlations among items. Here is what the output looks like:

| Fit index | Value | Good fit guideline |
|---|---|---|
| CFI | .97 | above .95 |
| RMSEA | .05 (90% CI [.01, .09]) | below .06-.08 |
| SRMR | .04 | below .08 |

| Item | Standardized loading |
|---|---|
| Q1 | .80 |
| Q2 | .84 |
| Q3 | .68 |
| Q4 | .76 |

## How to read the output

Statly reports several {{cfi_rmsea}} together, since no single number tells the whole story. CFI above about .95, RMSEA below about .06, and SRMR below about .08 are common signs of good fit, though researchers in different fields sometimes use slightly different cutoffs. Here, all three indices suggest the one-factor structure fits reasonably well. The standardized loadings show how strongly each item reflects the underlying factor. All four loadings here are well above .40, supporting the idea that these items genuinely measure one shared construct. A {{path_diagram}} in Statly's output shows these loadings visually as arrows from the factor to each item.

## How to report it (APA 7)

Template: `A confirmatory factor analysis of the {n}-item {scale name} showed acceptable fit, *&chi;²*({df}) = {chi2}, *CFI* = {cfi}, *RMSEA* = {rmsea} (90% CI [{lower}, {upper}]), *SRMR* = {srmr}.`

Filled example: A confirmatory factor analysis of the 4-item Reading Confidence scale showed acceptable fit, *&chi;²*(2) = 3.10, *CFI* = .97, *RMSEA* = .05 (90% CI [.01, .09]), *SRMR* = .04.

## Common mistakes

Don't run CFA to explore what structure fits best. That is what EFA is for. CFA only tells you how well one specific, pre-chosen structure fits, not what the best structure would have been. Also don't rely on a single fit index in isolation. A model can look acceptable on one index and poor on another, so report several together and interpret them as a set.
