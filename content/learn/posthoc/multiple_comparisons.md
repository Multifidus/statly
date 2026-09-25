---
id: multiple_comparisons
title: "Multiple Comparisons"
category: posthoc
summary: "Explains why running many statistical tests inflates your false-positive rate, and how to correct for it."
related: [posthoc.tukey, posthoc.pairwise, posthoc.dunn]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

The multiple comparisons problem is what happens when you run many statistical tests at once. Each individual test carries some risk of a {{type_i_error}}, a false positive, and that risk stacks up the more tests you run. Corrections for multiple comparisons exist to keep your overall risk of a false alarm at a reasonable level, even when you're testing many things.

## When to use it

Think about multiple comparisons any time you run more than one test on related data, comparing every pair of groups, checking every item on a survey, or testing several outcomes at once. It matters most in post hoc testing after ANOVA, but it applies just as much to any batch of related tests.

## An everyday analogy

Picture flipping a coin and calling it "rigged" if it lands heads five times in a row. Unlikely for one attempt, sure. But if you let ten different people each flip a coin five times, someone getting five heads in a row becomes a lot less surprising. Running many tests is like giving chance many separate opportunities to fool you, so you need a stricter bar for each individual result.

## A worked example

Imagine running 10 independent *t*-tests at alpha = .05, comparing 10 unrelated pairs of groups where there's truly no real difference in any of them. Each test has a 5% chance of a false positive on its own. The chance that at least one of the 10 comes out "significant" purely by chance is:

1 - (1 - .05)^10 = 1 - .60 = .40

That's a 40% chance of at least one false alarm, even though nothing real is going on anywhere. This is why running lots of comparisons without a correction is risky.

## How to read the output

Statly reports both the raw *p*-value for each comparison and an adjusted *p*-value after applying a correction. Always judge significance using the adjusted value. The three most common corrections work differently:

- **Bonferroni**: divides alpha by the number of comparisons. Simplest and most conservative. Good for a small number of comparisons where you want the strictest protection.
- **Holm**: a step-down version of Bonferroni that controls the same {{family_wise_error_rate}} but rejects more true effects. Usually the better default over plain Bonferroni.
- **Benjamini-Hochberg (FDR)**: controls the expected proportion of false positives among your significant results, not the chance of any false positive at all. Better when you have many comparisons, like item-level analyses across a long survey, and can tolerate a few false positives in exchange for more power.

## How to report it (APA 7)

Template: `To control for {number} comparisons, a {correction method} correction was applied; the corrected threshold for significance was {value}.`

Filled example: To control for 10 comparisons, a Holm correction was applied; comparisons with adjusted *p* < .05 were considered significant.

## Common mistakes

Don't report raw, uncorrected *p*-values when you ran many related comparisons, that overstates how much evidence you really have. Also don't reach for Bonferroni by default when you have a large number of comparisons, like 20 survey items, it becomes so conservative that you'll likely miss real effects; Benjamini-Hochberg is usually the better fit there.
