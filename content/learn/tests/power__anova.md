---
id: power.anova
title: "Power analysis for ANOVA"
category: tests
summary: "Estimates how many participants you need per group to reliably detect a difference among three or more group means."
related: [anova.one_way, cohens_f]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Power analysis for ANOVA asks the same planning question as it does for a t-test. But now you have three or more groups. It uses Cohen's *f*, an effect size scale built for ANOVA. It also uses the number of groups, your {{alpha}} level, and your target {{power}}. Together these give you the sample size you need per group. The same logic works for repeated-measures, mixed, and factorial designs too, using documented approximations for their extra structure.

## When to use it

Use an {{a_priori_power}} analysis before you collect data. This fits a study with three or more groups, when you want to know how many people to recruit. Use a {{sensitivity_analysis}} when your total sample size is already fixed. It tells you the smallest group difference your study could still detect.

> **Before you collect data:** Do this analysis in your planning stage. Ideally, use a Study Planner draft before you recruit anyone. A planned sample size gives your group comparison a real chance to catch a true difference. Otherwise you might be too small to notice one.

## An everyday analogy

Imagine three coaches each try a different training drill. You want to know if any drill gives a real edge. More players per team makes a true advantage easier to see against normal game-to-game ups and downs. Too few players, and a real edge can get lost in the noise.

## A worked example

Say you're planning a one-way ANOVA. It compares Control, Intervention A, and Intervention B on a knowledge test (Scenario B), three groups total. You want to detect a medium effect, *f* = 0.25, with 80% power at alpha = .05.

Standard power tables say you'd need about N = 52 people per group. That's about 156 total across the three groups.

Say your school can only provide 25 students per group, 75 total. A sensitivity analysis with that N fixed would find the smallest effect you could still detect. That's closer to *f* = 0.33, a bit larger than medium. A true medium effect might exist but go undetected at that size.

## How to read the output

For an a priori analysis, Statly reports the sample size you need per group. For a sensitivity analysis, it reports the smallest Cohen's *f* you could detect. Both are estimates, based on your group count, alpha, and power. As with any power analysis, Statly skips post hoc power, calculated from your own results after the study ends. {{post_hoc_power_fallacy}} just recycles what's already in your *p*-value. It adds nothing new, which is why it's poor practice.

## How to report it (APA 7)

Template: `A sample of N = {n} per group would provide {power}% power to detect {effect description} (f = {f}) among {k} groups at alpha = {alpha}.`

Filled example: A sample of N = 52 per group would provide 80% power to detect a medium effect (*f* = 0.25) among 3 groups at alpha = .05.

## Common mistakes

Don't assume the t-test rule of thumb for sample size fits ANOVA too. Adding groups changes the math. You need more total people as group count grows. Don't treat the minimum detectable effect from a sensitivity analysis as your actual effect. It's just the smallest effect your design could catch, not a prediction. Also don't apply one-way ANOVA numbers straight to a factorial or repeated-measures design. Check the documented approximation Statly uses for that design, since correlated or crossed measurements change the math.
