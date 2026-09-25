# Shared helpers for the R reference-fixture harness (SPEC §12). Dev only, never shipped.
# Every script sources this file; run everything with `Rscript fixtures/r/run_all.R`.
suppressPackageStartupMessages({
  library(jsonlite)
})

.script_dir <- function() {
  arg <- grep("^--file=", commandArgs(trailingOnly = FALSE), value = TRUE)
  if (length(arg)) return(dirname(normalizePath(sub("^--file=", "", arg[1]))))
  if (!is.null(sys.frames()[[1]]$ofile)) return(dirname(normalizePath(sys.frames()[[1]]$ofile)))
  normalizePath("fixtures/r")
}

R_DIR <- .script_dir()
REPO <- normalizePath(file.path(R_DIR, "..", ".."))
EXPECTED <- file.path(REPO, "fixtures", "expected")
DATA_DIR <- file.path(EXPECTED, "data")

# Packages whose versions are recorded in every fixture.
FIXTURE_PACKAGES <- c("stats", "effectsize", "car", "psych", "nortest", "jsonlite")

r_versions <- function() {
  pk <- lapply(FIXTURE_PACKAGES, function(p) {
    tryCatch(as.character(utils::packageVersion(p)), error = function(e) NA_character_)
  })
  names(pk) <- FIXTURE_PACKAGES
  list(r_version = R.version.string, packages = pk)
}

# Non-finite numbers (Inf, NaN, NA) become JSON null; the contract uses null for "not available".
num <- function(x) {
  if (is.null(x) || length(x) == 0) return(NULL)
  x <- unname(as.numeric(x))
  if (length(x) == 1) return(if (is.finite(x)) x else NULL)
  lapply(x, function(v) if (is.finite(v)) v else NULL)
}

# Read a dataset CSV exactly as the Python tests do (blank cell = missing).
load_dataset <- function(name) {
  utils::read.csv(file.path(DATA_DIR, name), stringsAsFactors = FALSE, na.strings = c(""),
                  check.names = FALSE)
}

write_dataset <- function(df, name) {
  utils::write.csv(df, file.path(DATA_DIR, name), row.names = FALSE, na = "")
}

# Write fixtures/expected/<analysis_dir>/<case>.json.
# `fixture` must contain analysis_id, case, dataset, request, expected (or error).
write_fixture <- function(analysis_dir, case, fixture) {
  out_dir <- file.path(EXPECTED, analysis_dir)
  dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
  fixture$r <- r_versions()
  json <- jsonlite::toJSON(fixture, auto_unbox = TRUE, digits = NA, null = "null", na = "null",
                           pretty = TRUE)
  writeLines(json, file.path(out_dir, paste0(case, ".json")))
  invisible(NULL)
}

# Request fragment echoed into every fixture (the Python test builds an AnalysisRequest from it).
req <- function(variables, options = setNames(list(), character(0)), tails = "two_sided",
                ci_level = 0.95, alpha = 0.05) {
  list(variables = variables, options = options, tails = tails, ci_level = ci_level, alpha = alpha)
}

r_alternative <- function(tails) switch(tails, two_sided = "two.sided", greater = "greater", less = "less")

# ---- expected-record builders (the shapes engine/tests/stats/conftest.py walks) ----
stat_rec <- function(key, value, df = numeric(0), p = NULL, term = NULL) {
  list(key = key, value = num(value), df = if (length(df)) lapply(unname(as.numeric(df)), num) else list(),
       p = num(p), term = term)
}

es_rec <- function(key, value, lower = NULL, upper = NULL) {
  list(key = key, value = num(value), ci_lower = num(lower), ci_upper = num(upper))
}

# Descriptives of one cell, matching stats/descriptives.py conventions:
# SD/SE with n-1; quartiles quantile(type = 7); skew/kurtosis psych type = 2 (= scipy bias=False, SPSS);
# CI of the mean from t.test (two-sided, ci_level).
desc_rec <- function(variable, group, x_all, ci_level = 0.95, n_missing = NULL) {
  x <- x_all[!is.na(x_all)]
  if (is.null(n_missing)) n_missing <- sum(is.na(x_all))
  n <- length(x)
  d <- if (n > 0) psych::describe(x, type = 2, IQR = TRUE) else NULL
  q <- if (n > 0) stats::quantile(x, c(0.25, 0.75), type = 7, names = FALSE) else c(NA, NA)
  ci <- if (n > 1 && stats::sd(x) > 0) stats::t.test(x, conf.level = ci_level)$conf.int else c(NA, NA)
  if (n > 1 && stats::sd(x) == 0) ci <- c(mean(x), mean(x))
  list(
    variable = variable, group = group, n = n, n_missing = n_missing,
    mean = num(if (n) mean(x) else NA), sd = num(if (n > 1) stats::sd(x) else NA),
    se = num(if (n > 1) stats::sd(x) / sqrt(n) else NA),
    ci_lower = num(ci[1]), ci_upper = num(ci[2]),
    median = num(if (n) stats::median(x) else NA), q1 = num(q[1]), q3 = num(q[2]),
    iqr = num(q[2] - q[1]), min = num(if (n) min(x) else NA), max = num(if (n) max(x) else NA),
    skewness = num(if (!is.null(d) && n > 2) d$skew else NA),
    kurtosis = num(if (!is.null(d) && n > 3) d$kurtosis else NA)
  )
}

# ---- assumption records ----
shapiro_rec <- function(x, scope) {
  x <- x[!is.na(x)]
  r <- tryCatch(stats::shapiro.test(x), error = function(e) NULL)
  list(test = "shapiro_wilk", scope = scope, n = length(x),
       statistic = if (is.null(r)) NULL else num(r$statistic),
       p = if (is.null(r)) NULL else num(r$p.value), df = list())
}

lillie_rec <- function(x, scope) {
  x <- x[!is.na(x)]
  r <- tryCatch(nortest::lillie.test(x), error = function(e) NULL)
  if (!is.null(r) && !is.finite(r$statistic)) r <- NULL
  list(test = "ks_lilliefors", scope = scope, n = length(x),
       statistic = if (is.null(r)) NULL else num(r$statistic),
       p = if (is.null(r)) NULL else num(r$p.value), df = list())
}

# car::leveneTest default center = median, i.e. the Brown-Forsythe variant.
levene_rec <- function(y, g, scope = "overall") {
  keep <- !is.na(y) & !is.na(g)
  r <- car::leveneTest(y[keep], factor(g[keep]), center = median)
  list(test = "levene_brown_forsythe", scope = scope, n = sum(keep),
       statistic = num(r[["F value"]][1]), p = num(r[["Pr(>F)"]][1]),
       df = list(num(r[["Df"]][1]), num(r[["Df"]][2])))
}

# ---- exact noncentral-t CI (reference for effectsize's noncentral-t intervals) ----
# effectsize:::.get_ncp_t finds the ncp bounds with Nelder-Mead (optim, abstol 1e-9), which can stop
# short of the root (e.g. t = 2.5, df = 20: lower ncp 0.3562 vs exact 0.3673). The fixtures therefore
# record the exact inversion (uniroot, tol 1e-13) as the reference CI and keep effectsize's own
# bounds alongside as effectsize_ci_lower / effectsize_ci_upper for information.
ncp_t_exact <- function(t, df, ci = 0.95, alternative = "two.sided") {
  if (!is.finite(t) || !is.finite(df)) return(c(NA, NA))
  level <- if (alternative == "two.sided") ci else 2 * ci - 1
  a <- 1 - level
  solve <- function(p) {
    f <- function(ncp) suppressWarnings(stats::pt(t, df, ncp)) - p
    w <- 5 + abs(t)
    stats::uniroot(f, c(t - w, t + w), extendInt = "downX", tol = 1e-13, maxiter = 5000)$root
  }
  out <- c(solve(1 - a / 2), solve(a / 2))
  if (alternative == "greater") out[2] <- Inf
  if (alternative == "less") out[1] <- -Inf
  out
}

J_hedges <- function(df) exp(lgamma(df / 2) - log(sqrt(df / 2)) - lgamma((df - 1) / 2))

# Effect-size record whose CI is the exact inversion scaled by sqrt(hn) (and J for Hedges' g);
# `es` is the effectsize row (point estimate + its optim-based CI).
es_rec_nct <- function(key, value, es, t1, df1, hn, ci, alternative, adjust = FALSE) {
  b <- ncp_t_exact(t1, df1, ci, alternative) * sqrt(hn)
  if (adjust) b <- b * J_hedges(df1)
  stopifnot(all(abs(c(es$CI_low, es$CI_high) - b)[is.finite(b)] < 0.05))
  rec <- es_rec(key, value, b[1], b[2])
  rec$effectsize_ci_lower <- num(es$CI_low)
  rec$effectsize_ci_upper <- num(es$CI_high)
  rec
}

# r = t / sqrt(t^2 + df) (effectsize::t_to_r) with the exact CI; one-sided bounds limited to -1 / 1.
es_rec_r <- function(t, df, ci, alternative) {
  rr <- effectsize::t_to_r(t, df, ci = ci, alternative = alternative)
  b <- ncp_t_exact(t, df, ci, alternative)
  to_r <- function(v) if (is.finite(v)) v / sqrt(v^2 + df) else sign(v)
  rec <- es_rec("r", rr$r, to_r(b[1]), to_r(b[2]))
  rec$effectsize_ci_lower <- num(rr$CI_low)
  rec$effectsize_ci_upper <- num(rr$CI_high)
  rec
}
