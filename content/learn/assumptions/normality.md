---
id: normality
title: "Normality"
category: assumptions
summary: "Checks whether your data follow a roughly bell-shaped, symmetric distribution before you run a test that assumes this."
related: [t_test.paired, t_test.one_sample, wilcoxon_signed_rank, outliers, homogeneity_of_variance]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

{{normality}} is the assumption that your data follow a roughly bell-shaped, symmetric pattern, the classic {{normal_distribution}} curve, with most values clustered near the middle and fewer values out toward the extremes. Many common tests, like the paired *t*-test or one-sample *t*-test, assume the data (or the differences between paired scores) look roughly like this.

## When to use it

Check normality before running a {{parametric}} test such as a *t*-test or ANOVA, especially with a small sample. With larger samples, these tests tend to hold up fine even when the data aren't perfectly normal, thanks to a statistical result called the central limit theorem, so the check matters most when *n* is small.

## An everyday analogy

Picture the heights of adults in a large city, plotted on a graph. Most people cluster near the average height, with fewer people as you move toward very short or very tall. That familiar hump shape is what a normal distribution looks like. Checking normality is just asking, does my data's shape look like that hump, or is it lopsided, flat, or piled up at one end?

## A worked example

A teacher records posttest reading-confidence scale totals (sum of 5 items, possible range 5-25) for 8 students after a read-aloud program: 14, 15, 15, 16, 16, 17, 18, 19.

The values cluster closely around the mean of 16.25, with a fairly even spread on either side and no extreme values pulling the distribution to one side. A histogram of these scores looks like a gentle hump rather than a lopsided pile, which is a good visual sign.

## How to read the output

Statly reports a Shapiro-Wilk test statistic (*W*) and a {{p_value}}, plus a {{qq_plot}}. A *p*-value above your {{alpha}} (usually .05) means the data don't look significantly different from normal. For this example, Statly reports *W* = .97, *p* = .89, so there's no evidence against normality. On the Q-Q plot, the points fall close to the diagonal reference line, another sign the assumption is reasonable here.

## What Statly checks

Statly runs the Shapiro-Wilk test and plots a Q-Q plot of your data. Shapiro-Wilk gets oversensitive with large samples, flagging tiny, unimportant departures from normality as statistically significant, so Statly shows you the Q-Q plot and histogram alongside the test rather than relying on the *p*-value alone. Always look at the plots, especially when *n* is large.

## What to do if it fails

If your data clearly fail the normality check, especially with a small sample, switch to the matching {{nonparametric}} test, such as the Wilcoxon signed-rank test in place of a paired *t*-test, or the sign test for a simpler alternative. You can also try transforming the data (for example, a log transform for strongly right-skewed values) and re-checking. With a large enough sample, a modest departure from normality often isn't a serious problem, note it as a limitation and proceed with the parametric test if the plots look reasonable.

## Common mistakes

Don't rely on the *p*-value alone, especially with big samples where even trivial wiggles can come out significant. Also don't confuse normality of your raw data with normality of the thing the test actually cares about, for a paired *t*-test, it's the differences between pairs that need to look roughly normal, not each set of scores on its own.
