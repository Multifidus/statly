---
id: mcnemar
title: "McNemar's test"
category: tests
summary: "Checks whether a paired yes/no outcome changed, using the same people measured twice."
related: [chi_square_independence, fisher_exact, t_paired, wilcoxon_signed_rank, odds_ratio]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

McNemar's test checks whether a two-category outcome changed between two {{paired}} measurements on the same people, like pass/fail before and after a program. It's built for a 2x2 table too, but unlike the chi-square test of independence, the rows and columns aren't two separate groups, they're the same people's before-and-after answers. The test focuses only on the people whose answer switched, ignoring anyone whose answer stayed the same both times.

## When to use it

Use McNemar's test when you have one group of people measured twice on a yes/no or pass/fail outcome, and you want to know if the proportion answering "yes" changed from time one to time two. It's the categorical-outcome version of a paired t-test.

## An everyday analogy

Picture asking the same 20 people "do you support this policy?" before and after they watch a short video, then asking again afterward. You don't care about people who said yes both times or no both times, those didn't move. You care about how many switched from no to yes compared to how many switched from yes to no.

## A worked example

A researcher dichotomizes 20 students' scores from the linked pre/post gain-score study into pass/fail, before and after the program.

| | Post: Fail | Post: Pass | Row total |
|---|---|---|---|
| Pre: Fail | 5 | 8 | 13 |
| Pre: Pass | 2 | 5 | 7 |
| Column total | 7 | 13 | 20 |

The 5 students who failed both times and the 5 who passed both times don't count toward the test, only the 10 students who switched matter: 8 went from fail to pass, and 2 went from pass to fail. Using the continuity-corrected version, *chi*²(1) = (|8 - 2| - 1)² / (8 + 2) = 25/10 = 2.50, giving *p* = .114.

## How to read the output

Statly reports a {{chi_square_statistic}} (or an exact binomial *p*-value for small samples) and a {{p_value}}. A small *p*-value means the switches weren't balanced, meaningfully more people moved in one direction than the other. Here, *p* = .114 means this small sample doesn't provide strong evidence that pass rate truly shifted, even though more students moved from fail to pass than the reverse.

## How to report it (APA 7)

Template: `McNemar's test showed {a/no} significant change in {outcome} from {time1} to {time2}, *chi*²({df}) = {chi2}, *p* = {p}.`

Filled example: McNemar's test showed no significant change in pass rate from pretest to posttest, *chi*²(1) = 2.50, *p* = .114.

## Common mistakes

Don't run McNemar's test on data from two separate, unrelated groups, it only works when the same people are measured twice. Also don't forget that people whose answer didn't change carry no information for this test. A table with huge totals but very few people switching can still come back non-significant, and that's expected, not a bug.
