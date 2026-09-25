---
id: power.chi_square
title: "Power analysis for chi-square tests"
category: tests
summary: "Estimates how many observations you need to reliably detect an association or a mismatch in proportions using a chi-square test."
related: [chi_square.independence, chi_square.goodness_of_fit, cohens_w]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Power analysis for chi-square tests tells you how many observations you need. It helps you detect a link between categories, or a mismatch between what you observed and what you expected. It uses Cohen's *w*, an effect size built for chi-square tests. It also uses the {{degrees_of_freedom}} of your table, your {{alpha}} level, and your target {{power}}. Together these give you the total sample size you need.

## When to use it

Use {{a_priori_power}} analysis before you collect data. This fits a study that compares category counts, like which study strategy students prefer across grade levels. Use {{sensitivity_analysis}} when your sample size is already fixed, maybe by the number of students in a school. It tells you the smallest link your study could still catch.

> **Before you collect data:** Run this analysis before you gather a single response. Do it as part of a Study Planner draft. Category-based studies often need bigger samples than continuous-outcome studies to catch the same real-world effect. Planning ahead matters even more here.

## An everyday analogy

Picture trying to tell if a die is loaded by rolling it only six times. Even a fair die can land unevenly in a few rolls. Roll it 600 times instead, and a real bias becomes much easier to spot against normal random variation.

## A worked example

Say you're planning a goodness-of-fit chi-square test. It compares observed responses to an expected even split across categories. You want to detect a medium effect, *w* = 0.30, with 80% power at alpha = .05.

Standard power tables for a goodness-of-fit test with a few degrees of freedom say you'd need about N = 88 observations total.

Say only 40 students are available to survey. A sensitivity analysis with N = 40 fixed would find the smallest effect you could still detect. That's closer to *w* = 0.44, a fairly large mismatch. A smaller true mismatch could go unnoticed with that sample.

## How to read the output

For an a priori analysis, Statly reports the total sample size you need. For a sensitivity analysis, it reports the smallest Cohen's *w* you could detect. Both depend on the degrees of freedom in your table. More categories or more grouping variables change how much data you need. Statly skips post hoc power, calculated from your own chi-square result after the fact. {{post_hoc_power_fallacy}} is tied directly to the *p*-value you already have. It adds nothing new, which is why it's misleading practice.

## How to report it (APA 7)

Template: `A sample of N = {n} would provide {power}% power to detect {effect description} (w = {w}) at alpha = {alpha}.`

Filled example: A sample of N = 88 would provide 80% power to detect a medium effect (*w* = 0.30) at alpha = .05.

## Common mistakes

Don't forget that chi-square power depends on your table's degrees of freedom. A bigger table with more categories usually needs more data to catch the same effect. Don't run a chi-square test on a small sample with expected cell counts under about 5. Low power isn't the only problem there, the test's results can also become unreliable. Also don't treat the smallest detectable *w* from a sensitivity analysis as the true size of the link in your population. It only marks the limit of what your sample size could catch.
