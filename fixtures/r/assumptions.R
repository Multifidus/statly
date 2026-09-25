# Reference fixtures for stats/assumptions.py (called directly by the Python tests):
#   shapiro.test (Royston), nortest::lillie.test (Lilliefors KS: Dallal-Wilkinson p for p <= .10,
#   Stephens' modified-statistic polynomial otherwise), car::leveneTest (center = median =
#   Brown-Forsythe), and Q-Q plotting positions from qqnorm (ppoints: a = 3/8 if n <= 10 else 1/2).
# Scopes: a group level, "differences" (paired), or "overall".
if (!exists("R_DIR")) source(file.path(dirname(normalizePath(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))), "common.R"))
suppressPackageStartupMessages({ library(car); library(nortest) })

normal_recs <- function(x, scope) list(shapiro_rec(x, scope), lillie_rec(x, scope))

qq_rec <- function(x, scope) {
  x <- x[!is.na(x)]
  q <- stats::qqnorm(x, plot.it = FALSE)
  o <- order(q$x)
  list(scope = scope, theoretical = num(q$x[o]), sample = num(q$y[o]))
}

grouped_case <- function(case, dataset) {
  d <- load_dataset(dataset)
  keep <- !is.na(d$group)
  lv <- sort(unique(d$group[keep]))
  recs <- list(); qq <- list()
  for (l in lv) {
    x <- d$y[keep & d$group == l]
    recs <- c(recs, normal_recs(x, l))
    qq[[length(qq) + 1]] <- qq_rec(x, l)
  }
  if (length(lv) > 1) recs[[length(recs) + 1]] <- levene_rec(d$y, d$group)
  write_fixture("assumptions", case, list(
    analysis_id = "assumptions", case = case, dataset = dataset,
    request = req(list(outcome = list("y"), group = list("group"))),
    expected = list(assumptions = recs, qq = qq), error = NULL))
}

single_case <- function(case, dataset, column = "y") {
  d <- load_dataset(dataset)
  x <- d[[column]]
  write_fixture("assumptions", case, list(
    analysis_id = "assumptions", case = case, dataset = dataset,
    request = req(list(outcome = list(column))),
    expected = list(assumptions = normal_recs(x, "overall"), qq = list(qq_rec(x, "overall"))),
    error = NULL))
}

differences_case <- function(case, dataset) {
  d <- load_dataset(dataset)
  cc <- stats::complete.cases(d$pre, d$post)
  x <- d$pre[cc] - d$post[cc]
  write_fixture("assumptions", case, list(
    analysis_id = "assumptions", case = case, dataset = dataset,
    request = req(list(measures = list("pre", "post"))),
    expected = list(assumptions = normal_recs(x, "differences"), qq = list(qq_rec(x, "differences"))),
    error = NULL))
}

grouped_case("indep_basic", "indep_basic.csv")
grouped_case("indep_unequal", "indep_unequal.csv")
grouped_case("indep_small", "indep_small.csv")         # n = 5: smallest n lillie.test accepts
grouped_case("indep_ties", "indep_ties.csv")
grouped_case("indep_missing", "indep_missing.csv")
grouped_case("indep_constant_group", "indep_constant_group.csv")   # shapiro/lillie undefined in one group
single_case("one_sample", "one_sample.csv")
single_case("large_skewed", "large_skewed.csv")         # n > 100 branch of lillie.test
differences_case("paired_basic", "paired_basic.csv")
differences_case("paired_missing", "paired_missing.csv")

cat("assumption fixtures written\n")
