---
id: reliability.kr20
title: "KR-20"
category: tests
summary: "Cronbach's alpha's special case for tests scored right or wrong instead of on a rating scale."
related: [reliability.cronbach_alpha, reliability.mcdonald_omega, reliability.split_half, descriptives]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

KR-20 (short for Kuder-Richardson Formula 20) measures {{internal_consistency}} for a test made of items scored as right or wrong, a {{dichotomous_variable}}, instead of items rated on a scale like 1 to 5. It's mathematically a special case of Cronbach's alpha: if you ran alpha on 0/1-scored items, you'd get the same answer as KR-20.

## When to use it

Use KR-20 for quizzes and tests where each question is marked correct (1) or incorrect (0), and you want to know whether the questions consistently separate stronger students from weaker ones. It isn't the right tool for Likert-style attitude items with more than two response options, use Cronbach's alpha or McDonald's omega for those instead.

## An everyday analogy

Think of a 4-question pop quiz. If the questions are all tapping the same skill, the students who get question 1 right should tend to get questions 2, 3, and 4 right too, and the students who struggle should struggle across the board. KR-20 checks how much that pattern actually holds, versus students' right and wrong answers looking scattered and unrelated from question to question.

## A worked example

A researcher gives a 4-item quiz to 5 students in the Control group (1 = correct, 0 = incorrect).

| Student | Item 1 | Item 2 | Item 3 | Item 4 | Total |
|---|---|---|---|---|---|
| 1 | 1 | 1 | 1 | 1 | 4 |
| 2 | 1 | 1 | 1 | 0 | 3 |
| 3 | 1 | 0 | 1 | 1 | 3 |
| 4 | 0 | 1 | 0 | 0 | 1 |
| 5 | 0 | 0 | 0 | 1 | 1 |

For each item, *p* is the share who got it right and *q* = 1 - *p*. All 4 items have *p* = 3/5 = .6 and *q* = .4, so *p* x *q* = .24 for each item, and the sum across items is .96.

The total scores (4, 3, 3, 1, 1) have a mean of 2.4 and a variance of 1.44 (using the population formula, dividing the sum of squared deviations by *n* = 5).

KR-20 = [*k* / (*k* - 1)] x [1 - (sum of *p* x *q* / total variance)] = (4/3) x (1 - 0.96/1.44) = (4/3) x 0.333 = 0.44

## How to read the output

Statly reports KR-20 on the same 0-to-1 scale as alpha, with similar rough guidelines: .70 or higher for research use, .80 or higher considered good. Here, KR-20 = .44 is on the low side, which mostly reflects the tiny 5-student sample used for this walkthrough. Reliability estimates from very small samples swing around a lot, so a real classroom quiz would need many more students before trusting the number.

## How to report it (APA 7)

Template: `The {test name} showed {level} internal consistency (KR-20 = {value}).`

Filled example: The 4-item quiz showed low internal consistency (KR-20 = .44) in this small pilot sample.

## Common mistakes

Don't use KR-20 on partial-credit or multi-point items, it only works for strictly right/wrong scoring. Also don't judge a test's quality from KR-20 alone on a small sample. A low estimate might mean the items truly don't hang together, or it might just mean the sample was too small to tell.
