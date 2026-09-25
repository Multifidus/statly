# Reference fixtures for the ANOVA family (Phase 3): anova.one_way, anova.welch,
# anova.repeated_measures, posthoc.tukey, posthoc.games_howell, posthoc.pairwise.
# Self-contained: generates its own seeded datasets (fixtures/expected/data/anova_*.csv) first,
# then writes fixtures/expected/anova/<case>.json. Conventions matched by engine/statly_engine/stats/
# anova.py, sphericity.py, posthoc_param.py, effect_sizes_anova.py (see stats/README.md, "ANOVA"):
#   * One-way: car::Anova(lm(y ~ g), type = 3) with contr.sum (identical to Type I / aov for one
#     factor); Welch: oneway.test(var.equal = FALSE).
#   * RM: afex::aov_ez(type = 3): F, Mauchly (car), GG and HF epsilon (car's HF = Huynh-Feldt-
#     Lecoutre; identical to the original HF without between factors), HF capped at 1 as afex does.
#   * Effect sizes: effectsize::eta_squared / omega_squared / cohens_f with ci = .95,
#     alternative = "two.sided". effectsize finds the noncentral-F bounds with Nelder-Mead (optim),
#     so the recorded CI is the exact inversion (uniroot, tol 1e-13) of the same pivot; effectsize's
#     own bounds are kept as effectsize_ci_lower / effectsize_ci_upper (information only).
#   * Post hoc direction is first level minus second (emmeans pairs); TukeyHSD and rstatix report
#     second minus first and are flipped. Studentized-range CIs use an exact qtukey inversion
#     (R's qtukey stops at eps = 1e-4); TukeyHSD / rstatix bounds are asserted within 1e-3.
if (!exists("R_DIR")) source(file.path(dirname(normalizePath(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))), "common.R"))
suppressPackageStartupMessages({
  library(afex); library(emmeans); library(effectsize); library(car); library(psych); library(rstatix)
})
options(contrasts = c("contr.sum", "contr.poly"))

DIR <- "anova"
ANOVA_PACKAGES <- c("afex", "emmeans", "rstatix", "effectsize", "car", "psych")
write_anova <- function(case, fx) {
  fx$r_anova_packages <- lapply(setNames(ANOVA_PACKAGES, ANOVA_PACKAGES),
                                function(p) as.character(utils::packageVersion(p)))
  write_fixture(DIR, case, fx)
}
error_anova <- function(case, analysis_id, dataset, request, expr) {
  msg <- tryCatch({ force(expr); NA_character_ }, error = function(e) conditionMessage(e))
  stopifnot(!is.na(msg))
  write_anova(case, list(analysis_id = analysis_id, case = case, dataset = dataset, request = request,
                         expected = NULL, error = msg))
}
unlink(file.path(EXPECTED, DIR, "*.json"))

# =============================================================================
# Datasets (seeded, rounded to 2 dp, blank = missing)
# =============================================================================
groups_df <- function(labels, ns, means, sds, digits = 2) {
  data.frame(group = rep(labels, ns),
             y = round(unlist(mapply(function(n, m, s) stats::rnorm(n, m, s), ns, means, sds,
                                     SIMPLIFY = FALSE)), digits),
             stringsAsFactors = FALSE)
}
set.seed(3101)
write_dataset(groups_df(c("Control", "Program"), c(15, 15), c(70, 76), c(8, 8)), "anova_two.csv")
write_dataset(groups_df(c("Control", "Peer", "Tutor"), c(20, 20, 20), c(70, 74, 78), c(8, 8, 8)),
              "anova_three.csv")
write_dataset(groups_df(c("Grade 5", "Grade 6", "Grade 7", "Grade 8"), c(8, 14, 21, 30),
                        c(60, 64, 63, 70), c(4, 8, 12, 16)), "anova_four_unequal.csv")
write_dataset(groups_df(c("A", "B", "C"), c(5, 5, 5), c(10, 12, 15), c(2, 2, 2)), "anova_small.csv")
m <- groups_df(c("Control", "Peer", "Tutor"), c(18, 18, 18), c(50, 55, 53), c(6, 6, 6))
m$y[c(3, 11, 20, 29, 44)] <- NA
m$group[c(7, 38)] <- NA
write_dataset(m, "anova_missing.csv")
cg <- groups_df(c("Control", "Peer", "Tutor"), c(10, 10, 10), c(20, 23, 24), c(3, 1, 3))
cg$y[cg$group == "Peer"] <- 23
write_dataset(cg, "anova_constant_group.csv")
write_dataset(data.frame(group = rep(c("Low", "Mid", "High"), each = 25),
                         y = c(sample(1:5, 25, TRUE, c(.20, .30, .30, .15, .05)),
                               sample(1:5, 25, TRUE, c(.10, .20, .35, .25, .10)),
                               sample(1:5, 25, TRUE, c(.05, .10, .30, .35, .20)))), "anova_ties.csv")
write_dataset(groups_df("Only", 12, 5, 1), "anova_single_group.csv")

# Repeated measures: 3 time points (roughly spherical) and 5 time points (random-walk errors:
# variance grows and correlation decays over time, a clear sphericity violation).
set.seed(7)  # rm3: spherical (Mauchly p > .05; HF epsilon > 1, capped)
n3 <- 24
b3 <- stats::rnorm(n3, 0, 6)
rm3 <- data.frame(id = sprintf("S%02d", 1:n3),
                  pre = round(50 + b3 + stats::rnorm(n3, 0, 4), 2),
                  mid = round(53 + b3 + stats::rnorm(n3, 0, 4), 2),
                  post = round(55 + b3 + stats::rnorm(n3, 0, 4), 2), stringsAsFactors = FALSE)
rm3$mid[c(4, 17)] <- NA
rm3$post[9] <- NA
write_dataset(rm3, "anova_rm3_wide.csv")
long3 <- do.call(rbind, lapply(seq_along(c("pre", "mid", "post")), function(j) {
  data.frame(id = rm3$id, time = j, score = rm3[[c("pre", "mid", "post")[j]]], stringsAsFactors = FALSE)
}))
long3 <- long3[!(long3$id == "S09" & long3$time == 3), ]          # a person missing a time point
long3 <- rbind(long3, data.frame(id = "S99", time = 1, score = 51.5))  # an unmatched ID
long3 <- rbind(long3, data.frame(id = NA, time = 2, score = 49.25))  # a row with no ID
long3 <- long3[sample(nrow(long3)), ]
write_dataset(long3, "anova_rm3_long.csv")

n5 <- 30
b5 <- stats::rnorm(n5, 0, 3)
walk <- t(apply(matrix(stats::rnorm(n5 * 5, 0, 3), n5, 5), 1, cumsum))
rm5 <- as.data.frame(round(sweep(walk, 2, c(40, 42, 45, 46, 50), "+") + b5, 2))
names(rm5) <- paste0("w", 1:5)
rm5 <- cbind(id = sprintf("P%02d", 1:n5), rm5, stringsAsFactors = FALSE)
write_dataset(rm5, "anova_rm5_wide.csv")
long5 <- do.call(rbind, lapply(1:5, function(j) {
  data.frame(id = rm5$id, week = j, score = rm5[[paste0("w", j)]], stringsAsFactors = FALSE)
}))
long5$score[long5$id == "P07" & long5$week == 4] <- NA
long5 <- long5[sample(nrow(long5)), ]
write_dataset(long5, "anova_rm5_long.csv")

# =============================================================================
# Helpers
# =============================================================================
empty_obj <- setNames(list(), character(0))
grp <- function(name, value) setNames(list(value), name)

# Exact inversion of the noncentral-F pivot (the root effectsize:::.get_ncp_F approximates).
ncp_F_exact <- function(f, df1, df2, level) {
  if (!is.finite(f)) return(c(NA, NA))
  a <- 1 - level
  cdf <- function(l) if (l <= 0) stats::pf(f, df1, df2) else stats::pf(f, df1, df2, ncp = l)
  solve <- function(p) {
    if (cdf(0) <= p) return(0)
    stats::uniroot(function(l) cdf(l) - p, c(0, max(10, 4 * f * df1 + 50)), extendInt = "downX",
                   tol = 1e-13, maxiter = 5000)$root
  }
  out <- c(solve(1 - a / 2), solve(a / 2))
  if (f <= stats::qf(a / 2, df1, df2)) out[2] <- 0
  if (f <= stats::qf(1 - a / 2, df1, df2)) out[1] <- 0
  out
}
# Proportion-of-variance record (eta2 / omega2 / generalized eta2) with effectsize's CI convention:
# F implied by the estimate, exact ncp bounds, mapped back as lambda / (lambda + df2).
pve_rec <- function(key, value, df1, df2, ci, es_lo = NULL, es_hi = NULL, cohens_f = FALSE) {
  v <- max(0, value)
  lam <- ncp_F_exact((v / df1) / ((1 - v) / df2), df1, df2, ci)
  b <- lam / (lam + df2)
  if (cohens_f) { value <- sqrt(v / (1 - v)); b <- sqrt(b / (1 - b)) }
  if (!is.null(es_lo)) stopifnot(abs(es_lo - b[1]) < 2e-3, abs(es_hi - b[2]) < 2e-3)
  rec <- es_rec(key, value, b[1], b[2])
  rec$effectsize_ci_lower <- num(es_lo)
  rec$effectsize_ci_upper <- num(es_hi)
  rec
}
qtukey_exact <- function(level, k, df) {
  stats::uniroot(function(q) stats::ptukey(q, k, df) - level, c(0.01, 100), tol = 1e-13,
                 maxiter = 5000)$root
}
between <- function(dataset) {
  d <- load_dataset(dataset)
  levels_ <- sort(unique(d$group[!is.na(d$group)]))
  keep <- !is.na(d$y) & !is.na(d$group)
  list(d = d, levels = levels_, y = d$y[keep], g = factor(d$group[keep], levels = levels_),
       n_excluded = nrow(d) - sum(keep))
}
between_desc <- function(b, ci) lapply(b$levels, function(lv) {
  desc_rec("y", grp("group", lv), b$d$y[!is.na(b$d$group) & b$d$group == lv], ci)
})
between_asm <- function(b) c(list(levene_rec(b$y, b$g)),
                             lapply(b$levels, function(lv) shapiro_rec(b$y[b$g == lv], lv)))
pairs_of <- function(k) utils::combn(k, 2, simplify = FALSE)
g_rec <- function(x, y, ci, term) {
  hg <- effectsize::hedges_g(x, y, pooled_sd = TRUE, ci = ci, verbose = FALSE)
  n1 <- length(x); n2 <- length(y)
  sp <- sqrt(((n1 - 1) * var(x) + (n2 - 1) * var(y)) / (n1 + n2 - 2))
  tt <- (mean(x) - mean(y)) / (sp * sqrt(1 / n1 + 1 / n2))
  if (!is.finite(tt)) return(c(es_rec("hedges_g", NA), term = term))
  c(es_rec_nct("hedges_g", hg$Hedges_g, hg, tt, n1 + n2 - 2, 1 / n1 + 1 / n2, ci, "two.sided",
               adjust = TRUE), term = term)
}
term_of <- function(a, b) paste(a, "vs", b)

# =============================================================================
# One-way and Welch ANOVA
# =============================================================================
oneway_case <- function(case, dataset, analysis_id = "anova.one_way", ci = 0.95) {
  b <- between(dataset)
  request <- req(list(outcome = list("y"), group = list("group")), empty_obj, "two_sided", ci)
  if (length(b$levels) < 2) {
    return(error_anova(case, analysis_id, dataset, request, stats::oneway.test(b$y ~ b$g)))
  }
  fit <- stats::lm(y ~ g, data = data.frame(y = b$y, g = b$g))
  a3 <- car::Anova(fit, type = 3)
  a1 <- stats::anova(fit)
  stopifnot(abs(a3["g", "F value"] - a1["g", "F value"]) < 1e-9)   # Type III == Type I for one factor
  F <- a3["g", "F value"]; df1 <- a3["g", "Df"]; df2 <- a3["Residuals", "Df"]
  classic <- stat_rec("F", F, c(df1, df2), a3["g", "Pr(>F)"])
  w <- suppressWarnings(stats::oneway.test(b$y ~ b$g, var.equal = FALSE))
  welch <- if (is.finite(w$statistic)) stat_rec("welch_F", w$statistic, w$parameter, w$p.value)
           else stat_rec("welch_F", NA, numeric(0), NA)   # a zero-variance group: weights n / 0
  if (analysis_id == "anova.one_way") {
    av <- stats::aov(y ~ g, data = data.frame(y = b$y, g = b$g))
    e <- effectsize::eta_squared(av, partial = FALSE, ci = ci, alternative = "two.sided", verbose = FALSE)
    o <- effectsize::omega_squared(av, partial = FALSE, ci = ci, alternative = "two.sided", verbose = FALSE)
    cf <- effectsize::cohens_f(av, partial = FALSE, ci = ci, alternative = "two.sided", verbose = FALSE)
    stopifnot(abs(e$Eta2 - a1["g", "Sum Sq"] / sum(a1[, "Sum Sq"])) < 1e-12)
    effects <- list(pve_rec("eta_sq", e$Eta2, df1, df2, ci, e$CI_low, e$CI_high),
                    pve_rec("omega_sq", o$Omega2, df1, df2, ci, o$CI_low, o$CI_high),
                    pve_rec("cohens_f", e$Eta2, df1, df2, ci, cf$CI_low, cf$CI_high, cohens_f = TRUE))
    stopifnot(abs(effects[[3]]$value - cf$Cohens_f) < 1e-12)
    statistics <- list(classic, welch)
  } else {
    # effectsize::effectsize(oneway.test(...)) -> F_to_eta2 on the Welch F and df.
    wf <- unname(w$statistic); wd <- unname(w$parameter)
    if (is.finite(wf)) {
      e <- effectsize::F_to_eta2(wf, wd[1], wd[2], ci = ci, alternative = "two.sided")
      o <- effectsize::F_to_omega2(wf, wd[1], wd[2], ci = ci, alternative = "two.sided")
      cf <- effectsize::F_to_f(wf, wd[1], wd[2], ci = ci, alternative = "two.sided")
      ee <- effectsize::effectsize(w, ci = ci, alternative = "two.sided", verbose = FALSE)
      stopifnot(abs(ee[[1]] - e$Eta2_partial) < 1e-12)
      effects <- list(pve_rec("eta_sq", e$Eta2_partial, wd[1], wd[2], ci, e$CI_low, e$CI_high),
                      pve_rec("omega_sq", o$Omega2_partial, wd[1], wd[2], ci, o$CI_low, o$CI_high),
                      pve_rec("cohens_f", e$Eta2_partial, wd[1], wd[2], ci, cf$CI_low, cf$CI_high,
                              cohens_f = TRUE))
    } else {
      effects <- lapply(c("eta_sq", "omega_sq", "cohens_f"), function(k) es_rec(k, NA))
    }
    statistics <- list(welch, classic)
  }
  write_anova(case, list(
    analysis_id = analysis_id, case = case, dataset = dataset, request = request,
    expected = list(n_used = length(b$y), n_excluded = b$n_excluded, statistics = statistics,
                    effect_sizes = effects, descriptives = between_desc(b, ci),
                    assumptions = between_asm(b)),
    error = NULL))
}
for (cs in list(c("two", "anova_two.csv"), c("three", "anova_three.csv"),
                c("four_unequal", "anova_four_unequal.csv"), c("small_n", "anova_small.csv"),
                c("missing", "anova_missing.csv"), c("constant_group", "anova_constant_group.csv"),
                c("ties", "anova_ties.csv"), c("single_group", "anova_single_group.csv"))) {
  oneway_case(paste0("one_way__", cs[1]), cs[2])
}
for (cs in list(c("two", "anova_two.csv"), c("three", "anova_three.csv"),
                c("four_unequal", "anova_four_unequal.csv"), c("small_n", "anova_small.csv"),
                c("missing", "anova_missing.csv"), c("constant_group", "anova_constant_group.csv"))) {
  oneway_case(paste0("welch__", cs[1]), cs[2], "anova.welch")
}
oneway_case("one_way__three_ci90", "anova_three.csv", ci = 0.90)

# =============================================================================
# Post hoc: Tukey HSD, Games-Howell, pairwise t (between)
# =============================================================================
posthoc_between_case <- function(case, dataset, analysis_id, adjust = NULL, ci = 0.95) {
  b <- between(dataset)
  opts <- if (is.null(adjust)) empty_obj else list(adjust = adjust)
  request <- req(list(outcome = list("y"), group = list("group")), opts, "two_sided", ci)
  k <- length(b$levels)
  xs <- lapply(b$levels, function(lv) b$y[b$g == lv])
  fit <- stats::lm(y ~ g, data = data.frame(y = b$y, g = b$g))
  emm <- emmeans::emmeans(fit, "g")
  stats_l <- list(); eff <- list()
  pr <- pairs_of(k)
  m <- length(pr)
  if (analysis_id == "posthoc.tukey") {
    tk <- stats::TukeyHSD(stats::aov(y ~ g, data = data.frame(y = b$y, g = b$g)), conf.level = ci)$g
    em <- summary(pairs(emm, adjust = "tukey"), infer = c(TRUE, TRUE), level = ci)
    df_e <- stats::df.residual(fit)
    qc <- qtukey_exact(ci, k, df_e)
    for (r in seq_along(pr)) {
      i <- pr[[r]][1]; j <- pr[[r]][2]
      tkrow <- tk[paste0(b$levels[j], "-", b$levels[i]), ]
      diff <- -tkrow[["diff"]]
      stopifnot(abs(diff - em$estimate[r]) < 1e-9, abs(tkrow[["p adj"]] - em$p.value[r]) < 1e-6)
      se <- em$SE[r]
      lo <- diff - qc / sqrt(2) * se; hi <- diff + qc / sqrt(2) * se
      stopifnot(abs(lo + tkrow[["upr"]]) < 1e-3, abs(hi + tkrow[["lwr"]]) < 1e-3)
      term <- term_of(b$levels[i], b$levels[j])
      p <- stats::ptukey(abs(diff / se) * sqrt(2), k, df_e, lower.tail = FALSE)
      stopifnot(abs(p - tkrow[["p adj"]]) < 1e-12)
      stats_l[[r]] <- stat_rec("t", em$t.ratio[r], df_e, p, term)
      md <- c(es_rec("mean_difference", diff, lo, hi), term = term)
      md$tukeyhsd_ci_lower <- -tkrow[["upr"]]; md$tukeyhsd_ci_upper <- -tkrow[["lwr"]]
      eff[[length(eff) + 1]] <- md
      eff[[length(eff) + 1]] <- g_rec(xs[[i]], xs[[j]], ci, term)
    }
  } else if (analysis_id == "posthoc.games_howell") {
    gh <- suppressWarnings(rstatix::games_howell_test(data.frame(y = b$y, g = b$g), y ~ g,
                                                        conf.level = ci, detailed = TRUE))
    for (r in seq_along(pr)) {
      i <- pr[[r]][1]; j <- pr[[r]][2]
      row <- gh[gh$group1 == b$levels[i] & gh$group2 == b$levels[j], ]
      stopifnot(nrow(row) == 1)
      term <- term_of(b$levels[i], b$levels[j])
      x <- xs[[i]]; y <- xs[[j]]
      diff <- mean(x) - mean(y)
      stopifnot(abs(diff + row$estimate) < 1e-9)
      se <- sqrt(var(x) / length(x) + var(y) / length(y))
      dfw <- row$df
      if (!is.finite(dfw) || se == 0) {
        stats_l[[r]] <- stat_rec("t", NA, numeric(0), NA, term)
        eff[[length(eff) + 1]] <- c(es_rec("mean_difference", diff), term = term)
      } else {
        qc <- qtukey_exact(ci, k, dfw)
        lo <- diff - qc * se / sqrt(2); hi <- diff + qc * se / sqrt(2)
        stopifnot(abs(lo + row$conf.high) < 1e-3, abs(hi + row$conf.low) < 1e-3)
        stats_l[[r]] <- stat_rec("t", diff / se, dfw, row$p.adj, term)
        md <- c(es_rec("mean_difference", diff, lo, hi), term = term)
        md$rstatix_ci_lower <- -row$conf.high; md$rstatix_ci_upper <- -row$conf.low
        eff[[length(eff) + 1]] <- md
      }
      eff[[length(eff) + 1]] <- g_rec(x, y, ci, term)
    }
  } else {
    pw <- stats::pairwise.t.test(b$y, b$g, p.adjust.method = adjust, pool.sd = TRUE)$p.value
    em <- summary(pairs(emm, adjust = adjust), infer = c(TRUE, TRUE), level = ci)
    df_e <- stats::df.residual(fit)
    qc <- stats::qt(1 - (1 - ci) / (2 * m), df_e)                 # Bonferroni-adjusted CI (emmeans)
    for (r in seq_along(pr)) {
      i <- pr[[r]][1]; j <- pr[[r]][2]
      term <- term_of(b$levels[i], b$levels[j])
      p <- pw[b$levels[j], b$levels[i]]
      stopifnot(abs(p - em$p.value[r]) < 1e-9)
      diff <- em$estimate[r]; se <- em$SE[r]
      stopifnot(abs(diff - qc * se - em$lower.CL[r]) < 1e-6)
      stats_l[[r]] <- stat_rec("t", em$t.ratio[r], df_e, p, term)
      eff[[length(eff) + 1]] <- c(es_rec("mean_difference", diff, diff - qc * se, diff + qc * se), term = term)
      eff[[length(eff) + 1]] <- g_rec(xs[[i]], xs[[j]], ci, term)
    }
  }
  write_anova(case, list(
    analysis_id = analysis_id, case = case, dataset = dataset, request = request,
    expected = list(n_used = length(b$y), n_excluded = b$n_excluded, statistics = stats_l,
                    effect_sizes = eff, descriptives = between_desc(b, ci)),
    error = NULL))
}
for (cs in list(c("three", "anova_three.csv"), c("four_unequal", "anova_four_unequal.csv"),
                c("small_n", "anova_small.csv"), c("missing", "anova_missing.csv"),
                c("ties", "anova_ties.csv"), c("two", "anova_two.csv"))) {
  posthoc_between_case(paste0("tukey__", cs[1]), cs[2], "posthoc.tukey")
}
for (cs in list(c("three", "anova_three.csv"), c("four_unequal", "anova_four_unequal.csv"),
                c("small_n", "anova_small.csv"), c("missing", "anova_missing.csv"),
                c("constant_group", "anova_constant_group.csv"))) {
  posthoc_between_case(paste0("games_howell__", cs[1]), cs[2], "posthoc.games_howell")
}
posthoc_between_case("pairwise__three_holm", "anova_three.csv", "posthoc.pairwise", "holm")
posthoc_between_case("pairwise__four_unequal_bonferroni", "anova_four_unequal.csv", "posthoc.pairwise",
                     "bonferroni")
posthoc_between_case("pairwise__missing_holm", "anova_missing.csv", "posthoc.pairwise", "holm")
posthoc_between_case("pairwise__ties_holm", "anova_ties.csv", "posthoc.pairwise", "holm")

# =============================================================================
# Repeated measures (wide and long) + paired pairwise
# =============================================================================
# Returns the complete-case matrix exactly as the engine builds it, plus descriptives inputs.
rm_data <- function(dataset, layout, measures = NULL, time = NULL) {
  d <- load_dataset(dataset)
  if (layout == "wide") {
    Y <- as.matrix(d[, measures])
    cc <- stats::complete.cases(Y)
    return(list(Y = Y[cc, , drop = FALSE], names = measures, n_excluded = sum(!cc),
                desc = lapply(seq_along(measures), function(j)
                  desc_rec(measures[j], empty_obj, Y[cc, j], 0.95, n_missing = sum(is.na(Y[, j]))))))
  }
  levels_ <- sort(unique(d[[time]][!is.na(d[[time]])]))
  in_lv <- d[[time]] %in% levels_
  f <- d[in_lv & !is.na(d$id), ]
  tab <- table(factor(f$id), factor(f[[time]], levels = levels_))
  ok <- rownames(tab)[apply(tab == 1, 1, all)]
  f <- f[f$id %in% ok, ]
  Y <- sapply(levels_, function(lv) { s <- f[f[[time]] == lv, ]; s$score[match(sort(ok), s$id)] })
  rownames(Y) <- sort(ok)
  cc <- stats::complete.cases(Y)
  n <- sum(cc)
  list(Y = Y[cc, , drop = FALSE], names = as.character(levels_), n_excluded = sum(in_lv) - length(levels_) * n,
       desc = lapply(seq_along(levels_), function(j)
         desc_rec("score", grp(time, levels_[j]), Y[cc, j], 0.95,
                  n_missing = sum(is.na(d$score[d[[time]] %in% levels_[j]])))))
}
rm_request <- function(layout, measures, time, opts) {
  v <- if (layout == "wide") list(measures = as.list(measures))
       else list(outcome = list("score"), time = list(time), subject_id = list("id"))
  req(v, opts)
}

rm_case <- function(case, dataset, layout, measures = NULL, time = NULL, correction = NULL, ci = 0.95) {
  rd <- rm_data(dataset, layout, measures, time)
  Y <- rd$Y; n <- nrow(Y); k <- ncol(Y)
  long <- data.frame(id = factor(rep(seq_len(n), k)), time = factor(rep(seq_len(k), each = n)),
                     score = as.vector(Y))
  fit <- afex::aov_ez("id", "score", long, within = "time", type = 3)
  an <- anova(fit, correction = "none", es = "none")
  s <- summary(fit)
  F <- an["time", "F"]; df1 <- an["time", "num Df"]; df2 <- an["time", "den Df"]
  gg <- s$pval.adjustments["time", "GG eps"]; hf_raw <- s$pval.adjustments["time", "HF eps"]
  hf <- min(1, hf_raw)
  an_gg <- anova(fit, correction = "GG", es = "none")
  an_hf <- suppressWarnings(anova(fit, correction = "HF", es = "none"))
  stopifnot(abs(an_gg["time", "num Df"] - df1 * gg) < 1e-9, abs(an_hf["time", "num Df"] - df1 * hf) < 1e-9)
  W <- s$sphericity.tests["time", "Test statistic"]; pW <- s$sphericity.tests["time", "p-value"]
  mt <- stats::mauchly.test(stats::lm(Y ~ 1), X = ~1)
  stopifnot(abs(mt$statistic - W) < 1e-10, abs(mt$p.value - pW) < 1e-10)
  mode <- if (is.null(correction)) "auto" else correction
  rec <- list(F = stat_rec("F", F, c(df1, df2), an["time", "Pr(>F)"]),
              F_gg = stat_rec("F_gg", an_gg["time", "F"], c(df1 * gg, df2 * gg), an_gg["time", "Pr(>F)"]),
              F_hf = stat_rec("F_hf", an_hf["time", "F"], c(df1 * hf, df2 * hf), an_hf["time", "Pr(>F)"]))
  head <- switch(mode, auto = if (pW < 0.05) "F_gg" else "F", none = "F", gg = "F_gg", hf = "F_hf")
  statistics <- c(list(rec[[head]]), unname(rec[setdiff(c("F", "F_gg", "F_hf"), head)]),
                  list(stat_rec("epsilon_gg", gg), stat_rec("epsilon_hf", hf)))
  pes <- effectsize::eta_squared(fit, partial = TRUE, ci = ci, alternative = "two.sided", verbose = FALSE)
  ges <- effectsize::eta_squared(fit, generalized = TRUE, ci = ci, alternative = "two.sided", verbose = FALSE)
  om <- effectsize::omega_squared(fit, partial = TRUE, ci = ci, alternative = "two.sided", verbose = FALSE)
  cf <- effectsize::cohens_f(fit, partial = TRUE, ci = ci, alternative = "two.sided", verbose = FALSE)
  ges_afex <- anova(fit, es = "ges")["time", "ges"]
  stopifnot(abs(ges$Eta2_generalized - ges_afex) < 1e-12)
  effects <- list(pve_rec("partial_eta_sq", pes$Eta2_partial, df1, df2, ci, pes$CI_low, pes$CI_high),
                  pve_rec("generalized_eta_sq", ges$Eta2_generalized, df1, df2, ci, ges$CI_low, ges$CI_high),
                  pve_rec("omega_sq", om$Omega2_partial, df1, df2, ci, om$CI_low, om$CI_high),
                  pve_rec("cohens_f", pes$Eta2_partial, df1, df2, ci, cf$CI_low, cf$CI_high, cohens_f = TRUE))
  stopifnot(abs(effects[[4]]$value - cf$Cohens_f_partial) < 1e-12)
  asm <- c(list(list(test = "mauchly", scope = "overall", n = n, statistic = num(W), p = num(pW),
                     df = list(k * (k - 1) / 2 - 1))),
           lapply(seq_len(k), function(j) shapiro_rec(Y[, j], rd$names[j])))
  opts <- if (is.null(correction)) empty_obj else list(correction = correction)
  write_anova(case, list(
    analysis_id = "anova.repeated_measures", case = case, dataset = dataset,
    request = rm_request(layout, measures, time, opts),
    expected = list(n_used = n, n_excluded = rd$n_excluded, statistics = statistics, effect_sizes = effects,
                    descriptives = rd$desc, assumptions = asm,
                    epsilon_hf_uncapped = num(hf_raw)),
    error = NULL))
}
rm_case("rm__three_wide", "anova_rm3_wide.csv", "wide", measures = c("pre", "mid", "post"))
rm_case("rm__three_long", "anova_rm3_long.csv", "long", time = "time")
rm_case("rm__five_wide", "anova_rm5_wide.csv", "wide", measures = paste0("w", 1:5))
rm_case("rm__five_long", "anova_rm5_long.csv", "long", time = "week")
rm_case("rm__five_wide_hf", "anova_rm5_wide.csv", "wide", measures = paste0("w", 1:5), correction = "hf")
rm_case("rm__three_wide_none", "anova_rm3_wide.csv", "wide", measures = c("pre", "mid", "post"),
        correction = "none")

# Paired pairwise t (pairwise.t.test(paired = TRUE)); CI = paired t CI at the Bonferroni level.
rm_pairwise_case <- function(case, dataset, layout, measures = NULL, time = NULL, adjust = "holm", ci = 0.95) {
  rd <- rm_data(dataset, layout, measures, time)
  Y <- rd$Y; n <- nrow(Y); k <- ncol(Y)
  pr <- pairs_of(k); m <- length(pr)
  pw <- stats::pairwise.t.test(as.vector(Y), factor(rep(seq_len(k), each = n)), paired = TRUE,
                               p.adjust.method = adjust)$p.value
  stats_l <- list(); eff <- list()
  for (r in seq_along(pr)) {
    i <- pr[[r]][1]; j <- pr[[r]][2]
    term <- term_of(rd$names[i], rd$names[j])
    tt <- stats::t.test(Y[, i], Y[, j], paired = TRUE, conf.level = 1 - (1 - ci) / m)
    stats_l[[r]] <- stat_rec("t", tt$statistic, tt$parameter, pw[as.character(j), as.character(i)], term)
    eff[[length(eff) + 1]] <- c(es_rec("mean_difference", mean(Y[, i] - Y[, j]), tt$conf.int[1],
                                       tt$conf.int[2]), term = term)
    dav <- effectsize::repeated_measures_d(Y[, i], Y[, j], method = "av", adjust = FALSE, ci = ci, verbose = FALSE)
    eff[[length(eff) + 1]] <- c(es_rec("d_av", dav[[1]], dav$CI_low, dav$CI_high), term = term)
  }
  write_anova(case, list(
    analysis_id = "posthoc.pairwise", case = case, dataset = dataset,
    request = rm_request(layout, measures, time, list(adjust = adjust)),
    expected = list(n_used = n, n_excluded = rd$n_excluded, statistics = stats_l, effect_sizes = eff,
                    descriptives = rd$desc),
    error = NULL))
}
rm_pairwise_case("pairwise__rm_three_wide_holm", "anova_rm3_wide.csv", "wide", measures = c("pre", "mid", "post"))
rm_pairwise_case("pairwise__rm_three_long_holm", "anova_rm3_long.csv", "long", time = "time")
rm_pairwise_case("pairwise__rm_five_long_bonferroni", "anova_rm5_long.csv", "long", time = "week",
                 adjust = "bonferroni")

cat("anova fixtures written:", length(list.files(file.path(EXPECTED, DIR))), "\n")
