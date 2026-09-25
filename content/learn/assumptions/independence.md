---
id: independence
title: "Independence"
category: assumptions
summary: "Checks that each observation is unrelated to the others, a design question you answer by thinking about how the data were collected, not by running a test."
related: [t_independent, chi_square_independence, anova_one_way, mcnemar]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Independence means each data point in your sample is unrelated to the others. One person's score shouldn't affect another person's score. This is different from the other assumptions here. You don't check it with a test on your finished data. You check it by thinking about your study design before you collect anything.

## When to use it

Think about independence any time you compare {{independent_groups}}, like with an independent-samples *t*-test, a one-way ANOVA, or a chi-square test. It gets broken in common ways: students clustered in one classroom, the same person measured twice but treated as two people, or friends who talked before answering a survey.

## An everyday analogy

Imagine asking 30 people to guess how many jellybeans are in a jar. But 10 of them sit together and whisper guesses to each other first. You end up with what looks like 30 opinions. Really, it's closer to 21 independent guesses plus two clusters of copied answers. Independence means avoiding that hidden copying, so each data point stands on its own.

## A worked example

A researcher compares a knowledge quiz across Control, Intervention A, and Intervention B groups. To keep the groups independent, each student is randomly put in just one group. Students take the quiz on their own, without talking to classmates in other groups. Now imagine a different setup: the same 10 students rotate through all three teaching methods, and each round is treated as a separate "group." That breaks independence, because the same students show up in every group.

## How to read the output

There's no *p*-value or test statistic for independence. Statly can't check it from your data alone, because it depends on how you collected the data, not on the numbers themselves. Instead, ask yourself: did each observation come from a different, unrelated source? Were people assigned to groups without overlap? Could one person's answer have shaped another person's answer?

## What Statly checks

Statly doesn't run a statistical check for independence, unlike the other assumption pages. Its job here is to remind you to confirm your design produces independent observations. No person should appear in more than one group. No shared influence, like sitting in the same classroom or copying answers, should link different observations together.

## What to do if it fails

If your observations aren't independent, for example the same students got measured more than once, don't force them into an independent-groups test. Use a design made for related data instead. Use a paired *t*-test or Wilcoxon signed-rank test for two related measurements. Use a repeated-measures ANOVA or Friedman test for three or more. Use McNemar's test for a paired yes/no outcome. If the problem comes from clustering, like several students from one classroom, say so clearly. Standard tests will likely make your results look more certain than they really are.

## Common mistakes

Don't assume random assignment alone guarantees independence. If people in different groups still talk to each other during the study, that contact can still link their answers. Also don't confuse independence with "no relationship between the variables you're studying." Those are different ideas. Independence is about how you collected the data, not about whether your variables are correlated.
