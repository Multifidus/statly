---
id: expected_cell_counts
title: "Expected cell counts"
category: assumptions
summary: "Checks whether a chi-square table's expected counts are big enough for the p-value to be trustworthy."
related: [chi_square_independence, fisher_exact]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Chi-square compares the counts you observed with the counts you'd expect if the two questions were unrelated. Those expected counts need to be big enough, usually at least 5 in most cells, for the p-value to be trustworthy.

## An everyday analogy

With tiny expected counts, the chi-square p-value can be off in either direction. Fisher's exact test works out the exact probability instead, so it stays accurate with small counts.

## What Statly checks

Statly works out the expected count for every cell in the table, the count you'd see there if the two variables were completely unrelated, and looks at the smallest one. If too many cells fall below 5, or any cell is extremely small, the chi-square p-value can no longer be trusted.

## What to do if it fails

Switch to Fisher's exact test, which works out the exact probability of your table instead of relying on a large-sample approximation, so it stays accurate even with small counts. If you have many categories, you can also try combining some of the smaller ones together before re-running the test.

## Common mistakes

Don't judge this by your total sample size alone, a large dataset can still have thin expected counts if it's split across many categories or groups. Also don't confuse expected counts with the counts you actually observed, this check is about the counts chi-square expects under the null hypothesis, not your raw data.
