# Reference fixtures for correlation.* (engine/statly_engine/stats/correlation.py).
# Self-contained: writes its own seeded datasets (fixtures/expected/data/correlation_*.csv) first.
# Conventions matched by the engine:
#   * Missing data: complete pairs per pair (partial: complete cases on x, y and all covariates).
#   * Pearson / point-biserial: stats::cor.test (t test, df = n - 2; Fisher-z CI, SE 1/sqrt(n - 3)).
#     Point-biserial codes the first level of the binary variable 0 and the second 1.
#   * Spearman: cor.test(method = "spearman") defaults: exact AS 89 p (exact enumeration n <= 9,
#     Edgeworth series 10 <= n <= 1290) when there are no ties; t approximation with ties or
#     n > 1290. CI: Fisher z with the Fieller, Hartley & Pearson (1957) SE sqrt(1.06 / (n - 3))
#     (cor.test gives none; hand computation below).
#   * Kendall tau-b: cor.test(method = "kendall") defaults: exact null distribution of T when
#     n < 50 and no ties; otherwise the tie-corrected normal approximation, no continuity
#     correction. CI: Fisher z with the Fieller et al. SE sqrt(0.437 / (n - 4)) (hand computation).
#   * Partial: ppcor::pcor.test (t with df = n - 2 - k); CI hand-computed Fisher z, SE 1/sqrt(n - 3 - k).
#   * Matrix: pairwise deletion; each pair is tested exactly as the bivariate analysis above, then
#     stats::p.adjust(method) across the k(k-1)/2 unique pairs. For Pearson this is identical to
#     psych::corr.test(use = "pairwise", adjust = method), checked below with stopifnot.
#   * Perfect correlation: R's cor() returns 1 - 2e-16 (t = 1.3e8). The engine snaps |r| > 1 - 1e-12
#     to +/-1 (t infinite -> null, p = 0, CI [1, 1]); the fixture records the snapped values.
if (!exists("R_DIR")) source(file.path(dirname(normalizePath(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))), "common.R"))
suppressPackageStartupMessages({ library(psych); library(ppcor) })

# ---- datasets ---------------------------------------------------------------------------------
RNGkind("Mersenne-Twister", "Inversion", "Rejection")
set.seed(20260926)
mk <- function(n, rho, digits = 3) {
  x <- rnorm(n); e <- rnorm(n)
  y <- rho * x + sqrt(1 - rho^2) * e
  list(x = round(50 + 10 * x, digits), y = round(20 + 4 * y, digits), e = e)
}
b <- mk(60, 0.5)
z <- round(0.6 * scale(b$x)[, 1] + 0.4 * scale(b$y)[, 1] + rnorm(60, 0, 0.7), 3)
basic <- data.frame(x = b$x, y = b$y, z = z, w = round(rnorm(60, 100, 15), 3),
                    group = ifelse(b$x + rnorm(60, 0, 8) > 50, "Treatment", "Control"))
write_dataset(basic, "correlation_basic.csv")
s <- mk(5, 0.6)
write_dataset(data.frame(x = s$x, y = s$y, z = round(rnorm(5, 10, 2), 3)), "correlation_small.csv")
tw <- mk(12, 0.4)
write_dataset(data.frame(x = tw$x, y = tw$y, z = round(rnorm(12, 0, 1), 3), w = round(rnorm(12, 5, 1), 3)),
              "correlation_twelve.csv")
lat <- rnorm(40)
lik <- function() pmin(5, pmax(1, round(3 + 1.1 * (0.7 * lat + sqrt(0.51) * rnorm(40)))))
ties <- data.frame(a = lik(), b = lik(), c = lik(), d = lik(),
                   passed = sample(c("No", "Yes"), 40, TRUE))
write_dataset(ties, "correlation_ties.csv")
m <- mk(45, 0.35, 2)
miss <- data.frame(x = m$x, y = m$y, z = round(rnorm(45, 0, 1), 2), w = round(0.5 * m$e + rnorm(45), 2),
                   group = sample(c("A", "B"), 45, TRUE))
miss$x[c(4, 17, 30)] <- NA; miss$y[c(8, 17, 41)] <- NA; miss$z[c(2, 33)] <- NA
miss$w[c(5, 6)] <- NA; miss$group[c(12, 40)] <- NA
write_dataset(miss, "correlation_missing.csv")
write_dataset(data.frame(x = rep(4, 10), y = round(rnorm(10, 3, 1), 2), z = round(rnorm(10), 2)),
              "correlation_constant.csv")
px <- sample(1:10)
write_dataset(data.frame(x = px, y = 2 * px + 3, z = round(rnorm(10), 2)), "correlation_perfect.csv")

# ---- helpers ----------------------------------------------------------------------------------
PERFECT <- 1 - 1e-12
fisher_ci <- function(r, se, ci, tails) {
  if (abs(r) >= PERFECT) return(c(sign(r), sign(r)))
  z <- atanh(r)
  if (tails == "two_sided") { q <- qnorm(1 - (1 - ci) / 2); return(tanh(z + c(-1, 1) * q * se)) }
  q <- qnorm(ci)
  if (tails == "greater") c(tanh(z - q * se), 1) else c(-1, tanh(z + q * se))
}
empty <- setNames(list(), character(0))
pair_data <- function(d, a, b) { k <- !is.na(d[[a]]) & !is.na(d[[b]]); list(x = d[[a]][k], y = d[[b]][k]) }

# One bivariate test, following cor.test's defaults. Returns r, p, the statistic record, the CI.
bivariate <- function(x, y, method, tails = "two_sided", ci = 0.95) {
  n <- length(x)
  alt <- r_alternative(tails)
  ct <- suppressWarnings(stats::cor.test(x, y, method = method, alternative = alt, conf.level = ci))
  r <- unname(ct$estimate)
  if (method == "pearson") {
    snapped <- abs(r) >= PERFECT
    if (snapped) r <- sign(r)
    t <- if (snapped) NA else unname(ct$statistic)
    p <- if (snapped) 0 else ct$p.value
    lim <- if (snapped) c(r, r) else as.numeric(ct$conf.int)
    list(r = r, p = p, n = n, stat = stat_rec("t", t, n - 2, p), ci = lim, df = n - 2)
  } else if (method == "spearman") {
    se <- sqrt(1.06 / (n - 3))
    list(r = r, p = ct$p.value, n = n, stat = stat_rec("S", ct$statistic, numeric(0), ct$p.value),
         ci = if (n > 3) fisher_ci(r, se, ci, tails) else c(NA, NA), df = n - 2)
  } else {
    key <- names(ct$statistic)   # "T" (exact) or "z"
    se <- sqrt(0.437 / (n - 4))
    list(r = r, p = ct$p.value, n = n, stat = stat_rec(key, ct$statistic, numeric(0), ct$p.value),
         ci = if (n > 4) fisher_ci(r, se, ci, tails) else c(NA, NA), df = n - 2)
  }
}

HEAD <- c(pearson = "r", spearman = "rho", kendall = "tau_b")
ANALYSIS <- c(pearson = "correlation.pearson", spearman = "correlation.spearman",
              kendall = "correlation.kendall_tau_b")

bivariate_case <- function(method, case, dataset, a = "x", b = "y", tails = "two_sided", ci = 0.95) {
  d <- load_dataset(dataset)
  id <- ANALYSIS[[method]]
  request <- req(list(x = list(a), y = list(b)), empty, tails, ci)
  pd <- pair_data(d, a, b)
  if (stats::sd(pd$x) == 0 || stats::sd(pd$y) == 0) {
    return(write_fixture(id, case, list(analysis_id = id, case = case, dataset = dataset, request = request,
                                        expected = NULL, error = "constant: the standard deviation is zero")))
  }
  res <- bivariate(pd$x, pd$y, method, tails, ci)
  head <- stat_rec(HEAD[[method]], res$r, if (method == "kendall") numeric(0) else res$n - 2, res$p)
  write_fixture(id, case, list(
    analysis_id = id, case = case, dataset = dataset, request = request,
    expected = list(n_used = res$n, n_excluded = nrow(d) - res$n,
                    statistics = list(head, res$stat),
                    effect_sizes = list(es_rec(HEAD[[method]], res$r, res$ci[1], res$ci[2]))),
    error = NULL))
}

for (m in c("pearson", "spearman", "kendall")) {
  bivariate_case(m, "basic", "correlation_basic.csv")
  bivariate_case(m, "small_n5", "correlation_small.csv")
  bivariate_case(m, "n12", "correlation_twelve.csv")
  bivariate_case(m, "ties", "correlation_ties.csv", "a", "b")
  bivariate_case(m, "missing", "correlation_missing.csv")
  bivariate_case(m, "greater", "correlation_basic.csv", tails = "greater")
  bivariate_case(m, "less_ci90", "correlation_twelve.csv", tails = "less", ci = 0.90)
  bivariate_case(m, "constant", "correlation_constant.csv")
  bivariate_case(m, "perfect", "correlation_perfect.csv")
}
bivariate_case("spearman", "small_n5_greater", "correlation_small.csv", tails = "greater")
bivariate_case("kendall", "small_n5_less", "correlation_small.csv", tails = "less")

# ---- point-biserial -----------------------------------------------------------------------------
pb_case <- function(case, dataset, g, yname, tails = "two_sided", ci = 0.95) {
  d <- load_dataset(dataset)
  k <- !is.na(d[[g]]) & !is.na(d[[yname]])
  lv <- sort(unique(d[[g]][k]))
  x <- as.numeric(d[[g]][k] == lv[2]); y <- d[[yname]][k]
  ct <- stats::cor.test(x, y, alternative = r_alternative(tails), conf.level = ci)
  n <- length(y)
  write_fixture("correlation.point_biserial", case, list(
    analysis_id = "correlation.point_biserial", case = case, dataset = dataset,
    request = req(list(binary = list(g), outcome = list(yname)), empty, tails, ci),
    expected = list(n_used = n, n_excluded = nrow(d) - n,
                    statistics = list(stat_rec("r_pb", ct$estimate, n - 2, ct$p.value),
                                      stat_rec("t", ct$statistic, ct$parameter, ct$p.value)),
                    effect_sizes = list(es_rec("r_pb", ct$estimate, ct$conf.int[1], ct$conf.int[2]))),
    error = NULL))
}
pb_case("basic", "correlation_basic.csv", "group", "y")
pb_case("missing", "correlation_missing.csv", "group", "y")
pb_case("likert_greater", "correlation_ties.csv", "passed", "a", tails = "greater")

# ---- partial ------------------------------------------------------------------------------------
partial_case <- function(case, dataset, covs, method = "pearson", ci = 0.95) {
  d <- load_dataset(dataset)
  vars <- c("x", "y", covs)
  cc <- d[stats::complete.cases(d[, vars]), vars]
  pc <- ppcor::pcor.test(cc$x, cc$y, cc[, covs, drop = FALSE], method = method)
  n <- nrow(cc); k <- length(covs)
  lim <- fisher_ci(pc$estimate, 1 / sqrt(n - 3 - k), ci, "two_sided")
  write_fixture("correlation.partial", case, list(
    analysis_id = "correlation.partial", case = case, dataset = dataset,
    request = req(list(x = list("x"), y = list("y"), covariates = as.list(covs)),
                  list(method = method), "two_sided", ci),
    expected = list(n_used = n, n_excluded = nrow(d) - n,
                    statistics = list(stat_rec("r_partial", pc$estimate, n - 2 - k, pc$p.value),
                                      stat_rec("t", pc$statistic, n - 2 - k, pc$p.value)),
                    effect_sizes = list(es_rec("r_partial", pc$estimate, lim[1], lim[2]))),
    error = NULL))
}
partial_case("one_covariate", "correlation_basic.csv", "z")
partial_case("two_covariates", "correlation_basic.csv", c("z", "w"))
partial_case("missing", "correlation_missing.csv", c("z", "w"))
partial_case("spearman", "correlation_twelve.csv", "z", method = "spearman")

# ---- matrix -------------------------------------------------------------------------------------
matrix_case <- function(case, dataset, vars, method = "pearson", adjust = "none") {
  d <- load_dataset(dataset)
  padj <- c(none = "none", bonferroni = "bonferroni", holm = "holm", fdr_bh = "BH")[[adjust]]
  pairs <- list()
  for (i in 1:(length(vars) - 1)) for (j in (i + 1):length(vars)) {
    pd <- pair_data(d, vars[i], vars[j])
    res <- bivariate(pd$x, pd$y, method)
    pairs[[length(pairs) + 1]] <- list(x = vars[i], y = vars[j], n = res$n, r = num(res$r), p = num(res$p),
                                       ci_lower = num(res$ci[1]), ci_upper = num(res$ci[2]))
  }
  p_adj <- stats::p.adjust(sapply(pairs, function(q) q$p), method = padj)
  for (i in seq_along(pairs)) pairs[[i]]$p_adjusted <- num(p_adj[i])
  if (method == "pearson") {   # identical to psych::corr.test
    ct <- psych::corr.test(d[, vars], use = "pairwise", adjust = padj)
    lt <- which(lower.tri(ct$r), arr.ind = TRUE)
    lt <- lt[order(lt[, 2], lt[, 1]), , drop = FALSE]
    stopifnot(max(abs(ct$r[lt] - sapply(pairs, function(q) q$r))) < 1e-12,
              max(abs(ct$p[lt] - sapply(pairs, function(q) q$p))) < 1e-10,
              max(abs(t(ct$p)[lt] - p_adj)) < 1e-10)
  }
  write_fixture("correlation.matrix", case, list(
    analysis_id = "correlation.matrix", case = case, dataset = dataset,
    request = req(list(variables = as.list(vars)), list(method = method, adjust = adjust)),
    expected = list(n_used = nrow(d) - sum(rowSums(!is.na(d[, vars])) < 2),
                    n_excluded = sum(rowSums(!is.na(d[, vars])) < 2), pairs = pairs),
    error = NULL))
}
matrix_case("pearson_none", "correlation_basic.csv", c("x", "y", "z", "w"))
matrix_case("pearson_holm", "correlation_basic.csv", c("x", "y", "z", "w"), adjust = "holm")
matrix_case("pairwise_missing_bonferroni", "correlation_missing.csv", c("x", "y", "z", "w"), adjust = "bonferroni")
matrix_case("spearman_ties_fdr", "correlation_ties.csv", c("a", "b", "c", "d"), "spearman", "fdr_bh")
matrix_case("kendall_n12_holm", "correlation_twelve.csv", c("x", "y", "z", "w"), "kendall", "holm")
