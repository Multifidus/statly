---
id: validity.efa
title: "Exploratory factor analysis (EFA)"
category: tests
summary: "Finds groups of survey items that seem to be measuring the same underlying idea, without assuming the grouping ahead of time."
related: [reliability.cronbach_alpha, validity.cfa]
reading_level_target: "8-10"
owner_reviewed: false
---

## What it is

Exploratory factor analysis, or EFA, looks at how a set of survey items correlate with each other and groups them into a smaller number of underlying factors. It is "exploratory" because you do not tell it ahead of time which items belong together. Statly reports a {{factor_loading}} for each item on each factor, a number that shows how strongly that item connects to the underlying factor.

## When to use it

Use EFA early in developing a survey or scale, when you are not sure how many underlying dimensions your items measure, or which items group together. It works best with a reasonably large sample, generally at least 100 respondents, since correlations between items get unstable with fewer cases. If you already have a specific, theory-based structure in mind and want to test whether your data fit it, use confirmatory factor analysis instead.

## An everyday analogy

Picture a stack of survey questions about a school reading program: some ask about enjoying reading, some ask about confidence with reading, and some ask about classroom behavior. EFA looks at which questions tend to rise and fall together across respondents, without being told the categories in advance, and groups them into a smaller number of underlying themes based on those patterns.

## A worked example

A researcher gives 4 reading-confidence survey items to a sample of students (Scenario A, item level). Before running EFA, Statly checks whether the items are even suitable for factor analysis.

| Item | Description |
|---|---|
| Q1 | I feel confident reading aloud |
| Q2 | I understand what I read |
| Q3 | I enjoy reading new books |
| Q4 | I can explain what I read to others |

Statly fits this iteratively across all respondents, since factor analysis estimates a whole correlation structure at once rather than something you would compute by hand. Here is what the output looks like:

| Check | Value |
|---|---|
| {{kmo}} | .81 |
| {{bartletts_test}} | *&chi;²*(6) = 142.30, *p* < .001 |

| Item | Factor 1 loading |
|---|---|
| Q1 | .78 |
| Q2 | .82 |
| Q3 | .65 |
| Q4 | .74 |

## How to read the output

Statly first reports the KMO value and Bartlett's test to check whether your data are suitable for factor analysis at all. A KMO above .60 and a significant Bartlett's test mean your items are correlated enough to proceed. Statly also shows a {{scree_plot}} and a {{parallel_analysis}} to help decide how many factors to keep, generally the point where the scree plot flattens out and where parallel analysis says real factors stop outperforming random noise. Once the number of factors is set, look at the loadings table: items with loadings above about .40 on a factor are considered part of that factor, and here all four items load strongly on a single Factor 1, suggesting they measure one shared underlying idea.

## How to report it (APA 7)

Template: `An exploratory factor analysis with {rotation type} rotation was conducted on {n} items. The KMO measure verified sampling adequacy, *KMO* = {kmo}, and Bartlett's test was significant, *&chi;²*({df}) = {chi2}, *p* {p_relation}. {n_factors} factor(s) were retained, explaining {percent}% of the variance.`

Filled example: An exploratory factor analysis with varimax rotation was conducted on 4 items. The KMO measure verified sampling adequacy, *KMO* = .81, and Bartlett's test was significant, *&chi;²*(6) = 142.30, *p* < .001. One factor was retained, explaining 58% of the variance.

## Common mistakes

Don't run EFA with a small sample, like fewer than 100 respondents. The loadings become unstable and can look different if you collected the data again. Also don't treat the factor labels EFA suggests as automatically meaningful. You choose the label based on what the grouped items seem to share in common, and a different researcher might name the same factor differently.
