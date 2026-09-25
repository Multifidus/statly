---
id: normalized_gain_bands
title: "Normalized gain benchmark bands"
category: effect_sizes
summary: "Gives the low, medium, and high reference bands for Hake's normalized gain, and explains why to use them with caution."
related: [education.normalized_gain, education.gain_score]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Normalized gain benchmark bands are reference ranges for interpreting Hake's *g*, the {{normalized_gain}} statistic. They sort a mean normalized gain into one of three informal categories: low, medium, or high, based on how much of students' available room to improve they actually gained.

## When to use it

Use these bands after you've calculated a mean normalized gain for a group, and you want a rough sense of whether that gain is small, moderate, or large compared to typical results. They're most useful for a quick, shared vocabulary when comparing your own results to other reported studies that also use Hake's *g*.

## An everyday analogy

Think of grading on a curve for how much of a race someone closed rather than how fast they ran. Two runners can close very different shares of the distance between their starting point and the finish line. The bands give you rough language, like "closed most of the gap" versus "closed only a small part," without pretending every context and course is exactly the same.

## A worked example

A class has a mean normalized gain of g = 0.55 after a semester-long intervention (Scenario D, pre/post 0 to 100 test, fixed max = 100). Using the standard bands below, this falls in the medium range.

| Band | Range of g |
|---|---|
| Low | g < 0.3 |
| Medium | 0.3 <= g < 0.7 |
| High | g >= 0.7 |

A second class with g = 0.78 would fall in the high range, a third with g = 0.22 would fall in the low range.

## How to read the output

Statly reports your group's mean normalized gain alongside which band it falls into, based on the table above. A higher band suggests students closed a larger share of their available room to improve. These bands describe your result relative to a fixed scale from 0 to 1, not relative to other students or other groups directly, so two studies with the same band can still differ in real classroom terms.

## How to report it (APA 7)

Template: `The mean normalized gain fell in the {band} range, g = {g} (SD = {sd_g}).`

Filled example: The mean normalized gain fell in the medium range, g = 0.55 (*SD* = 0.19).

## Benchmarks (and why to be careful)

These bands, low below 0.3, medium from 0.3 to 0.7, and high at 0.7 and above, come from physics education research comparing traditional lectures to interactive teaching methods. They were never meant as a universal standard for every subject, age group, or type of assessment. As with any generic effect size label, education researchers should judge a normalized gain against results from similar programs in the same subject and setting, not just these three bands alone. A "medium" gain in one field or grade level might be an unusually strong result in another.

## Common mistakes

Don't treat these bands as fixed scientific cutoffs, they're rough, field-specific guidelines, not hard boundaries. Don't compare normalized gain bands across studies that used very different maximum possible scores or very different pretest difficulty, since {{ceiling_effect}}s and floor effects can distort g even after normalizing. Also don't report only the band without also reporting the actual g value, the band alone loses precision that readers may need.
