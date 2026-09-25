---
id: mcdonald_omega
title: "McDonald's omega"
category: tests
summary: "A more flexible internal-consistency estimate that doesn't assume every item is equally good at measuring the trait."
related: [cronbach_alpha, kr20, split_half, descriptives, pearson]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

McDonald's omega, like {{internal_consistency}}, is a number that tells you how well a set of items measure one underlying trait. It answers the same basic question as Cronbach's alpha, but it doesn't assume the items are all equally strong measures. Instead, omega uses each item's own factor loading, a number showing how strongly that item connects to the underlying trait, so items that measure the trait better are weighted more heavily.

## When to use it

Use omega instead of alpha when your scale items probably aren't equally good indicators of the trait, which is common in real surveys. Because omega relaxes alpha's equal-item assumption, it's often considered the more accurate choice, especially when some items are clearly stronger or weaker than others.

## An everyday analogy

Picture a panel of 4 judges scoring a diving competition. Alpha treats every judge's score as equally trustworthy when combining them. Omega is more like giving more weight to the judges who have historically scored closest to the final consensus, and less to the judge who tends to be a bit off. Both approaches combine the scores, but omega accounts for the fact that not every judge is equally reliable.

## A worked example

Using the same 5-student, 4-item reading-confidence survey from the Cronbach's alpha page, Statly fits a single-factor model and estimates how strongly each item loads onto the reading-confidence trait: Item 1 = .70, Item 2 = .65, Item 3 = .55, Item 4 = .70.

Omega is calculated from those loadings:

Omega = (sum of loadings)² / [(sum of loadings)² + sum of (1 - loading²)]

Sum of loadings = .70 + .65 + .55 + .70 = 2.60, so (sum of loadings)² = 6.76

Sum of (1 - loading²) = (1 - .49) + (1 - .4225) + (1 - .3025) + (1 - .49) = .51 + .5775 + .6975 + .51 = 2.295

Omega = 6.76 / (6.76 + 2.295) = 6.76 / 9.055 = 0.75

## How to read the output

Statly reports omega on the same 0-to-1 scale as alpha, and it's judged against similar benchmarks: around .70 or higher is generally acceptable, and .80 or higher is good. Here, omega = .75, a bit lower than the alpha of .81 for the same data, because Item 3's weaker loading pulls the estimate down more than alpha's equal-weighting would show. When alpha and omega disagree by much, omega is usually the more trustworthy number.

## How to report it (APA 7)

Template: `The {scale name} showed {level} internal consistency (omega = {value}).`

Filled example: The 4-item reading-confidence scale showed acceptable internal consistency (omega = .75).

## Common mistakes

Don't assume omega will always be higher than alpha, it can go either way depending on the loading pattern. Don't skip checking the individual loadings either, a very low loading on one item (say, under .30) suggests that item may not belong on the scale at all, even if the overall omega still looks fine.
