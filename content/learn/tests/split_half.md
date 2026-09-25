---
id: split_half
title: "Split-half reliability"
category: tests
summary: "Splits a scale into two halves and checks how closely the halves agree, corrected for the shorter length."
related: [cronbach_alpha, mcdonald_omega, kr20, descriptives, pearson]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Split-half reliability checks {{internal_consistency}} by dividing a scale's items into two halves, scoring each half separately, and correlating the two half-scores. If the scale is measuring one consistent thing, the two halves should tell a similar story about each person. Because splitting a scale in half throws away information, and shorter scales tend to look less reliable, the raw half-to-half correlation is adjusted upward using the {{spearman_brown_correction}} to estimate what reliability the full-length scale would have.

## When to use it

Use split-half reliability as a quick, simple alternative to Cronbach's alpha, especially when you want an easy way to sanity-check a scale without needing every item's variance. It works best when the scale has enough items to split evenly and the two halves are built to be similar in content and difficulty.

## An everyday analogy

Imagine cutting a 4-question quiz into two 2-question mini-quizzes, one made of the odd-numbered questions and one made of the even-numbered questions. If a student does well on one mini-quiz, they should usually do about as well on the other. Split-half reliability measures how often that actually happens, then adjusts the result to estimate reliability for the full, uncut quiz.

## A worked example

Using the same 5-student, 4-item reading-confidence survey from the Cronbach's alpha page, split the items into Half A (Items 1 and 2) and Half B (Items 3 and 4).

| Student | Half A | Half B |
|---|---|---|
| 1 | 6 | 6 |
| 2 | 8 | 7 |
| 3 | 9 | 9 |
| 4 | 9 | 9 |
| 5 | 8 | 4 |

Half A has a mean of 8 and Half B has a mean of 7. The correlation between the two halves comes out to *r* = .58. Applying the Spearman-Brown correction to estimate reliability for the full 4-item scale:

Corrected reliability = (2 x *r*) / (1 + *r*) = (2 x .58) / (1 + .58) = 1.16 / 1.58 = 0.73

## How to read the output

Statly reports both the raw half-to-half correlation and the Spearman-Brown corrected value. Always use the corrected value for judging the scale, since the raw correlation underestimates reliability for the full-length scale. Here, the corrected estimate of .73 is close to the alpha of .81 computed for the same data, which is a good sign, different reliability methods roughly agreeing with each other builds confidence in the result.

## How to report it (APA 7)

Template: `Split-half reliability, corrected with the Spearman-Brown formula, was {level} (*r* = {value}).`

Filled example: Split-half reliability, corrected with the Spearman-Brown formula, was acceptable (*r* = .73).

## Common mistakes

Don't just report the raw, uncorrected half-to-half correlation, it will make the scale look less reliable than it is. Also be careful how you split the items: splitting the first half of items from the second half can be misleading if item difficulty or content drifts across the scale. An odd/even split, or a random split, usually gives a fairer picture.
