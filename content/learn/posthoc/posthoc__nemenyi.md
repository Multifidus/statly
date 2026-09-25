---
id: posthoc.nemenyi
title: "Nemenyi Test"
category: posthoc
summary: "A conservative post hoc test for comparing pairs of conditions after a significant Friedman test."
related: [friedman, posthoc.conover, multiple_comparisons]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

The Nemenyi test is a {{post_hoc}} test used after a significant Friedman test to compare every pair of repeated conditions. It's a rank-based test, similar in spirit to Tukey HSD, but built for the repeated-measures, ranked design that Friedman tests use, and it's on the conservative side, meaning it's cautious about calling a difference significant.

## When to use it

Use the Nemenyi test after a significant Friedman test when you want a simple, well-established, conservative follow-up test. It's a reasonable default, though Conover's test usually detects real differences more often if you're comparing a modest number of conditions and want more power.

## An everyday analogy

Picture the same group of students rating three different study apps, each app used for one week. A Friedman test tells you the apps aren't rated equally overall. Nemenyi steps in to ask, cautiously, which specific pairs of apps differ, setting a fairly high bar before calling any one comparison a real difference.

## A worked example

A teacher has 6 students try three review methods across three weeks and rate confidence (1-5) after each. A Friedman test comes back significant, so the teacher runs the Nemenyi test.

| Comparison | Rank sum difference | *p* (adjusted) |
|---|---|---|
| Method A vs. Method B | 7 | .06 |
| Method A vs. Method C | 3 | .49 |
| Method B vs. Method C | 10 | .015 |

## How to read the output

Statly reports the difference in summed ranks for each pair and an adjusted *p*-value. Only the Method B vs. Method C comparison falls below .05 here. Notice this is more cautious than Conover's test on the same data, Nemenyi needs a bigger gap in ranks before calling a pair significant.

## How to report it (APA 7)

Template: `A Nemenyi post hoc test showed that {condition1} and {condition2} differed significantly in rank, adjusted *p* = {p}.`

Filled example: A Nemenyi post hoc test showed that Method B and Method C differed significantly in rank, adjusted *p* = .015.

## Common mistakes

Don't assume a non-significant Nemenyi result means there's no real difference, its conservative nature means it sometimes misses real, smaller effects that a more powerful test like Conover's would catch. Also don't run it without a significant Friedman test first.
