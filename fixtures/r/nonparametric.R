# Reference fixtures for the nonparametric family (engine/statly_engine/stats/nonparametric.py,
# posthoc_rank.py, effect_sizes_rank.py). Self-contained: writes its own seeded np_*.csv first.
#
# R functions matched (R 4.6 defaults):
#   mann_whitney / wilcoxon_signed_rank / wilcoxon_one_sample: stats::wilcox.test (exact = NULL,
#     correct = TRUE). R >= 4.4 uses the exact *conditional* distribution (ties and, for the
#     signed-rank test, zeros allowed) whenever n < 50 (both groups < 50); otherwise the normal
#     approximation with tie-corrected variance and continuity correction (zeros dropped).
#   z (reported with U / V) = normal approximation without continuity correction (zeros dropped),
#     recovered here from wilcox.test(exact = FALSE, correct = FALSE); r = z / sqrt(N).
#   rank_biserial: effectsize::rank_biserial (Fisher-z normal CI); r's CI = the rank-biserial CI
#     rescaled by r / r_rb (the two are linear in the same U / V statistic).
#   sign_test: stats::binom.test(#positive, #nonzero, 0.5) (exact); prop_positive CI = Clopper-Pearson.
#   kruskal_wallis: stats::kruskal.test; epsilon^2 = effectsize::rank_epsilon_squared (percentile
#     bootstrap, 200 iterations, one-sided "greater"), seeded with set.seed(BOOT_SEED) right before.
#   friedman: stats::friedman.test on complete cases; Kendall's W = effectsize::kendalls_w (same).
#   posthoc.dunn: PMCMRplus::kwAllPairsDunnTest; posthoc.conover: PMCMRplus::frdAllPairsConoverTest;
#   posthoc.nemenyi: PMCMRplus::frdAllPairsNemenyiTest. Pairwise rank-biserial via effectsize.
#   PAIRED_RB note: effectsize 1.0.3 rank_biserial(x, y, paired = TRUE) returns the right estimate but
#     its CI counts nonzero *x values* instead of nonzero differences (nd). The reference therefore uses
#     rank_biserial(x - y), effectsize's own one-sample form on the differences: same estimate, CI with
#     the documented nd = number of nonzero differences.
if (!exists("R_DIR")) source(file.path(dirname(normalizePath(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))), "common.R"))
suppressPackageStartupMessages({ library(effectsize); library(PMCMRplus); library(boot); library(psych) })

BOOT_SEED <- 12345
BOOT_ITER <- 200
DIR <- "nonparametric"
USED <- function() {
  pk <- c("stats", "effectsize", "boot", "PMCMRplus", "psych", "jsonlite")
  setNames(lapply(pk, function(p) as.character(utils::packageVersion(p))), pk)
}
empty <- setNames(list(), character(0))

# ---- datasets -----------------------------------------------------------------------------
local({
  set.seed(20260925)
  lik <- function(n, p) sample(seq_along(p), n, TRUE, prob = p)
  write_dataset(data.frame(group = rep(c("Control", "Program"), c(14, 11)),
                           y = c(lik(14, c(.2, .3, .3, .15, .05)), lik(11, c(.05, .15, .3, .3, .2)))),
                "np_two_ties.csv")
  v <- sample(10:90, 10) / 10
  write_dataset(data.frame(group = rep(c("A", "B"), each = 5), y = v + rep(c(0, 1.5), each = 5)),
                "np_two_small.csv")
  d <- data.frame(group = rep(c("A", "B"), c(20, 18)),
                  y = round(c(rnorm(20, 50, 10), rnorm(18, 56, 12)), 1))
  d$y[c(3, 11, 25)] <- NA; d$group[c(7, 30)] <- NA
  write_dataset(d, "np_two_missing.csv")
  write_dataset(data.frame(group = rep(c("A", "B"), c(60, 55)),
                           y = round(c(rexp(60, 1 / 10), rexp(55, 1 / 13)), 1)), "np_two_large.csv")
  d <- data.frame(group = rep(c("G1", "G2", "G3", "G4"), c(8, 12, 10, 15)),
                  y = c(lik(8, rep(1, 7)), lik(12, c(1, 1, 2, 2, 2, 1, 1)), lik(10, c(1, 1, 1, 2, 3, 3, 2)),
                        lik(15, c(3, 3, 2, 2, 1, 1, 1))))
  d$y[c(5, 30)] <- NA; d$group[18] <- NA
  write_dataset(d, "np_four.csv")
  write_dataset(data.frame(group = rep(c("A", "B", "C"), each = 5),
                           y = sample(100:400, 15) / 10 + rep(c(0, 5, 10), each = 5)), "np_three_small.csv")
  pre <- sample(2:9, 24, TRUE); post <- pmin(10, pmax(1, pre + sample(c(-2, -1, 0, 0, 1, 1, 2, 3), 24, TRUE)))
  pre[5] <- NA; post[17] <- NA
  write_dataset(data.frame(id = 1:24, pre = pre, post = post), "np_paired.csv")
  write_dataset(data.frame(id = 1:5, pre = c(12.1, 15.3, 9.8, 14.0, 11.2), post = c(13.5, 15.1, 12.9, 17.9, 13.6)),
                "np_paired_small.csv")
  pre <- sample(0:20, 70, TRUE)
  write_dataset(data.frame(id = 1:70, pre = pre, post = pmax(0, pre + sample(-3:5, 70, TRUE))),
                "np_paired_large.csv")
  ids <- c(101:116)
  pre <- sample(1:7, 16, TRUE); post <- pmin(7, pmax(1, pre + sample(c(-1, 0, 1, 1, 2), 16, TRUE)))
  long <- rbind(data.frame(id = ids, time = "Pre", score = pre), data.frame(id = ids, time = "Post", score = post))
  long <- long[sample(nrow(long)), ]
  long <- long[!(long$id == 104 & long$time == "Post"), ]          # only one time point
  long$score[long$id == 109 & long$time == "Pre"] <- NA            # missing score
  long <- rbind(long, data.frame(id = 112, time = "Pre", score = 3))  # duplicate id at a level
  write_dataset(long, "np_paired_long.csv")
  write_dataset(data.frame(y = c(lik(22, c(1, 1, 2, 3, 3, 2, 2)))), "np_one.csv")
  write_dataset(data.frame(y = round(rgamma(80, 4, 0.35), 1)), "np_one_large.csv")
  base <- lik(18, c(1, 2, 3, 2, 1))
  w <- data.frame(id = 1:18, t1 = base, t2 = pmin(5, base + sample(c(0, 0, 1), 18, TRUE)),
                  t3 = pmin(5, base + sample(c(0, 1, 1, 2), 18, TRUE)))
  w$t2[4] <- NA; w$t3[11] <- NA
  write_dataset(w, "np_rm3_wide.csv")
  ids <- 1:12
  long <- do.call(rbind, lapply(1:5, function(t) data.frame(id = ids, time = paste0("T", t),
                                                           score = round(rnorm(12, 20 + 1.5 * t, 4), 1))))
  long <- long[order(long$id, long$time), ]
  long <- long[!(long$id == 3 & long$time == "T4"), ]
  long$score[long$id == 8 & long$time == "T2"] <- NA
  write_dataset(long, "np_rm5_long.csv")
})

# ---- helpers ------------------------------------------------------------------------------
# z without continuity correction (zeros dropped, tie-corrected variance), signed like the statistic.
z_asymp <- function(x, y = NULL, mu = 0, paired = FALSE, alt = "two.sided") {
  w <- suppressWarnings(stats::wilcox.test(x, y, mu = mu, paired = paired, exact = FALSE, correct = FALSE))
  if (is.null(y) || paired) {
    d <- if (paired) x - y else x - mu
    d <- d[d != 0]; n <- length(d); ex <- n * (n + 1) / 4
  } else ex <- length(x) * length(y) / 2
  sign(w$statistic - ex) * stats::qnorm(w$p.value / 2, lower.tail = FALSE)
}

rb_recs <- function(r_val, rb, ci, alt) {
  a <- if (alt == "two.sided") c(rb$CI_low, rb$CI_high) else c(rb$CI_low, rb$CI_high)
  k <- r_val / rb$r_rank_biserial
  r_ci <- k * c(rb$CI_low, rb$CI_high)
  if (alt == "greater") r_ci[2] <- 1
  if (alt == "less") r_ci[1] <- -1
  list(es_rec("r", r_val, r_ci[1], r_ci[2]),
       es_rec("rank_biserial", rb$r_rank_biserial, rb$CI_low, rb$CI_high))
}

w_rec <- function(key, w) stat_rec(key, w$statistic, numeric(0), w$p.value)
z_rec <- function(z) stat_rec("z", z, numeric(0), NULL)

fixture <- function(id, case, dataset, request, expected, conventions) {
  write_fixture(DIR, paste0(id, "__", case), list(analysis_id = id, case = case, dataset = dataset,
                                                  request = request, expected = expected, error = NULL,
                                                  r_packages_used = USED(), conventions = conventions))
}

# ---- Mann-Whitney ---------------------------------------------------------------------------
mw_case <- function(case, dataset, tails = "two_sided", ci = 0.95) {
  d <- load_dataset(dataset); alt <- r_alternative(tails)
  lv <- sort(unique(d$group[!is.na(d$group)]))
  xa <- d$y[!is.na(d$group) & d$group == lv[1]]; ya <- d$y[!is.na(d$group) & d$group == lv[2]]
  x <- xa[!is.na(xa)]; y <- ya[!is.na(ya)]
  w <- stats::wilcox.test(x, y, alternative = alt)
  z <- z_asymp(x, y)
  rb <- rank_biserial(x, y, ci = ci, alternative = alt, verbose = FALSE)
  fixture("mann_whitney", case, dataset, req(list(outcome = list("y"), group = list("group")), empty, tails, ci),
          list(n_used = length(x) + length(y), n_excluded = nrow(d) - length(x) - length(y),
               statistics = list(w_rec("u", w), z_rec(z)),
               effect_sizes = rb_recs(z / sqrt(length(x) + length(y)), rb, ci, alt),
               descriptives = list(desc_rec("y", setNames(list(lv[1]), "group"), xa, ci),
                                   desc_rec("y", setNames(list(lv[2]), "group"), ya, ci)),
               p_method = w$method),
          "wilcox.test defaults; U = W of the first level; r = z/sqrt(n1+n2)")
}
mw_case("ties", "np_two_ties.csv")
mw_case("small_n", "np_two_small.csv")
mw_case("missing", "np_two_missing.csv")
mw_case("large_normal", "np_two_large.csv")
mw_case("greater", "np_two_ties.csv", tails = "greater", ci = 0.90)

# ---- paired designs (signed rank, sign test) ------------------------------------------------
paired_data <- function(dataset, layout) {
  d <- load_dataset(dataset)
  if (layout == "wide") {
    cc <- stats::complete.cases(d$pre, d$post)
    return(list(x = d$pre[cc], y = d$post[cc], n_excluded = sum(!cc),
                request_vars = list(measures = list("pre", "post")), opts = empty,
                desc = list(desc_rec("pre", empty, d$pre[cc], 0.95, sum(is.na(d$pre))),
                            desc_rec("post", empty, d$post[cc], 0.95, sum(is.na(d$post))))))
  }
  lv <- c("Pre", "Post")
  ids <- unique(d$id)
  ok <- Filter(function(i) all(sapply(lv, function(l) sum(d$id == i & d$time == l) == 1)), ids)
  get <- function(l) sapply(ok, function(i) d$score[d$id == i & d$time == l])
  x <- get("Pre"); y <- get("Post"); cc <- !is.na(x) & !is.na(y)
  in_lv <- sum(d$time %in% lv)
  list(x = x[cc], y = y[cc], n_excluded = in_lv - 2 * sum(cc),
       request_vars = list(outcome = list("score"), time = list("time"), subject_id = list("id")),
       opts = list(levels = list("Pre", "Post")),
       desc = list(desc_rec("score", list(time = "Pre"), x[cc], 0.95, sum(is.na(d$score[d$time == "Pre"]))),
                   desc_rec("score", list(time = "Post"), y[cc], 0.95, sum(is.na(d$score[d$time == "Post"])))))
}

sr_case <- function(case, dataset, layout = "wide", tails = "two_sided", ci = 0.95) {
  p <- paired_data(dataset, layout); alt <- r_alternative(tails)
  w <- stats::wilcox.test(p$x, p$y, paired = TRUE, alternative = alt)
  z <- z_asymp(p$x, p$y, paired = TRUE)
  nd <- sum(p$x != p$y)
  rb <- rank_biserial(p$x - p$y, ci = ci, alternative = alt, verbose = FALSE)  # see PAIRED_RB note
  fixture("wilcoxon_signed_rank", case, dataset, req(p$request_vars, p$opts, tails, ci),
          list(n_used = length(p$x), n_excluded = p$n_excluded,
               statistics = list(w_rec("v", w), z_rec(z)),
               effect_sizes = rb_recs(z / sqrt(nd), rb, ci, alt),
               descriptives = p$desc, p_method = w$method),
          "wilcox.test(paired = TRUE) defaults; r = z/sqrt(number of nonzero differences)")
}
sr_case("zeros_ties", "np_paired.csv")
sr_case("small_n", "np_paired_small.csv")
sr_case("large_normal", "np_paired_large.csv")
sr_case("long", "np_paired_long.csv", layout = "long")
sr_case("less", "np_paired.csv", tails = "less")

sign_case <- function(case, dataset, layout = "wide", tails = "two_sided", ci = 0.95, mu = NULL) {
  alt <- r_alternative(tails)
  if (!is.null(mu)) {
    d <- load_dataset(dataset); x <- d$y[!is.na(d$y)]; dd <- x - mu
    vars <- list(outcome = list("y")); opts <- list(test_value = mu); n_excl <- sum(is.na(d$y))
    desc <- list(desc_rec("y", empty, d$y, ci))
  } else {
    p <- paired_data(dataset, layout); dd <- p$x - p$y
    vars <- p$request_vars; opts <- p$opts; n_excl <- p$n_excluded; desc <- p$desc
  }
  npos <- sum(dd > 0); nnz <- sum(dd != 0)
  b <- stats::binom.test(npos, nnz, 0.5, alternative = alt, conf.level = ci)
  fixture("sign_test", case, dataset, req(vars, opts, tails, ci),
          list(n_used = length(dd), n_excluded = n_excl,
               statistics = list(stat_rec("s", npos, numeric(0), b$p.value)),
               effect_sizes = list(es_rec("prop_positive", npos / nnz, b$conf.int[1], b$conf.int[2])),
               descriptives = desc),
          "binom.test(#positive, #nonzero, p = 0.5); zeros dropped; Clopper-Pearson CI")
}
sign_case("paired", "np_paired.csv")
sign_case("small_n", "np_paired_small.csv")
sign_case("long", "np_paired_long.csv", layout = "long")
sign_case("one_sample", "np_one.csv", mu = 4)
sign_case("greater", "np_paired_large.csv", tails = "greater")

# ---- Wilcoxon one-sample ------------------------------------------------------------------
os_case <- function(case, dataset, mu, tails = "two_sided", ci = 0.95) {
  d <- load_dataset(dataset); x <- d$y[!is.na(d$y)]; alt <- r_alternative(tails)
  w <- stats::wilcox.test(x, mu = mu, alternative = alt)
  z <- z_asymp(x, mu = mu)
  rb <- rank_biserial(x, mu = mu, ci = ci, alternative = alt, verbose = FALSE)
  fixture("wilcoxon_one_sample", case, dataset, req(list(outcome = list("y")), list(test_value = mu), tails, ci),
          list(n_used = length(x), n_excluded = sum(is.na(d$y)),
               statistics = list(w_rec("v", w), z_rec(z)),
               effect_sizes = rb_recs(z / sqrt(sum(x != mu)), rb, ci, alt),
               descriptives = list(desc_rec("y", empty, d$y, ci)), p_method = w$method),
          "wilcox.test(x, mu) defaults; r = z/sqrt(number of nonzero differences)")
}
os_case("ties_zeros", "np_one.csv", 4)
os_case("large_normal", "np_one_large.csv", 10)
os_case("greater", "np_one.csv", 3, tails = "greater")

# ---- Kruskal-Wallis + Dunn ------------------------------------------------------------------
kw_data <- function(dataset) {
  d <- load_dataset(dataset)
  lv <- sort(unique(d$group[!is.na(d$group)]))
  keep <- !is.na(d$group) & !is.na(d$y)
  list(d = d, lv = lv, x = d$y[keep], g = factor(d$group[keep], levels = lv), n_excluded = sum(!keep))
}

kw_case <- function(case, dataset, ci = 0.95) {
  k <- kw_data(dataset)
  kt <- stats::kruskal.test(k$x, k$g)
  set.seed(BOOT_SEED)
  eps <- rank_epsilon_squared(k$x, k$g, ci = ci, iterations = BOOT_ITER, verbose = FALSE)
  fixture("kruskal_wallis", case, dataset, req(list(outcome = list("y"), group = list("group")), empty, "two_sided", ci),
          list(n_used = length(k$x), n_excluded = k$n_excluded,
               statistics = list(stat_rec("h", kt$statistic, kt$parameter, kt$p.value)),
               effect_sizes = list(es_rec("epsilon_sq", eps$rank_epsilon_squared, eps$CI_low, eps$CI_high)),
               descriptives = lapply(k$lv, function(l) desc_rec("y", setNames(list(l), "group"),
                                                                k$d$y[!is.na(k$d$group) & k$d$group == l], ci)),
               bootstrap = list(seed = BOOT_SEED, iterations = BOOT_ITER)),
          "kruskal.test (tie-corrected H); epsilon^2 = H/(n-1), percentile bootstrap CI (set.seed(12345), R = 200, one-sided greater)")
}
kw_case("four_groups", "np_four.csv")
kw_case("three_small", "np_three_small.csv")
kw_case("two_groups", "np_two_ties.csv")

pair_list <- function(lv) { out <- list(); for (i in 1:(length(lv) - 1)) for (j in (i + 1):length(lv)) out[[length(out) + 1]] <- c(i, j); out }

dunn_case <- function(case, dataset, adjust) {
  k <- kw_data(dataset)
  dt <- suppressWarnings(kwAllPairsDunnTest(k$x, k$g, p.adjust.method = adjust))
  du <- suppressWarnings(kwAllPairsDunnTest(k$x, k$g, p.adjust.method = "none"))
  rbar <- tapply(rank(k$x), k$g, mean)
  stats_l <- list(); pairs <- list()
  for (ij in pair_list(k$lv)) {
    a <- k$lv[ij[1]]; b <- k$lv[ij[2]]; term <- paste(a, "-", b)
    z <- sign(rbar[a] - rbar[b]) * dt$statistic[b, a]
    stats_l[[length(stats_l) + 1]] <- stat_rec("z", z, numeric(0), dt$p.value[b, a], term)
    rb <- rank_biserial(k$x[k$g == a], k$x[k$g == b], verbose = FALSE)
    pairs[[length(pairs) + 1]] <- list(term = term, statistic = num(z), p_unadjusted = num(du$p.value[b, a]),
                                       p_adjusted = num(dt$p.value[b, a]), rank_biserial = num(rb$r_rank_biserial),
                                       ci_lower = num(rb$CI_low), ci_upper = num(rb$CI_high))
  }
  fixture("posthoc.dunn", case, dataset,
          req(list(outcome = list("y"), group = list("group")), list(adjust = adjust)),
          list(n_used = length(k$x), n_excluded = k$n_excluded, statistics = stats_l, pairs = pairs),
          "PMCMRplus::kwAllPairsDunnTest (tie-corrected); z = (mean rank A - mean rank B)/SE; rank-biserial per pair")
}
dunn_case("four_holm", "np_four.csv", "holm")
dunn_case("four_bonferroni", "np_four.csv", "bonferroni")
dunn_case("four_bh", "np_four.csv", "BH")
dunn_case("three_small_holm", "np_three_small.csv", "holm")

# ---- Friedman + Conover / Nemenyi ---------------------------------------------------------
rm_data <- function(dataset, layout) {
  d <- load_dataset(dataset)
  if (layout == "wide") {
    cols <- grep("^t[0-9]", names(d), value = TRUE)
    m <- as.matrix(d[, cols]); cc <- stats::complete.cases(m)
    return(list(m = m[cc, , drop = FALSE], names = cols, vars = list(measures = as.list(cols)), opts = empty,
                n_excluded = sum(!cc),
                desc = lapply(cols, function(c) desc_rec(c, empty, d[[c]][cc], 0.95, sum(is.na(d[[c]]))))))
  }
  lv <- sort(unique(d$time)); ids <- unique(d$id)
  ok <- Filter(function(i) all(sapply(lv, function(l) sum(d$id == i & d$time == l) == 1)), ids)
  m <- sapply(lv, function(l) sapply(ok, function(i) d$score[d$id == i & d$time == l]))
  cc <- stats::complete.cases(m)
  list(m = m[cc, , drop = FALSE], names = lv, opts = empty,
       vars = list(outcome = list("score"), time = list("time"), subject_id = list("id")),
       n_excluded = sum(d$time %in% lv) - length(lv) * sum(cc),
       desc = lapply(lv, function(l) desc_rec("score", list(time = l), m[cc, l], 0.95,
                                                sum(is.na(d$score[d$time == l])))))
}

fr_case <- function(case, dataset, layout, ci = 0.95) {
  r <- rm_data(dataset, layout); m <- r$m
  ft <- stats::friedman.test(m)
  mm <- m; colnames(mm) <- r$names; rownames(mm) <- sprintf("b%03d", seq_len(nrow(mm)))
  set.seed(BOOT_SEED)
  kw <- kendalls_w(mm, ci = ci, iterations = BOOT_ITER, verbose = FALSE)
  fixture("friedman", case, dataset, req(r$vars, r$opts, "two_sided", ci),
          list(n_used = nrow(m), n_excluded = r$n_excluded,
               statistics = list(stat_rec("chi_sq", ft$statistic, ft$parameter, ft$p.value)),
               effect_sizes = list(es_rec("kendall_w", kw$Kendalls_W, kw$CI_low, kw$CI_high)),
               descriptives = r$desc, bootstrap = list(seed = BOOT_SEED, iterations = BOOT_ITER)),
          "friedman.test on complete cases (tie-corrected); Kendall's W (effectsize, tie-corrected), percentile bootstrap over blocks")
}
fr_case("rm3_wide", "np_rm3_wide.csv", "wide")
fr_case("rm5_long", "np_rm5_long.csv", "long")

frd_posthoc_case <- function(id, case, dataset, layout, adjust = NULL) {
  r <- rm_data(dataset, layout); m <- r$m; colnames(m) <- r$names; rownames(m) <- sprintf("b%03d", seq_len(nrow(m)))
  if (id == "posthoc.conover") {
    res <- frdAllPairsConoverTest(m, p.adjust.method = adjust)
    raw <- if (adjust == "single-step") res else frdAllPairsConoverTest(m, p.adjust.method = "none")
    key <- if (adjust == "single-step") "q" else "t"
    df <- if (adjust == "single-step") numeric(0) else res$parameter
    opts <- list(adjust = adjust)
  } else {
    res <- frdAllPairsNemenyiTest(m); raw <- res; key <- "q"; df <- numeric(0); opts <- empty
  }
  mr <- colMeans(t(apply(m, 1, rank)))
  stats_l <- list(); pairs <- list()
  for (ij in pair_list(r$names)) {
    a <- r$names[ij[1]]; b <- r$names[ij[2]]; term <- paste(a, "-", b)
    s <- res$statistic[b, a]
    if (id == "posthoc.nemenyi") s <- sign(mr[a] - mr[b]) * s
    stats_l[[length(stats_l) + 1]] <- stat_rec(key, s, df, res$p.value[b, a], term)
    rb <- rank_biserial(m[, a] - m[, b], verbose = FALSE)  # see PAIRED_RB note
    pairs[[length(pairs) + 1]] <- list(term = term, statistic = num(s), p_unadjusted = num(raw$p.value[b, a]),
                                       p_adjusted = num(res$p.value[b, a]), rank_biserial = num(rb$r_rank_biserial),
                                       ci_lower = num(rb$CI_low), ci_upper = num(rb$CI_high))
  }
  fixture(id, case, dataset, req(r$vars, opts),
          list(n_used = nrow(m), n_excluded = r$n_excluded, statistics = stats_l, pairs = pairs),
          "PMCMRplus frdAllPairs*Test on complete cases; statistic sign = first minus second condition")
}
frd_posthoc_case("posthoc.conover", "rm3_holm", "np_rm3_wide.csv", "wide", "holm")
frd_posthoc_case("posthoc.conover", "rm3_bh", "np_rm3_wide.csv", "wide", "BH")
frd_posthoc_case("posthoc.conover", "rm5_long_single_step", "np_rm5_long.csv", "long", "single-step")
frd_posthoc_case("posthoc.nemenyi", "rm3", "np_rm3_wide.csv", "wide")
frd_posthoc_case("posthoc.nemenyi", "rm5_long", "np_rm5_long.csv", "long")

cat("nonparametric fixtures written\n")
