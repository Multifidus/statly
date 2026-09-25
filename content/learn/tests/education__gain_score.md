---
id: education.gain_score
title: "Gain scores"
category: tests
summary: "Measures how much each student's score changed from before to after an intervention, by simple subtraction."
related: [t_test.paired, wilcoxon_signed_rank, education.normalized_gain]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

A {{gain_score}} is the simplest way to measure change. For each student, you subtract their pretest score from their posttest score: gain = post minus pre. A positive gain means the student improved, a negative gain means they scored lower the second time. Once you have a gain score for every student, you can look at the mean gain across the group, or test whether it's different from zero, or compare mean gains between groups.

## When to use it

Use gain scores when you've measured the same students on the same scale twice, once before an intervention and once after, and you want a simple, easy-to-explain summary of change. Gain scores work well as a first look at your data. To formally test whether the average gain is real and not just chance, pair a gain score with a {{paired}} t-test or a Wilcoxon signed-rank test, depending on whether your gains are roughly normally distributed.

## An everyday analogy

Picture stepping on a scale before and after a month of a new habit. The number that matters to you isn't either reading alone, it's the difference between them. A gain score does exactly that for test scores: it turns two numbers into one number that directly answers "how much did this change?"

## A worked example

Five students complete a 25-point reading-confidence survey before and after a semester-long program (Scenario A).

| Student | Pre | Post | Gain |
|---|---|---|---|
| 1 | 14 | 18 | 4 |
| 2 | 16 | 17 | 1 |
| 3 | 12 | 19 | 7 |
| 4 | 18 | 20 | 2 |
| 5 | 15 | 21 | 6 |

Mean gain = (4 + 1 + 7 + 2 + 6) / 5 = 4.00. On average, students' reading-confidence scores rose by 4 points. A paired t-test on these gain scores could then tell you whether a 4-point average gain is unlikely to happen by chance alone.

## How to read the output

Statly reports each student's gain score alongside the mean gain and {{standard_deviation}} of the gains across your group. A mean gain near zero suggests little overall change. A consistently positive mean gain, especially with a small spread, suggests most students improved by a similar amount. A large spread means some students gained a lot while others gained little or even declined, which is worth investigating separately.

## How to report it (APA 7)

Template: `Students showed a mean gain of {mean_gain} points (SD = {sd_gain}) from pretest (M = {m_pre}, SD = {sd_pre}) to posttest (M = {m_post}, SD = {sd_post}), t({df}) = {t}, p = {p}.`

Filled example: Students showed a mean gain of 4.00 points (*SD* = 2.35) from pretest (*M* = 15.00, *SD* = 2.24) to posttest (*M* = 19.00, *SD* = 1.58), *t*(4) = 3.80, *p* = .019.

## Common mistakes

Don't compare raw gain scores across students who started at very different pretest levels without considering ceiling effects, a student who started near the top of the scale has much less room to show a large gain than a student who started near the bottom. If your pretest scores vary a lot, consider {{normalized_gain}} instead, which adjusts for each student's starting point. Also don't use gain scores from two different scales or item sets for pre and post, the subtraction only makes sense if both measurements use exactly the same instrument.
