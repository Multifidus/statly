---
id: multivariate_normality
title: "Multivariate Normality"
category: assumptions
summary: "Checks that your combined set of outcome variables follows a roughly bell-shaped, multi-dimensional pattern."
related: [normality, manova, validity.cfa]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

{{multivariate_normality}} extends {{normality}} to two or more outcome variables at once. It is not enough for each outcome to look normal on its own. This assumption also asks if the combined set of outcomes follows a bell-shaped pattern together. Tests like MANOVA and confirmatory factor analysis rely on it.

## When to use it

Check this assumption before you trust a MANOVA, MANCOVA, or confirmatory factor analysis. It matters most with small samples. Like plain normality, larger samples make these tests more forgiving of small departures.

## An everyday analogy

Picture plotting height against weight for a group of people. Each variable alone might look like a normal bell curve. But plotted together, you might see two separate clusters, a pattern neither variable shows alone. Multivariate normality asks if the combined picture, not just each single measure, looks like the expected bell-shaped cloud.

## A worked example

A researcher plans a MANOVA on knowledge and confidence scores across three groups (Scenario B). Before trusting the result, Statly checks whether the combined pattern of the two outcomes looks multivariate normal.

## How to read the output

Statly reports a multivariate normality test statistic and a {{p_value}}. It also shows a plot of each case's {{mahalanobis_distance}}, which shows how far a data point sits from the center of the combined outcomes. A large *p*-value, like *p* = .42 here, means no strong evidence against multivariate normality. Points far out on the distance plot are worth a closer look as possible multivariate outliers.

## What Statly checks

Statly tests the joint pattern of your outcome variables together, not each one alone. It flags cases with an unusually large combined distance from the group center.

## What to do if it fails

If this assumption clearly fails, especially with a small sample, treat multivariate results with caution. Look for outlier cases that might be driving the problem, using the distance plot as a guide. Removing or checking one extreme case sometimes fixes the issue. With larger samples, a small departure is often fine, especially if you use Pillai's trace, which holds up better than other options here.

## Common mistakes

Don't assume that because each outcome passed its own normality check, the combined set does too. Multivariate normality is a separate, stricter test. Also don't skip the outlier plot in favor of the *p*-value alone. One extreme case can distort a multivariate test even when the *p*-value looks fine.
