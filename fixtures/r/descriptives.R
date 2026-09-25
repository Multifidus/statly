# Reference fixtures for the `descriptives` analysis.
# SD/SE use n - 1; quartiles/IQR use quantile(type = 7) (R/numpy default); skewness and excess
# kurtosis use psych::describe(type = 2) = SAS/SPSS G1/G2 = scipy skew/kurtosis(bias = False).
# Missing data: pairwise, each variable uses every non-missing value in its cell.
if (!exists("R_DIR")) source(file.path(dirname(normalizePath(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))), "common.R"))
suppressPackageStartupMessages(library(psych))

empty <- setNames(list(), character(0))

desc_case <- function(case, dataset, vars, group = NULL, ci = 0.95) {
  d <- load_dataset(dataset)
  recs <- list()
  for (v in vars) {
    if (is.null(group)) {
      recs[[length(recs) + 1]] <- desc_rec(v, empty, d[[v]], ci)
    } else {
      g <- d[[group]]
      for (lv in sort(unique(g[!is.na(g)]))) {
        recs[[length(recs) + 1]] <- desc_rec(v, setNames(list(lv), group), d[[v]][!is.na(g) & g == lv], ci)
      }
    }
  }
  roles <- list(variables = as.list(vars))
  if (!is.null(group)) roles$group <- list(group)
  write_fixture("descriptives", case, list(
    analysis_id = "descriptives", case = case, dataset = dataset,
    request = req(roles, empty, ci_level = ci),
    expected = list(descriptives = recs), error = NULL))
}

desc_case("basic", "indep_basic.csv", "y")
desc_case("grouped", "indep_basic.csv", "y", group = "group")
desc_case("missing_grouped", "indep_missing.csv", "y", group = "group")
desc_case("small_n", "one_sample_small.csv", "y")
desc_case("constant", "constant.csv", "y")
desc_case("ties_grouped", "indep_ties.csv", "y", group = "group")
desc_case("large_skewed", "large_skewed.csv", "y", ci = 0.99)
desc_case("pairwise_missing", "paired_missing.csv", c("pre", "post"))
desc_case("single_group", "indep_single_group.csv", "y", group = "group")

# Frequencies of a categorical (string) variable, including the missing row (value = null).
local({
  dataset <- "indep_missing.csv"
  d <- load_dataset(dataset)
  g <- d$group
  n <- length(g); n_valid <- sum(!is.na(g))
  lv <- sort(unique(g[!is.na(g)]))
  levels_ <- lapply(lv, function(l) {
    k <- sum(g == l, na.rm = TRUE)
    list(value = l, count = k, percent = 100 * k / n, valid_percent = 100 * k / n_valid)
  })
  levels_[[length(levels_) + 1]] <- list(value = NULL, count = sum(is.na(g)),
                                         percent = 100 * sum(is.na(g)) / n, valid_percent = NULL)
  write_fixture("descriptives", "frequencies", list(
    analysis_id = "descriptives", case = "frequencies", dataset = dataset,
    request = req(list(variables = list("group")), empty),
    expected = list(frequencies = list(list(variable = "group", group = empty, levels = levels_))),
    error = NULL))
})

cat("descriptives fixtures written\n")
