# Reference fixtures for chi_square.* / fisher_exact / mcnemar / cochran_q
# (engine/statly_engine/stats/categorical.py + effect_sizes_cat.py).
# Self-contained: writes its own seeded datasets (fixtures/expected/data/categorical_*.csv) first.
# Conventions matched by the engine:
#   * Rows with a missing value on either variable are dropped (complete cases per analysis).
#     Level order = sorted observed values (as factor()).
#   * chi_square.independence: headline Pearson chisq.test(correct = FALSE); for 2 x 2 tables the
#     Yates-corrected chisq.test(correct = TRUE) is reported alongside (as SPSS), plus the
#     likelihood-ratio G² = 2 sum O ln(O / E) (hand computation, as SPSS).
#   * Cramér's V and phi: effectsize::cramers_v / effectsize::phi (adjust = FALSE: the classical,
#     unadjusted coefficients) with effectsize's default one-sided CI (alternative = "greater",
#     upper bound fixed at 1). effectsize finds the noncentral chi-square bound with Nelder-Mead;
#     the fixture records the exact inversion (uniroot) and keeps effectsize's bound as
#     effectsize_ci_lower, for information.
#   * Sample odds ratio (2 x 2): ad / bc with Woolf's log-scale CI (effectsize::oddsratio);
#     null CI when a cell is 0.
#   * fisher_exact: stats::fisher.test. 2 x 2: conditional-MLE odds ratio and its exact CI (differs
#     from the sample OR, which is also reported), re-solved at tight tolerance (fisher_or_exact);
#     r x c: p-value only (FEXACT).
#   * chi_square.goodness_of_fit: chisq.test(x, p) with equal or user-given proportions (rescaled
#     to sum to 1). Cohen's w and Fei: effectsize::cohens_w / fei defaults (one-sided CI, upper
#     bound = the maximum possible value), again with the exact ncp inversion.
#   * mcnemar: mcnemar.test(correct = TRUE) headline (as SPSS's chi-square), correct = FALSE and the
#     exact binomial test (binom.test(b, b + c)) alongside. Cohen's g: effectsize::cohens_g (Wilson
#     CI); paired odds ratio b / c with the exact conditional CI (binom.test CI mapped by p / (1 - p)).
#   * cochran_q: rstatix::cochran_qtest (friedman.test on 0/1 data), checked against the textbook Q.
if (!exists("R_DIR")) source(file.path(dirname(normalizePath(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))), "common.R"))
suppressPackageStartupMessages({ library(effectsize); library(rstatix) })

# ---- datasets ---------------------------------------------------------------------------------
RNGkind("Mersenne-Twister", "Inversion", "Rejection")
set.seed(20260927)
g <- sample(c("Control", "Treatment"), 90, TRUE)
passed <- ifelse(runif(90) < ifelse(g == "Treatment", 0.7, 0.45), "Yes", "No")
d2 <- data.frame(group = g, passed = passed)
d2$group[c(5, 60)] <- NA; d2$passed[c(14, 33, 71)] <- NA
write_dataset(d2, "categorical_2x2.csv")
school <- sample(c("A", "B", "C"), 240, TRUE, c(.4, .35, .25))
band <- sapply(school, function(s) sample(1:4, 1, prob = switch(s, A = c(.1, .3, .4, .2), B = c(.25, .25, .3, .2),
                                                                C = c(.3, .35, .2, .15))))
write_dataset(data.frame(school = school, band = band), "categorical_3x4.csv")
write_dataset(data.frame(group = c(rep("Control", 8), rep("Treatment", 8)),
                         response = c("Agree", "Neutral", "Disagree", "Disagree", "Disagree", "Neutral", "Disagree", "Disagree",
                                      "Agree", "Agree", "Agree", "Neutral", "Agree", "Agree", "Disagree", "Agree")),
          "categorical_sparse.csv")                      # 2 x 3, expected counts < 5
write_dataset(data.frame(group = c(rep("Control", 6), rep("Treatment", 8)),
                         passed = c(rep("No", 6), rep("No", 3), rep("Yes", 5))),
          "categorical_zero_cell.csv")                   # 2 x 2 with a zero cell
fav <- sample(c("Art", "Math", "Reading", "Science"), 123, TRUE, c(.2, .3, .3, .2))
fav[c(9, 50, 101)] <- NA
write_dataset(data.frame(favorite = fav), "categorical_gof.csv")
pre <- rbinom(60, 1, 0.4)
post <- ifelse(pre == 1, rbinom(60, 1, 0.85), rbinom(60, 1, 0.45))
pp <- data.frame(pre = pre, post = post)
pp$pre[c(3, 44)] <- NA; pp$post[c(20)] <- NA
write_dataset(pp, "categorical_paired.csv")
write_dataset(data.frame(pre = c("No", "No", "Yes", "No", "Yes", "No", "No", "Yes"),
                         post = c("Yes", "Yes", "Yes", "No", "Yes", "Yes", "No", "Yes")),
          "categorical_paired_small.csv")                # b + c = 3
p_item <- c(.35, .5, .6, .7)
ability <- rnorm(35)
cq <- as.data.frame(sapply(p_item, function(p) rbinom(35, 1, plogis(qlogis(p) + ability))))
names(cq) <- paste0("t", 1:4)
cq$t2[c(4, 19)] <- NA; cq$t4[27] <- NA
write_dataset(cq, "categorical_cochran.csv")
write_dataset(data.frame(group = c("A", "B", "A", "B", "A", "B"), passed = rep("Yes", 6)),
          "categorical_constant.csv")

# ---- helpers ----------------------------------------------------------------------------------
empty <- setNames(list(), character(0))
# Exact noncentral chi-square bound: the ncp with pchisq(chisq, df, ncp) = prob (0 if none).
ncp_chi_exact <- function(chisq, df, prob) {
  if (stats::pchisq(chisq, df) <= prob) return(0)
  f <- function(ncp) stats::pchisq(chisq, df, ncp) - prob
  stats::uniroot(f, c(0, chisq + 10 * sqrt(chisq + df) + 50), tol = 1e-13, maxiter = 5000)$root
}
# One-sided ("greater") CI lower bound for w = sqrt(chisq / n), effectsize's default.
w_lower <- function(chisq, df, n, ci = 0.95) sqrt(ncp_chi_exact(chisq, df, ci) / n)
# An infinite odds ratio (a zero cell) has no finite point estimate, so the engine reports the effect
# with a null value and null CI; the finite bound is kept as bound_when_infinite and checked directly
# against the helper in effect_sizes_cat.
es_rec_or <- function(key, value, lower, upper) {
  if (is.finite(value)) return(es_rec(key, value, lower, upper))
  rec <- es_rec(key, value, NULL, NULL)
  rec$bound_when_infinite <- list(num(lower), num(upper))
  rec
}
es_rec_chi <- function(key, value, lower, upper, es_row) {
  rec <- es_rec(key, value, lower, upper)
  stopifnot(abs(es_row$CI_low - lower) < 0.01)
  rec$effectsize_ci_lower <- num(es_row$CI_low)
  rec
}
chi_rec <- function(key, ct) stat_rec(key, ct$statistic, ct$parameter, ct$p.value)
g2_rec <- function(tab) {
  E <- outer(rowSums(tab), colSums(tab)) / sum(tab)
  G2 <- 2 * sum(ifelse(tab > 0, tab * log(tab / E), 0))
  df <- (nrow(tab) - 1) * (ncol(tab) - 1)
  stat_rec("likelihood_ratio", G2, df, stats::pchisq(G2, df, lower.tail = FALSE))
}
woolf <- function(tab, ci = 0.95) {
  a <- tab[1, 1]; b <- tab[1, 2]; c <- tab[2, 1]; d <- tab[2, 2]
  or <- (a * d) / (b * c)
  if (any(tab == 0)) return(es_rec("sample_odds_ratio", or, NULL, NULL))
  se <- sqrt(1 / a + 1 / b + 1 / c + 1 / d); q <- qnorm(1 - (1 - ci) / 2)
  eo <- effectsize::oddsratio(tab, ci = ci)
  lim <- exp(log(or) + c(-1, 1) * q * se)
  stopifnot(abs(eo$Odds_ratio - or) < 1e-10, abs(eo$CI_low - lim[1]) < 1e-10)
  es_rec("sample_odds_ratio", or, lim[1], lim[2])
}
xtab <- function(d, r, c) {
  k <- !is.na(d[[r]]) & !is.na(d[[c]])
  list(tab = table(factor(d[[r]][k]), factor(d[[c]][k])), n_excl = sum(!k), n = sum(k))
}
cat_effects <- function(tab, chisq, ci = 0.95) {
  n <- sum(tab); r <- nrow(tab); c <- ncol(tab); df <- (r - 1) * (c - 1)
  v <- effectsize::cramers_v(tab, adjust = FALSE, ci = ci)
  lo <- w_lower(chisq, df, n, ci) / sqrt(min(r, c) - 1)
  out <- list(es_rec_chi("cramers_v", v$Cramers_v, lo, 1, v))
  if (r == 2 && c == 2) {
    ph <- effectsize::phi(tab, adjust = FALSE, ci = ci)
    out[[2]] <- es_rec_chi("phi", ph$phi, w_lower(chisq, df, n, ci), 1, ph)
    out[[3]] <- woolf(tab, ci)
  }
  out
}

# stats::fisher.test's conditional MLE and exact CI, re-solved with uniroot(tol = 1e-14): fisher.test
# itself uses uniroot's default tolerance (~1e-4), so its printed OR and CI can be off by ~1e-5.
# Same algorithm (code copied from stats::fisher.test), tight tolerance; fisher.test's own values are
# kept as fisher_test_* for information.
fisher_or_exact <- function(tab, ci = 0.95, alternative = "two.sided") {
  m <- sum(tab[, 1L]); n <- sum(tab[, 2L]); k <- sum(tab[1L, ]); x <- tab[1L, 1L]
  lo <- max(0L, k - n); hi <- min(k, m); support <- lo:hi
  logdc <- stats::dhyper(support, m, n, k, log = TRUE)
  ur <- function(f, lim) stats::uniroot(f, lim, tol = 1e-14, maxiter = 10000)$root
  dnhyper <- function(ncp) { d <- logdc + log(ncp) * support; d <- exp(d - max(d)); d / sum(d) }
  mnhyper <- function(ncp) { if (ncp == 0) return(lo); if (ncp == Inf) return(hi); sum(support * dnhyper(ncp)) }
  pnhyper <- function(q, ncp, upper.tail = FALSE) {
    if (ncp == 1) return(if (upper.tail) stats::phyper(x - 1, m, n, k, lower.tail = FALSE) else stats::phyper(x, m, n, k))
    if (ncp == 0) return(as.numeric(if (upper.tail) q <= lo else q >= lo))
    if (ncp == Inf) return(as.numeric(if (upper.tail) q <= hi else q >= hi))
    sum(dnhyper(ncp)[if (upper.tail) support >= q else support <= q])
  }
  ncp.U <- function(x, alpha) {
    if (x == hi) return(Inf)
    p <- pnhyper(x, 1)
    if (p < alpha) ur(function(t) pnhyper(x, t) - alpha, c(0, 1))
    else if (p > alpha) 1 / ur(function(t) pnhyper(x, 1 / t) - alpha, c(.Machine$double.eps, 1)) else 1
  }
  ncp.L <- function(x, alpha) {
    if (x == lo) return(0)
    p <- pnhyper(x, 1, upper.tail = TRUE)
    if (p > alpha) ur(function(t) pnhyper(x, t, upper.tail = TRUE) - alpha, c(0, 1))
    else if (p < alpha) 1 / ur(function(t) pnhyper(x, 1 / t, upper.tail = TRUE) - alpha, c(.Machine$double.eps, 1)) else 1
  }
  cint <- switch(alternative, less = c(0, ncp.U(x, 1 - ci)), greater = c(ncp.L(x, 1 - ci), Inf),
                 two.sided = { a <- (1 - ci) / 2; c(ncp.L(x, a), ncp.U(x, a)) })
  est <- if (x == lo) 0 else if (x == hi) Inf else {
    mu <- mnhyper(1)
    if (mu > x) ur(function(t) mnhyper(t) - x, c(0, 1))
    else if (mu < x) 1 / ur(function(t) mnhyper(1 / t) - x, c(.Machine$double.eps, 1)) else 1
  }
  c(est, cint)
}

# ---- chi-square of independence ----------------------------------------------------------------
indep_case <- function(case, dataset, r, c, ci = 0.95) {
  d <- load_dataset(dataset)
  x <- xtab(d, r, c)
  request <- req(list(row = list(r), column = list(c)), empty, "two_sided", ci)
  if (min(dim(x$tab)) < 2) {
    return(write_fixture("chi_square.independence", case, list(
      analysis_id = "chi_square.independence", case = case, dataset = dataset, request = request,
      expected = NULL, error = "a variable has only one category")))
  }
  pear <- suppressWarnings(stats::chisq.test(x$tab, correct = FALSE))
  stat <- list(chi_rec("chi2", pear))
  if (all(dim(x$tab) == 2)) stat[[length(stat) + 1]] <- chi_rec("chi2_yates", suppressWarnings(stats::chisq.test(x$tab)))
  stat[[length(stat) + 1]] <- g2_rec(x$tab)
  write_fixture("chi_square.independence", case, list(
    analysis_id = "chi_square.independence", case = case, dataset = dataset, request = request,
    expected = list(n_used = x$n, n_excluded = x$n_excl, statistics = stat,
                    effect_sizes = cat_effects(x$tab, pear$statistic, ci),
                    expected_counts = unname(as.list(as.numeric(t(pear$expected)))),
                    low_expected = mean(pear$expected < 5) > 0.2),
    error = NULL))
}
indep_case("2x2_missing", "categorical_2x2.csv", "group", "passed")
indep_case("3x4", "categorical_3x4.csv", "school", "band")
indep_case("3x4_ci90", "categorical_3x4.csv", "school", "band", ci = 0.90)
indep_case("sparse_2x3", "categorical_sparse.csv", "group", "response")
indep_case("zero_cell_2x2", "categorical_zero_cell.csv", "group", "passed")
indep_case("constant", "categorical_constant.csv", "group", "passed")

# ---- Fisher's exact -----------------------------------------------------------------------------
fisher_case <- function(case, dataset, r, c, tails = "two_sided", ci = 0.95) {
  d <- load_dataset(dataset)
  x <- xtab(d, r, c)
  ft <- stats::fisher.test(x$tab, alternative = r_alternative(tails), conf.level = ci)
  pear <- suppressWarnings(stats::chisq.test(x$tab, correct = FALSE))
  if (all(dim(x$tab) == 2)) {
    ex <- fisher_or_exact(x$tab, ci, r_alternative(tails))
    stopifnot(ex[1] == ft$estimate || abs(ex[1] - ft$estimate) < 1e-3 * max(1, ft$estimate))
    orr <- es_rec_or("odds_ratio", ex[1], ex[2], ex[3])
    orr$fisher_test_value <- num(ft$estimate)
    orr$fisher_test_ci_lower <- num(ft$conf.int[1]); orr$fisher_test_ci_upper <- num(ft$conf.int[2])
    effects <- c(list(orr), cat_effects(x$tab, pear$statistic, ci)[c(3, 2)])
  } else {
    effects <- cat_effects(x$tab, pear$statistic, ci)
  }
  write_fixture("fisher_exact", case, list(
    analysis_id = "fisher_exact", case = case, dataset = dataset,
    request = req(list(row = list(r), column = list(c)), empty, tails, ci),
    expected = list(n_used = x$n, n_excluded = x$n_excl,
                    statistics = list(stat_rec("fisher_p", NULL, numeric(0), ft$p.value)),
                    effect_sizes = effects),
    error = NULL))
}
fisher_case("2x2_missing", "categorical_2x2.csv", "group", "passed")
fisher_case("2x2_greater", "categorical_2x2.csv", "group", "passed", tails = "greater")
fisher_case("2x2_less_ci90", "categorical_2x2.csv", "group", "passed", tails = "less", ci = 0.90)
fisher_case("zero_cell_2x2", "categorical_zero_cell.csv", "group", "passed")
fisher_case("sparse_2x3", "categorical_sparse.csv", "group", "response")

# ---- goodness of fit ----------------------------------------------------------------------------
gof_case <- function(case, dataset, v, p = NULL, ci = 0.95) {
  d <- load_dataset(dataset)
  x <- d[[v]][!is.na(d[[v]])]
  tab <- table(factor(x))
  pp <- if (is.null(p)) rep(1 / length(tab), length(tab)) else p[names(tab)] / sum(p)
  ct <- stats::chisq.test(as.numeric(tab), p = unname(pp))
  n <- sum(tab); df <- length(tab) - 1
  w <- effectsize::cohens_w(as.numeric(tab), p = unname(pp), ci = ci)
  fe <- effectsize::fei(as.numeric(tab), p = unname(pp), ci = ci)
  wl <- w_lower(ct$statistic, df, n, ci); wmax <- sqrt(1 / min(pp) - 1)
  opts <- if (is.null(p)) empty else list(expected_proportions = as.list(p))
  write_fixture("chi_square.goodness_of_fit", case, list(
    analysis_id = "chi_square.goodness_of_fit", case = case, dataset = dataset,
    request = req(list(variable = list(v)), opts, "two_sided", ci),
    expected = list(n_used = n, n_excluded = sum(is.na(d[[v]])), statistics = list(chi_rec("chi2", ct)),
                    effect_sizes = list(es_rec_chi("cohens_w", w$Cohens_w, wl, wmax, w),
                                        es_rec_chi("fei", fe$Fei, wl / wmax, 1, fe)),
                    expected_counts = unname(as.list(as.numeric(ct$expected)))),
    error = NULL))
}
gof_case("equal", "categorical_gof.csv", "favorite")
gof_case("specified", "categorical_gof.csv", "favorite", p = c(Art = 0.1, Math = 0.4, Reading = 0.3, Science = 0.2))
gof_case("unnormalized", "categorical_gof.csv", "favorite", p = c(Art = 1, Math = 2, Reading = 2, Science = 1))
gof_case("sparse", "categorical_sparse.csv", "response")

# ---- McNemar ------------------------------------------------------------------------------------
mcnemar_case <- function(case, dataset, a, b, ci = 0.95) {
  d <- load_dataset(dataset)
  k <- !is.na(d[[a]]) & !is.na(d[[b]])
  lv <- sort(unique(c(d[[a]][k], d[[b]][k])))
  tab <- table(factor(d[[a]][k], levels = lv), factor(d[[b]][k], levels = lv))
  m1 <- stats::mcnemar.test(tab, correct = TRUE); m0 <- stats::mcnemar.test(tab, correct = FALSE)
  bb <- tab[1, 2]; cc <- tab[2, 1]
  bt <- stats::binom.test(bb, bb + cc, conf.level = ci)
  cg <- effectsize::cohens_g(tab, ci = ci)
  orci <- bt$conf.int / (1 - bt$conf.int)
  write_fixture("mcnemar", case, list(
    analysis_id = "mcnemar", case = case, dataset = dataset,
    request = req(list(measures = list(a, b)), empty, "two_sided", ci),
    expected = list(n_used = sum(k), n_excluded = sum(!k),
                    statistics = list(chi_rec("chi2", m1), chi_rec("chi2_uncorrected", m0),
                                      stat_rec("binomial_exact", bb, numeric(0), bt$p.value)),
                    effect_sizes = list(es_rec("cohens_g", cg$Cohens_g, cg$CI_low, cg$CI_high),
                                        es_rec_or("odds_ratio", bb / cc, orci[1], orci[2]))),
    error = NULL))
}
mcnemar_case("basic_missing", "categorical_paired.csv", "pre", "post")
mcnemar_case("small", "categorical_paired_small.csv", "pre", "post")
mcnemar_case("ci90", "categorical_paired.csv", "pre", "post", ci = 0.90)

# ---- Cochran's Q --------------------------------------------------------------------------------
cochran_case <- function(case, dataset, vars) {
  d <- load_dataset(dataset)
  cc <- d[stats::complete.cases(d[, vars]), vars]
  long <- data.frame(id = factor(rep(seq_len(nrow(cc)), length(vars))), time = factor(rep(vars, each = nrow(cc))),
                     y = unlist(cc, use.names = FALSE))
  rq <- rstatix::cochran_qtest(long, y ~ time | id)
  k <- length(vars); Cj <- colSums(cc); Ri <- rowSums(cc); N <- sum(cc)
  Q <- (k - 1) * (k * sum(Cj^2) - N^2) / (k * N - sum(Ri^2))
  stopifnot(abs(Q - rq$statistic) < 1e-10)
  write_fixture("cochran_q", case, list(
    analysis_id = "cochran_q", case = case, dataset = dataset,
    request = req(list(measures = as.list(vars)), empty),
    expected = list(n_used = nrow(cc), n_excluded = nrow(d) - nrow(cc),
                    statistics = list(stat_rec("q", rq$statistic, rq$df, rq$p))),
    error = NULL))
}
cochran_case("four_measures_missing", "categorical_cochran.csv", paste0("t", 1:4))
cochran_case("three_measures", "categorical_cochran.csv", c("t1", "t3", "t4"))
