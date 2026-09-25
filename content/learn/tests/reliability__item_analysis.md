---
id: reliability.item_analysis
title: "Item analysis (difficulty and discrimination)"
category: tests
summary: "Checks how hard each test question is and whether it separates strong students from weak ones."
related: [reliability.cronbach_alpha, reliability.kr20]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Item analysis looks at each question on a right-or-wrong test, one at a time, and asks two things. First, how hard was it? That's {{item_difficulty}}, the proportion of students who got the item correct. Second, did it tell strong and weak students apart? That's {{item_discrimination}}, usually the correlation between getting that item right and scoring well on the rest of the test.

## When to use it

Use item analysis after giving a scored test with right or wrong answers, like a knowledge quiz graded against an answer key. It helps you find items that are too easy, too hard, or that confuse your best students more than your weaker ones. Run it alongside Cronbach's alpha or KR-20 when you want to improve a test, not just report one overall score.

## An everyday analogy

Think of a coach reviewing game film question by question, not just the final score. For each play, the coach asks: did most players get this right? And did the players who usually perform well also do well on this specific play? A play everyone gets right teaches you little. A play only your weakest players mess up on, while your best players nail it, is a good play for telling talent apart.

## A worked example

In Scenario B, 8 students take a 5-item quiz scored right (1) or wrong (0). Item 3 results, alongside each student's total score on the other 4 items:

| Student | Item 3 | Total (other items) |
|---|---|---|
| 1 | 1 | 4 |
| 2 | 1 | 4 |
| 3 | 1 | 3 |
| 4 | 0 | 2 |
| 5 | 1 | 3 |
| 6 | 0 | 1 |
| 7 | 0 | 1 |
| 8 | 1 | 4 |

Item difficulty for Item 3 is the proportion correct: 5 out of 8, or 0.63. That means it's a medium-difficulty item, not too easy or too hard.

Item discrimination compares the two groups: the 5 students who got Item 3 right averaged 3.6 on the rest of the test, while the 3 who got it wrong averaged 1.33. Students who answered Item 3 correctly also scored much higher overall, so this item separates stronger and weaker students well. Statly can compute this either as a point-biserial {{correlation}} or as this simple high-low group comparison.

## How to read the output

Statly reports a difficulty value between 0 and 1 for each item, along with a discrimination value. Difficulty near 0 means almost nobody got it right; near 1 means almost everyone did. Most test builders aim for difficulty somewhere between 0.3 and 0.8. Discrimination values run roughly from -1 to 1. A discrimination above about 0.3 is good, near 0 means the item doesn't separate strong from weak students, and a negative value is a warning sign: your weaker students are outscoring your stronger ones on that item, which usually means the item is flawed or miskeyed.

## How to report it (APA 7)

Template: `Item {number} had a difficulty of {p} and a discrimination index of {d}.`

Filled example: Item 3 had a difficulty of .63 and a discrimination index of .52.

## Common mistakes

Don't judge an item by difficulty alone. A very easy or very hard item can still have poor discrimination, and that's the bigger problem for telling students apart. Also don't run item analysis on a tiny pilot sample and treat the numbers as final. With only a handful of students, one or two unusual scores can swing both difficulty and discrimination a lot. Finally, remember a negative discrimination value usually points to a miskeyed or confusingly worded item, check the item itself before blaming the students.
