---
id: homogeneity_of_variance
title: "Homogeneity of variance"
category: assumptions
summary: "Checks whether groups being compared spread out by a similar amount before you trust a test that assumes equal spread."
related: [t_test.independent, anova.one_way, anova.welch, mann_whitney, sphericity]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

{{homogeneity_of_variance}} is the assumption that the groups you're comparing spread out, or vary, by about the same amount. It doesn't mean the groups need the same average, it means their scores should be similarly scattered around whatever average each group has. Some tests, like Student's independent-samples *t*-test and one-way ANOVA, assume this by default.

## When to use it

Check this assumption whenever you're comparing two or more independent groups with a *t*-test or ANOVA. It matters more when your groups are different sizes, an unequal-variance problem hurts accuracy more when one group also has far fewer people than another.

## An everyday analogy

Imagine three archers shooting at the same target. One archer's arrows land in a tight cluster near the bullseye. Another's are scattered loosely all over the target, even if their average shot is also near the center. Homogeneity of variance is about whether all your groups' scores are "clustered" about as tightly as each other, not just whether their averages match.

## A worked example

A researcher compares a 4-item quiz across three teaching methods, 4 students per group.

| Group | Scores | Mean | Variance |
|---|---|---|---|
| Control | 5, 6, 7, 8 | 6.5 | 1.67 |
| Intervention A | 6, 7, 7, 8 | 7.0 | 0.67 |
| Intervention B | 4, 9, 5, 10 | 7.0 | 8.67 |

The three groups have similar means, but very different spreads. Intervention B's scores range widely (4 to 10) while Intervention A's are tightly bunched (6 to 8). Intervention B's variance is more than 12 times larger than Intervention A's.

## How to read the output

Statly reports Levene's test (or the Brown-Forsythe version, which uses each group's median instead of its mean and holds up better when the data are skewed) as an *F*-statistic with a {{p_value}}. A *p*-value below your {{alpha}} means the groups' spreads are significantly different. For this example, Statly reports *F*(2, 9) = 5.81, *p* = .024, which is below .05, so the equal-variance assumption doesn't hold here.

## What Statly checks

Statly runs Levene's test (based on Brown-Forsythe by default) comparing how far each score sits from its own group's center. A significant result means the groups' variances differ enough that Student's *t*-test or standard ANOVA's equal-variance assumption is questionable.

## What to do if it fails

Switch to a version of the test that doesn't assume equal variances. For two groups, use Welch's *t*-test instead of Student's *t*-test. For three or more groups, use Welch's ANOVA instead of the standard one-way ANOVA. Both adjust the {{degrees_of_freedom}} to account for the unequal spread, and they're safe to use even when variances happen to be equal, so many statisticians recommend using them by default.

## Common mistakes

Don't assume equal sample sizes protect you from this problem, unequal variances can still distort results even with equal-sized groups, though the damage is usually worse when sizes differ too. Also don't skip this check just because your means look similar, as this example shows, groups can have nearly identical averages while spreading out very differently.
