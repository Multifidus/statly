---
id: odds_ratio
title: "Odds ratio"
category: effect_sizes
summary: "Compares the odds of an outcome happening in one group to the odds in another, commonly used with pass/fail or yes/no results."
related: [chi_square.independence, fisher_exact, cramers_v_phi, mcnemar, descriptives]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

An odds ratio compares the odds of something happening, like passing a test, in one group versus another. An odds ratio of 1 means the odds are equal in both groups. Above 1 means the first group has higher odds, below 1 means lower odds.

## When to use it

Use an odds ratio whenever your outcome is a {{dichotomous_variable}}, like pass/fail or yes/no, and you want to compare two groups. It pairs naturally with a chi-square test of independence or Fisher's exact test on a 2x2 table.

## An everyday analogy

Imagine two vending machines that sometimes jam. If Machine A jams on 2 out of 5 tries and Machine B jams on 1 out of 5 tries, the odds ratio tells you how many times more, or less, likely a jam is on one machine compared to the other, as a single number.

## A worked example

Pass and fail counts for two groups, five students each (Scenario B):

| Group | Pass | Fail |
|---|---|---|
| Control | 2 | 3 |
| Intervention A | 4 | 1 |

Odds of passing in Control = 2/3. Odds of passing in Intervention A = 4/1.

Odds ratio = (Intervention A pass x Control fail) / (Intervention A fail x Control pass) = (4 x 3) / (1 x 2) = 12 / 2 = 6.00

## How to read the output

Statly reports the odds ratio alongside the chi-square or Fisher's exact test it came from. An odds ratio of 6.00 means the odds of passing in Intervention A were 6 times the odds of passing in Control. Odds ratios below 1 work the same way in reverse: an odds ratio of 0.50 means the odds were half as high.

## How to report it (APA 7)

Template: `The odds of {outcome} were higher in {group1} than {group2}, chi-square({df}, *N* = {n}) = {chi2}, *p* = {p}, *OR* = {or}.`

Filled example: The odds of passing were higher in Intervention A than Control, chi-square(1, *N* = 10) = 1.67, *p* = .197, *OR* = 6.00.

## Benchmarks (and why to be careful)

There's no single Cohen-style chart for odds ratios the way there is for *d* or *r*, since how big an odds ratio feels depends heavily on how common the outcome already is. An OR of 6.00 sounds dramatic, but with only five students per group, as in the example above, it comes from a very small difference in raw counts. Education researchers usually judge an odds ratio against results from similar programs and outcome rates in the same subject area, not a fixed number or a generic small/medium/large label.

## Common mistakes

Don't read an odds ratio as if it were a simple risk or probability ratio. "6 times the odds" is not the same statement as "6 times more likely to pass," especially when the outcome is common. Also watch which group is on top of the ratio, flipping the two groups gives you 1 divided by your original odds ratio, not its negative.
