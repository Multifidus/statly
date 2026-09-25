---
id: reliability.cronbach_alpha
title: "Cronbach's alpha"
category: tests
summary: "Estimates how consistently a set of scale items measure the same underlying thing."
related: [reliability.mcdonald_omega, reliability.kr20, reliability.split_half, descriptives, correlation.pearson]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Cronbach's alpha is a number between 0 and 1 that tells you how well a group of survey items hang together as one {{scale_score}}. It's a measure of {{internal_consistency}}: if people who score high on one item tend to score high on the others too, alpha is high. If the items don't move together, alpha is low. Alpha assumes the items are roughly equally good at measuring the trait, a condition statisticians call tau-equivalence.

## When to use it

Use Cronbach's alpha when you have several Likert-style or rating items that are meant to add up into a single score, like a reading-confidence scale, and you want to check that the items belong together before you trust the total. It works best when items use the same rating scale (for example, all 1 to 5) and any reverse-worded items have already been reverse-scored.

## An everyday analogy

Imagine four different bathroom scales weighing the same person one after another. If they're all well calibrated, they'll give you close to the same number each time. Cronbach's alpha checks whether your scale "items" are like well-calibrated scales, mostly agreeing with each other, instead of giving scattered, unrelated readings.

## A worked example

A teacher gives 5 students a 4-item reading-confidence survey after a new read-aloud program (1 = strongly disagree, 5 = strongly agree). One item was reverse-worded and has already been reverse-scored here.

| Student | Item 1 | Item 2 | Item 3 | Item 4 | Total |
|---|---|---|---|---|---|
| 1 | 3 | 3 | 2 | 4 | 12 |
| 2 | 4 | 4 | 3 | 4 | 15 |
| 3 | 5 | 4 | 4 | 5 | 18 |
| 4 | 4 | 5 | 4 | 5 | 18 |
| 5 | 4 | 4 | 2 | 2 | 12 |

Each item's sum of squared deviations from its own mean (its {{variance}}, unscaled) is: Item 1 = 2, Item 2 = 2, Item 3 = 4, Item 4 = 6. Added up, that's 14. The total score column (12, 15, 18, 18, 12) has a mean of 15 and a sum of squared deviations of 36.

Alpha = [*k* / (*k* - 1)] x [1 - (sum of item variances / total variance)], where *k* is the number of items:

Alpha = (4/3) x (1 - 14/36) = (4/3) x 0.611 = 0.81

## How to read the output

Statly reports one alpha value for the whole scale, usually alongside item-total correlations that show which items drag the score down. As a rough guide, .70 or higher is generally considered acceptable for research use, and .80 or higher is good. Here, alpha = .81, so the 4 items are measuring reading confidence fairly consistently as a group. Watch the {{item_total_correlation}} for each item too: an item with a low or negative correlation to the rest of the scale may need to be dropped or reworded.

## How to report it (APA 7)

Template: `The {scale name} showed {level} internal consistency (alpha = {value}).`

Filled example: The 4-item reading-confidence scale showed good internal consistency (alpha = .81).

## Common mistakes

Don't treat alpha as a measure of whether your scale is valid, it only checks consistency, not whether the items measure the right thing. Also don't chase a higher alpha by adding near-identical, repetitive items just to inflate the number. And remember that alpha computed on a tiny sample, like the 5 students here, is unstable. A real study needs a bigger sample before you trust the estimate.
