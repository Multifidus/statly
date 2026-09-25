---
id: sphericity
title: "Sphericity"
category: assumptions
summary: "Checks whether the variances of the differences between every pair of repeated measurements are similar, before trusting a repeated-measures ANOVA."
related: [anova_rm, friedman, homogeneity_of_variance, epsilon_squared]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

{{sphericity}} is an assumption specific to {{repeated_measures}} designs with three or more time points or conditions. It says that if you take the difference scores between every possible pair of time points (time 1 minus time 2, time 1 minus time 3, time 2 minus time 3, and so on), those difference scores should all have roughly the same {{variance}}. It only comes up once you have three or more repeated measurements, with just two time points there's only one set of differences, so there's nothing to compare.

## When to use it

Check sphericity before running a {{repeated_measures}} ANOVA on data with three or more time points or conditions measured on the same people. It doesn't apply to a simple paired *t*-test, which only compares two measurements.

## An everyday analogy

Imagine tracking the same runners' lap times across four laps of a race. Sphericity asks whether the lap-to-lap changes (lap 1 to 2, lap 2 to 3, lap 1 to 3, and so on) are all about equally variable across runners. If the gap between lap 1 and lap 2 barely varies from runner to runner, but the gap between lap 1 and lap 4 varies wildly, that unevenness is exactly what sphericity checks for.

## A worked example

A researcher tracks 4 students in Intervention A on the same 4-item quiz at three points: pretest, posttest, and a follow-up test.

| Student | Pretest | Posttest | Follow-up |
|---|---|---|---|
| 1 | 5 | 7 | 6 |
| 2 | 6 | 8 | 7 |
| 3 | 4 | 6 | 7 |
| 4 | 5 | 9 | 8 |

The three sets of pairwise differences are: Posttest minus Pretest (2, 2, 2, 4), Follow-up minus Pretest (1, 1, 3, 3), and Follow-up minus Posttest (-1, -1, 1, -1). Their variances come out to 1.00, 1.33, and 1.00, which are close to each other, a good sign for sphericity.

## How to read the output

Statly reports Mauchly's test as a {{chi_square_statistic}} with a {{p_value}}. A *p*-value above your {{alpha}} means sphericity looks reasonable. For this example, Statly reports Mauchly's *W*, chi-square(2) = 0.69, *p* = .71, which is well above .05, so there's no evidence the assumption is violated here.

## What Statly checks

Statly runs Mauchly's test on the variances of the pairwise differences between your repeated measurements. Because Mauchly's test can miss real violations in small samples and overreact in others, Statly also reports the Greenhouse-Geisser and Huynh-Feldt corrections alongside it, adjusted versions of the repeated-measures ANOVA's degrees of freedom that stay accurate even when sphericity doesn't quite hold.

## What to do if it fails

If Mauchly's test is significant, don't panic and switch tests right away. First, apply the Greenhouse-Geisser correction (or Huynh-Feldt, which is less conservative and often preferred when the estimated correction factor is close to 1), Statly can apply these automatically. If the violation is severe or you'd rather sidestep the assumption entirely, switch to the Friedman test, a nonparametric alternative that works on ranks instead of raw scores and doesn't require sphericity.

## Common mistakes

Don't apply a repeated-measures ANOVA to three or more time points without checking sphericity first, an uncorrected violation can make your *p*-value too small and lead you to see a real effect that isn't there. Also don't forget that sphericity is irrelevant for a two-timepoint paired *t*-test, it's only a concern once you have three or more repeated conditions.
