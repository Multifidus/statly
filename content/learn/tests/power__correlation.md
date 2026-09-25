---
id: power.correlation
title: "Power analysis for correlation"
category: tests
summary: "Estimates how many participants you need to reliably detect a Pearson correlation of a given size."
related: [correlation.pearson]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Power analysis for correlation tells you how many pairs of scores you need. It helps you detect a Pearson {{correlation}} of a given size. It links your target correlation, *r*, with your {{alpha}} level and your {{power}}. Give Statly two of these, and it solves for the sample size you need. Or flip the question around once your sample is fixed.

## When to use it

Use {{a_priori_power}} analysis before you collect data. This fits studies that look at the link between two continuous variables, like study hours and test scores. Use {{sensitivity_analysis}} when your sample size is already fixed. It tells you the weakest correlation your study could still detect.

> **Before you collect data:** Run this analysis before you gather a single response. Do it as part of a Study Planner draft. Correlation studies are easy to underpower, since real-world links are often modest. Planning your sample size ahead of time matters a lot here.

## An everyday analogy

Picture checking if taller people tend to have bigger shoe sizes. Look at just three or four people, and the pattern might look noisy. It could even look backwards, just by chance. Look at a hundred people instead. A real link becomes much easier to see through the noise.

## A worked example

Say you're planning a study on weekly study hours and a knowledge test score. You want to detect a medium correlation, *r* = 0.30. You want 80% power at alpha = .05, two-tailed.

Standard power tables say you'd need about N = 84 participants.

Say your class only has 40 students. A sensitivity analysis with N = 40 fixed would find the smallest correlation you could still detect. That's roughly *r* = 0.43, a fairly strong link. A weaker true link, say *r* = 0.20, could easily go undetected with only 40 students.

## How to read the output

For an a priori analysis, Statly reports the sample size you need. For a sensitivity analysis, it reports the smallest *r* you could detect. Both numbers are estimates. They depend on your chosen alpha, power, and target correlation. Statly does not report post hoc power based on the correlation you actually found. {{post_hoc_power_fallacy}} just restates your *p*-value in a new form. It adds no new information, which is why methods researchers warn against it.

## How to report it (APA 7)

Template: `A sample of N = {n} would provide {power}% power to detect {effect description} (r = {r}) at alpha = {alpha} (two-tailed).`

Filled example: A sample of N = 84 would provide 80% power to detect a medium correlation (*r* = 0.30) at alpha = .05 (two-tailed).

## Common mistakes

Don't assume a small pilot sample can confirm or rule out a correlation. Small samples give unstable estimates. They can look strong or weak just by chance. Don't mix up the smallest detectable *r* with the true correlation in your population. It only marks the limit of what your design can catch. Also remember that a correlation's real-world importance depends on context. A modest *r* can still matter a lot in an education setting.
