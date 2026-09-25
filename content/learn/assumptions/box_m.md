---
id: box_m
title: "Box's M Test"
category: assumptions
summary: "Checks that groups share a similar pattern of variances and covariances before running MANOVA or MANCOVA."
related: [manova, mancova, homogeneity_of_variance]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

The {{box_m_test}} checks an assumption behind MANOVA and MANCOVA. It asks if every group shares a similar pattern of spread across your outcome variables. This pattern is called the covariance matrix. Box's M is like a multivariate version of {{homogeneity_of_variance}}. It covers several outcomes at once, not just one.

## When to use it

Check Box's M before you trust a MANOVA or MANCOVA result. This matters most when your groups have very different sample sizes. Box's M tends to flag even tiny, unimportant differences when samples are large. Treat it as one piece of evidence, not the final word.

## An everyday analogy

Picture comparing three classrooms on a reading score and a writing score. In one classroom, students who read well also write well. That is a strong link between the two scores. In another classroom, reading and writing barely relate. Box's M asks if that link looks similar across all three classrooms.

## A worked example

A researcher plans a MANOVA on knowledge and confidence scores across Control, Intervention A, and Intervention B, with 5 students per group (Scenario B). Before interpreting the MANOVA, Statly runs Box's M on the covariance matrices of the three groups.

## How to read the output

Statly reports Box's M statistic, turned into an *F* value, with degrees of freedom and a *p*-value. A *p*-value above .05 means there's no strong evidence the covariance matrices differ. Statly's default multivariate test, Pillai's trace, is a safe pick here. For this example, Statly reports *F* = 1.85, *p* = .18. The assumption looks reasonable.

## What Statly checks

Statly compares the covariance matrix of your outcome variables across every group. It tests whether those matrices differ by more than chance would explain.

## What to do if it fails

If Box's M is significant, especially with unequal group sizes, lean on Pillai's trace. It holds up better than other multivariate test options when this assumption breaks. With very unequal sample sizes and a clearly significant Box's M, ask whether your groups differ in some basic way that still makes a multivariate comparison worthwhile.

## Common mistakes

Don't treat a significant Box's M as a reason to drop MANOVA right away. With large samples, it flags even small, unimportant differences. Also don't ignore it when your group sizes are quite unequal. That is exactly when covariance differences matter most.
