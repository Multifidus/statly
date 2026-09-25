---
id: power.t_test
title: "Power analysis for t-tests"
category: tests
summary: "Estimates how many participants you need to reliably detect a difference between two group means, or the smallest difference you could detect with the sample you already have."
related: [t_test.independent, t_test.paired, cohens_d]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

{{power_analysis}} for a t-test answers a planning question: how many people do you need in each group to have a good chance of detecting a real difference, if one exists? Statly's t-test power tool works for one-sample, independent-samples, and paired t-tests. It ties together four numbers: your sample size, the size of the effect you care about, your {{alpha}} level, and your {{power}}. Give Statly any three, and it solves for the fourth.

## When to use it

Use {{a_priori_power}} analysis before you collect any data, to figure out how many participants to recruit. Use {{sensitivity_analysis}} when your sample size is already fixed, maybe because of a funding limit or a class size, and you want to know the smallest effect that sample could reliably detect. Both use the same underlying math, just solved for a different unknown.

> **Before you collect data:** Run this analysis before you gather a single response, ideally as part of a Study Planner draft. Planning your sample size ahead of time means your study has a real chance of detecting the effect you're looking for, instead of guessing a number and hoping it's enough.

## An everyday analogy

Think about trying to hear a whisper across a noisy room. A bigger "sample" of listening, like leaning in closer or asking someone to repeat themselves, makes a faint signal easier to pick out from the noise. Power analysis is the same idea in numbers: a bigger sample size makes it easier to pick a real effect out of ordinary random noise in your data.

## A worked example

Suppose you're planning an independent-samples t-test comparing two teaching methods on a 10-point quiz (Scenario B). You want to detect a medium effect, *d* = 0.50, with 80% power at alpha = .05, two-tailed.

Using standard power tables, you'd need approximately N = 64 participants per group, about 128 total. That's the a priori answer.

Now imagine your school only lets you recruit 30 students per group. Running a sensitivity analysis instead, holding N = 30 per group, power = .80, and alpha = .05 fixed, Statly would tell you the smallest effect you could reliably detect is roughly *d* = 0.74, a fairly large effect. Anything smaller might slip past your test undetected, not because it isn't real, but because your sample is too small to catch it reliably.

## How to read the output

For an a priori analysis, Statly reports the recommended {{sample_size}} per group (or total, for a one-sample or paired design). For a sensitivity analysis, it reports the minimum detectable effect size given your fixed N. These numbers are approximate and software-computed. Small changes in your assumptions, like a slightly different alpha or a one-tailed instead of two-tailed test, can shift the recommended N noticeably.

Statly does not offer post hoc, or observed, power, calculated after the fact from your own study's *p*-value and effect size. This is a common practice, but it's mathematically circular: {{post_hoc_power_fallacy}} is just a rescaling of the *p*-value you already have, so it tells you nothing new about your study. Methods researchers widely consider it misleading, and Statly leaves it out on purpose.

## How to report it (APA 7)

Template: `A sample of N = {n} per group would provide {power}% power to detect {effect description} (d = {d}) at alpha = {alpha} (two-tailed).`

Filled example: A sample of N = 64 per group would provide 80% power to detect a medium effect (*d* = 0.50) at alpha = .05 (two-tailed).

## Common mistakes

Don't skip power analysis and pick a sample size out of habit or convenience, an underpowered study can miss real effects entirely. Don't confuse sensitivity analysis with post hoc power, sensitivity analysis is planned before you look at your results and is legitimate; post hoc power is calculated afterward from your own results and is not. Also don't treat the recommended N as exact, it's an estimate based on assumptions you're making about the true effect size, and real effects are never known in advance.
