---
id: education.normalized_gain
title: "Normalized gain (Hake's g)"
category: tests
summary: "Measures how much of the possible room to improve a student actually gained, adjusting for how high their pretest score already was."
related: [education.gain_score, normalized_gain_bands]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

{{normalized_gain}}, often called Hake's *g*, adjusts a simple gain score for how much room each student had to grow. A student who scores 90 out of 100 on the pretest can gain at most 10 more points, while a student who scores 40 out of 100 could gain up to 60. Normalized gain divides the actual gain by the possible gain: g = (post - pre) / (max possible - pre). The result is a proportion between 0 and 1 that reflects how much of the available room each student actually filled.

## When to use it

Use normalized gain instead of a plain {{gain_score}} whenever students start at noticeably different pretest levels, especially when some scores are already close to the top of the scale, a {{ceiling_effect}} that limits how much a plain gain score can capture. Normalized gain requires a fixed, known maximum possible score, so it works best with tests that have a clear top score, like a 0 to 100 point knowledge test.

> **Before you collect data:** Make sure your pretest and posttest use identical scales, identical items, and identical scoring before you begin. If you plan to calculate normalized gain, also fix the maximum possible score ahead of time, since the formula depends on knowing that ceiling in advance.

## An everyday analogy

Picture two runners training for a race. One shaves 2 seconds off a time that was already near the world record, the other shaves 2 seconds off a much slower time. The raw improvement looks the same, 2 seconds, but the first runner had far less room to improve. Normalized gain is a way of crediting both runners fairly for how much of their available room they closed.

## A worked example

Four students complete a 0 to 100 knowledge test before and after a unit (Scenario D). The maximum possible score is fixed at 100.

| Student | Pre | Post | Gain | Possible gain (100 - pre) | Normalized gain g |
|---|---|---|---|---|---|
| 1 | 40 | 70 | 30 | 60 | 0.50 |
| 2 | 80 | 95 | 15 | 20 | 0.75 |
| 3 | 50 | 60 | 10 | 50 | 0.20 |
| 4 | 60 | 85 | 25 | 40 | 0.63 |

Student 2 gained fewer raw points than Student 1, but closed a much larger share of their remaining room to grow, so their normalized gain is higher. Averaging the four g values gives a mean normalized gain of about 0.52, in the medium range.

## How to read the output

Statly reports each student's normalized gain alongside the group mean. Values run from 0 (no improvement relative to available room) to 1 (a perfect score reached from wherever the student started). Informally, mean g above about 0.7 is often called high, 0.3 to 0.7 medium, and below 0.3 low, though these labels come from physics education research and should be checked against benchmarks for your own field. See the normalized gain benchmark page for the full bands and important caveats about using them.

## How to report it (APA 7)

Template: `The mean normalized gain was g = {g} (SD = {sd_g}), based on a pretest M = {m_pre} and posttest M = {m_post} (max possible = {max}).`

Filled example: The mean normalized gain was g = 0.52 (*SD* = 0.23), based on a pretest *M* = 57.50 and posttest *M* = 77.50 (max possible = 100).

## Common mistakes

Don't calculate normalized gain without a clearly fixed maximum possible score decided in advance, changing the max after the fact changes every student's g value. Don't use normalized gain when pretest scores are already very close to the maximum for most students, dividing by a tiny possible gain can produce unstable, extreme g values. Also don't treat Hake's bands as universal cutoffs, they were developed in one field and one context, and other fields may need their own benchmarks.
