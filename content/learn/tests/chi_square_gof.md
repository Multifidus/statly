---
id: chi_square_gof
title: "Chi-square goodness-of-fit test"
category: tests
summary: "Checks whether one categorical variable's counts match a claimed or expected distribution."
related: [chi_square_independence, fisher_exact, cramers_v_phi, descriptives]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

The chi-square {{goodness_of_fit}} test checks whether the counts you observed for a single categorical variable match some claimed or expected pattern. Unlike the chi-square test of independence, which compares two variables to each other, this version compares one variable's observed counts against a set of expected counts you specify ahead of time.

## When to use it

Use this test when you have one categorical variable with two or more categories, and a specific expectation for how cases should be split among them, like an even split, or percentages from a past study. It's a good fit whenever you want to ask "does this match what I expected?" rather than "are these two things related?"

## An everyday analogy

Imagine a bag of colored candy that's supposed to be one-third each of red, yellow, and green. You count a handful and check whether the colors you actually pulled out roughly match that expected one-third split, or whether the bag seems stocked differently than advertised.

## A worked example

A school plans to enroll 30 students evenly across three teaching methods, 10 each. After sign-ups, the actual counts come out uneven:

| | Control | Intervention A | Intervention B | Total |
|---|---|---|---|---|
| Observed | 6 | 10 | 14 | 30 |
| Expected | 10 | 10 | 10 | 30 |

Adding up (observed - expected)² / expected for each group: (6-10)²/10 + (10-10)²/10 + (14-10)²/10 = 1.6 + 0 + 1.6 = 3.2. With {{degrees_of_freedom}} = (number of categories - 1) = 2, this gives *p* = .202.

## How to read the output

Statly reports *chi*²(df, *N*) and a {{p_value}}, the same way as the chi-square test of independence, but here it's comparing your one variable's counts to your stated expectation instead of to another variable. A small *p*-value would mean the actual split departs from what you expected by more than chance alone would explain. Here, *p* = .202 means this small sample's uneven enrollment isn't strong evidence that sign-ups truly favor one method.

## How to report it (APA 7)

Template: `The distribution of {variable} did {/not} differ significantly from the expected distribution, *chi*²({df}, *N* = {n}) = {chi2}, *p* = {p}.`

Filled example: The distribution of teaching method enrollment did not differ significantly from the expected even split, *chi*²(2, *N* = 30) = 3.20, *p* = .202.

## Common mistakes

Don't pick your expected counts after peeking at your data, decide what you expect to see before you count, otherwise the test loses its meaning. Also don't confuse this test with the chi-square test of independence. Goodness-of-fit checks one variable against a claimed pattern; independence checks two variables against each other.
