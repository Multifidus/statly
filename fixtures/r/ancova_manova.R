# Reference fixtures for ANCOVA, Quade's rank ANCOVA, MANOVA and MANCOVA (Phase 5): ancova, ancova.quade,
# manova, mancova. Self-contained: generates its own seeded datasets (fixtures/expected/data/anc_*.csv)
# first, then writes fixtures/expected/ancova_manova/<case>.json. Conventions matched by
# engine/statly_engine/stats/ancova.py, quade.py, manova.py, assumptions_multivariate.py (stats/README.md,
# "ANCOVA / MANOVA"):
#   * ANCOVA: car::Anova(lm(y ~ covariates + group), type = 3) under contr.sum; complete cases. Adjusted
#     (estimated marginal) means = emmeans(fit, "group") (covariates at their means); pairwise adjusted-mean
#     comparisons = pairs(emm, adjust = holm | bonferroni | tukey), first minus second. Holm/Bonferroni CIs are
#     Bonferroni-adjusted (emmeans); Tukey CIs use an exact qtukey inversion (R's qtukey stops at eps 1e-4).
#     Partial eta2 / partial omega2 / Cohen's f = effectsize(car::Anova(...), partial = TRUE,
#     alternative = "two.sided"); recorded CIs are the exact noncentral-F inversion (effectsize uses optim).
#     Assumptions: slopes = anova(fit, fit + group:covariates) (joint F); linearity = per group and covariate,
#     anova(lm(y ~ x), lm(y ~ x + I(x^2))); Levene (median) and Shapiro-Wilk on the model residuals.
#   * Quade (1967; Conover 1999, sec. 5.?): rank y and every covariate over all cases (average ranks),
#     regress rank(y) on the covariate ranks ignoring groups, one-way ANOVA of the residuals by group.
#     No CRAN function implements it; stats::quade.test is a different test (unreplicated complete block
#     design), so the reference is plain lm + anova. Effect sizes = effectsize on aov(residuals ~ group).
#   * MANOVA / MANCOVA: car::Manova(lm(cbind(y1, ...) ~ group [+ covariates]), type = 3) under contr.sum;
#     Pillai (headline), Wilks, Hotelling-Lawley and Roy from car's internal Pillai/Wilks/HL/Roy on the
#     eigenvalues of SSPE^-1 SSPH. Partial eta2 = effectsize::eta_squared(Manova) = F df1 / (F df1 + df2) of
#     Pillai's approximate F (= V / s). Follow-ups: car::Anova(lm(y_j ~ group [+ cov]), type = 3) per
#     outcome, Bonferroni across outcomes. Box's M = heplots::boxM; Mahalanobis D2 of the residuals with
#     S = SSPE / df_error, flagged at qchisq(.999, p); multicollinearity = max |r| among outcomes (> .9).
if (!exists("R_DIR")) source(file.path(dirname(normalizePath(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))), "common.R"))
suppressPackageStartupMessages({
  library(car); library(emmeans); library(effectsize); library(heplots); library(psych)
})
options(contrasts = c("contr.sum", "contr.poly"))

DIR <- "ancova_manova"
PKGS <- c("car", "emmeans", "effectsize", "heplots", "psych")
write_anc <- function(case, fx) {
  fx$r_ancova_packages <- lapply(setNames(PKGS, PKGS), function(p) as.character(utils::packageVersion(p)))
  write_fixture(DIR, case, fx)
}
unlink(file.path(EXPECTED, DIR, "*.json"))
empty_obj <- setNames(list(), character(0))
grp <- function(name, value) setNames(list(value), name)

# =============================================================================
# Datasets (seeded, rounded to 2 dp, blank = missing)
# =============================================================================
r2 <- function(x) round(x, 2)
set.seed(5101)
mk <- function(labels, ns, pre_means, effects, slopes, pre_sd = 8, err = 4, base = 10) {
  g <- rep(labels, ns)
  pre <- unlist(mapply(function(n, m) stats::rnorm(n, m, pre_sd), ns, pre_means, SIMPLIFY = FALSE))
  eff <- rep(effects, ns); sl <- rep(slopes, ns)
  post <- base + sl * pre + eff + stats::rnorm(length(g), 0, err)
  data.frame(group = g, pre = r2(pre), post = r2(post), stringsAsFactors = FALSE)
}
write_dataset(mk(c("Control", "Program"), c(20, 20), c(50, 52), c(0, 4), c(.6, .6)), "anc_two.csv")
write_dataset(mk(c("Control", "Peer", "Tutor"), c(12, 18, 25), c(58, 60, 63), c(0, 3, 6), c(.7, .7, .7)),
              "anc_three_unequal.csv")
tc <- mk(c("Control", "Peer", "Tutor"), c(20, 20, 20), c(50, 50, 50), c(0, 2, 5), c(.5, .5, .5))
tc$gpa <- r2(stats::rnorm(60, 3, .5))
tc$post <- r2(tc$post + 4 * tc$gpa)
write_dataset(tc, "anc_two_cov.csv")
write_dataset(mk(c("Control", "Peer", "Tutor"), c(20, 20, 20), c(50, 50, 50), c(0, 0, 0), c(.2, .8, 1.4),
                 base = 20), "anc_slopes.csv")
ms <- mk(c("Control", "Peer", "Tutor"), c(18, 18, 18), c(50, 51, 52), c(0, 2, 4), c(.6, .6, .6))
ms$post[c(3, 21, 40)] <- NA
ms$pre[c(8, 30)] <- NA
ms$group[c(12, 50)] <- NA
write_dataset(ms, "anc_missing.csv")
write_dataset(mk(c("A", "B", "C"), c(5, 5, 5), c(50, 50, 50), c(0, 3, 6), c(.8, .8, .8), err = 3), "anc_small.csv")
write_dataset(data.frame(group = rep("Only", 10), pre = r2(stats::rnorm(10, 50, 5)),
                         post = r2(stats::rnorm(10, 55, 5))), "anc_single_group.csv")
# Likert-type (1-5) outcome and covariates with many ties, for Quade.
lk_n <- c(15, 15, 15)
lk_g <- rep(c("Low", "Mid", "High"), lk_n)
lk_pre <- sample(1:5, sum(lk_n), TRUE, c(.15, .25, .3, .2, .1))
lk_int <- sample(1:5, sum(lk_n), TRUE, c(.1, .2, .4, .2, .1))
lk_post <- pmin(5, pmax(1, round(lk_pre * .6 + rep(c(0, .6, 1.2), lk_n) + .3 * lk_int + stats::rnorm(sum(lk_n), 0, .8))))
write_dataset(data.frame(group = lk_g, pre = lk_pre, interest = lk_int, post = lk_post), "anc_likert.csv")

# Multivariate: correlated outcomes y1..y3, a pretest covariate.
mv <- function(labels, ns, shifts, seed) {
  set.seed(seed)
  n <- sum(ns); g <- rep(labels, ns)
  pre <- stats::rnorm(n, 50, 8)
  Z <- matrix(stats::rnorm(n * 3), n, 3) %*% chol(matrix(c(1, .5, .3, .5, 1, .4, .3, .4, 1), 3))
  sh <- do.call(rbind, lapply(seq_along(labels), function(i) matrix(shifts[[i]], ns[i], 3, byrow = TRUE)))
  Y <- 20 + outer(pre, c(.5, .3, .2)) + sh + Z * 4
  data.frame(group = g, pre = r2(pre), y1 = r2(Y[, 1]), y2 = r2(Y[, 2]), y3 = r2(Y[, 3]),
             stringsAsFactors = FALSE)
}
write_dataset(mv(c("Control", "Program"), c(20, 24), list(c(0, 0, 0), c(3, 1, -1)), 5202), "anc_mv_two.csv")
m3 <- mv(c("Control", "Peer", "Tutor"), c(16, 20, 18), list(c(0, 0, 0), c(2, 2, 0), c(4, 1, -2)), 5303)
m3$y2[c(5, 33)] <- NA
m3$y3[17] <- NA
m3$pre[41] <- NA
m3$group[26] <- NA
write_dataset(m3, "anc_mv_three.csv")

# =============================================================================
# Helpers
# =============================================================================
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
# Proportion of variance with effectsize's CI convention (F implied by the estimate, exact ncp bounds).
pve_rec <- function(key, value, df1, df2, ci, es_lo = NULL, es_hi = NULL, cohens_f = FALSE, term = NULL) {
  v <- max(0, value)
  lam <- ncp_F_exact((v / df1) / ((1 - v) / df2), df1, df2, ci)
  b <- lam / (lam + df2)
  if (cohens_f) { value <- sqrt(v / (1 - v)); b <- sqrt(b / (1 - b)) }
  if (!is.null(es_lo)) stopifnot(abs(es_lo - b[1]) < 1e-2, abs(es_hi - b[2]) < 1e-2)   # optim can miss by ~6e-3
  rec <- es_rec(key, value, b[1], b[2])
  rec$effectsize_ci_lower <- num(es_lo)
  rec$effectsize_ci_upper <- num(es_hi)
  if (!is.null(term)) rec$term <- term
  rec
}
qtukey_exact <- function(level, k, df) {
  stats::uniroot(function(q) stats::ptukey(q, k, df) - level, c(0.01, 100), tol = 1e-13, maxiter = 5000)$root
}
term_of <- function(a, b) paste(a, "vs", b)
asm_rec <- function(test, scope, n, statistic, df = numeric(0), p = NULL) {
  list(test = test, scope = scope, n = n, statistic = num(statistic),
       df = if (length(df)) lapply(unname(as.numeric(df)), num) else list(), p = num(p))
}
levene_resid <- function(r, g, scope) {
  lt <- car::leveneTest(r, g, center = median)
  asm_rec("levene_brown_forsythe", scope, length(r), lt[["F value"]][1], c(lt[["Df"]][1], lt[["Df"]][2]),
          lt[["Pr(>F)"]][1])
}
shapiro_resid <- function(r, scope) {
  s <- stats::shapiro.test(r)
  asm_rec("shapiro_wilk", scope, length(r), s$statistic, numeric(0), s$p.value)
}
cc_data <- function(dataset, vars) {
  d <- load_dataset(dataset)
  keep <- stats::complete.cases(d[, vars, drop = FALSE])
  dd <- d[keep, , drop = FALSE]
  levels_ <- sort(unique(dd$group))
  dd$g <- factor(dd$group, levels = levels_)
  list(d = dd, levels = levels_, n_excluded = nrow(d) - nrow(dd))
}
desc_all <- function(dd, levels_, vars, ci) {
  out <- list()
  for (v in vars) for (lv in levels_) out[[length(out) + 1]] <- desc_rec(v, grp("group", lv), dd[[v]][dd$g == lv], ci)
  out
}
error_case <- function(case, analysis_id, dataset, request, expr) {
  msg <- tryCatch({ force(expr); NA_character_ }, error = function(e) conditionMessage(e))
  stopifnot(!is.na(msg))
  write_anc(case, list(analysis_id = analysis_id, case = case, dataset = dataset, request = request,
                       expected = NULL, error = msg))
}
# Adjusted means (emmeans at covariate means) as records.
adjusted_means <- function(fit, levels_, ci, outcome = NULL) {
  em <- summary(emmeans::emmeans(fit, "g"), level = ci)
  lapply(seq_along(levels_), function(i) {
    r <- list(group = levels_[i], emmean = num(em$emmean[i]), se = num(em$SE[i]), df = num(em$df[i]),
              lower = num(em$lower.CL[i]), upper = num(em$upper.CL[i]))
    if (!is.null(outcome)) r$outcome <- outcome
    r
  })
}

# =============================================================================
# ANCOVA
# =============================================================================
ancova_case <- function(case, dataset, covs, adjust = NULL, ci = 0.95, outcome = "post") {
  opts <- if (is.null(adjust)) empty_obj else list(adjust = adjust)
  request <- req(list(outcome = list(outcome), group = list("group"), covariates = as.list(covs)), opts,
                 "two_sided", ci)
  cd <- cc_data(dataset, c(outcome, "group", covs))
  dd <- cd$d; levels_ <- cd$levels; k <- length(levels_)
  if (k < 2) return(error_case(case, "ancova", dataset, request,
                               stats::lm(stats::as.formula(paste(outcome, "~", paste(covs, collapse = "+"), "+ g")), dd)))
  adj <- if (is.null(adjust)) "holm" else adjust
  form <- stats::as.formula(paste(outcome, "~", paste(covs, collapse = " + "), "+ g"))
  fit <- stats::lm(form, dd)
  a3 <- car::Anova(fit, type = 3)
  dfe <- a3["Residuals", "Df"]
  eta <- effectsize::eta_squared(a3, partial = TRUE, ci = ci, alternative = "two.sided", verbose = FALSE)
  om <- effectsize::omega_squared(a3, partial = TRUE, ci = ci, alternative = "two.sided", verbose = FALSE)
  cf <- effectsize::cohens_f(a3, partial = TRUE, ci = ci, alternative = "two.sided", verbose = FALSE)
  N <- nrow(dd); mse <- a3["Residuals", "Sum Sq"] / dfe
  stats_l <- list(); eff <- list()
  for (tm in c("g", covs)) {
    term <- if (tm == "g") "group" else tm
    df1 <- a3[tm, "Df"]; ss <- a3[tm, "Sum Sq"]
    stats_l[[length(stats_l) + 1]] <- stat_rec("F", a3[tm, "F value"], c(df1, dfe), a3[tm, "Pr(>F)"], term)
    pe <- eta[eta$Parameter == tm, ]; po <- om[om$Parameter == tm, ]
    stopifnot(abs(pe$Eta2_partial - ss / (ss + a3["Residuals", "Sum Sq"])) < 1e-12)
    stopifnot(abs(po$Omega2_partial - max(0, (ss - df1 * mse) / (ss + (N - df1) * mse))) < 1e-12)
    eff[[length(eff) + 1]] <- pve_rec("partial_eta_sq", pe$Eta2_partial, df1, dfe, ci, pe$CI_low, pe$CI_high, term = term)
    eff[[length(eff) + 1]] <- pve_rec("partial_omega_sq", po$Omega2_partial, df1, dfe, ci, po$CI_low, po$CI_high, term = term)
    if (tm == "g") {
      pc <- cf[cf$Parameter == tm, ]
      eff[[length(eff) + 1]] <- pve_rec("cohens_f", pe$Eta2_partial, df1, dfe, ci, pc$CI_low, pc$CI_high,
                                        cohens_f = TRUE, term = term)
    }
  }
  # Pairwise adjusted-mean comparisons (emmeans, first minus second).
  emm <- emmeans::emmeans(fit, "g")
  pr <- summary(pairs(emm, adjust = adj, reverse = FALSE), infer = c(TRUE, TRUE), level = ci)
  pairs_ <- utils::combn(k, 2, simplify = FALSE); m <- length(pairs_)
  for (r in seq_along(pairs_)) {
    i <- pairs_[[r]][1]; j <- pairs_[[r]][2]
    stopifnot(pr$contrast[r] == paste(levels_[i], "-", levels_[j]))
    est <- pr$estimate[r]; se <- pr$SE[r]
    half <- if (adj == "tukey") qtukey_exact(ci, k, dfe) / sqrt(2) * se else stats::qt(1 - (1 - ci) / (2 * m), dfe) * se
    if (k > 2 || adj != "tukey") stopifnot(abs(est - half - pr$lower.CL[r]) < 1e-3)
    p <- pr$p.value[r]
    if (adj == "tukey") stopifnot(abs(p - stats::ptukey(abs(pr$t.ratio[r]) * sqrt(2), k, dfe, lower.tail = FALSE)) < 1e-12)
    term <- term_of(levels_[i], levels_[j])
    stats_l[[length(stats_l) + 1]] <- stat_rec("t", pr$t.ratio[r], dfe, p, term)
    eff[[length(eff) + 1]] <- c(es_rec("mean_difference", est, est - half, est + half), term = term)
  }
  # Assumptions.
  int_form <- stats::as.formula(paste(outcome, "~", paste(covs, collapse = " + "), "+ g +",
                                      paste0("g:", covs, collapse = " + ")))
  sl <- stats::anova(fit, stats::lm(int_form, dd))
  checks <- list(asm_rec("slopes_interaction", "all groups", N, sl$F[2], c(sl$Df[2], sl$Res.Df[2]), sl$`Pr(>F)`[2]),
                 levene_resid(stats::residuals(fit), dd$g, "residuals by group"),
                 shapiro_resid(stats::residuals(fit), "residuals"))
  for (lv in levels_) for (cv in covs) {
    s <- dd[dd$g == lv, ]
    x <- s[[cv]]; y <- s[[outcome]]
    a <- stats::anova(stats::lm(y ~ x), stats::lm(y ~ x + I(x^2)))
    checks[[length(checks) + 1]] <- asm_rec("quadratic_term", paste0(lv, ": ", cv), nrow(s), a$F[2],
                                            c(a$Df[2], a$Res.Df[2]), a$`Pr(>F)`[2])
  }
  write_anc(case, list(
    analysis_id = "ancova", case = case, dataset = dataset, request = request,
    expected = list(n_used = N, n_excluded = cd$n_excluded, statistics = stats_l, effect_sizes = eff,
                    descriptives = desc_all(dd, levels_, c(outcome, covs), ci),
                    adjusted_means = adjusted_means(fit, levels_, ci), assumption_checks = checks),
    error = NULL))
}
ancova_case("ancova__two", "anc_two.csv", "pre")
ancova_case("ancova__three_unequal_tukey", "anc_three_unequal.csv", "pre", "tukey")
ancova_case("ancova__three_unequal_holm", "anc_three_unequal.csv", "pre", "holm")
ancova_case("ancova__two_covariates_bonferroni", "anc_two_cov.csv", c("pre", "gpa"), "bonferroni")
ancova_case("ancova__two_covariates_tukey_ci90", "anc_two_cov.csv", c("pre", "gpa"), "tukey", ci = 0.90)
ancova_case("ancova__slopes_differ", "anc_slopes.csv", "pre")
ancova_case("ancova__missing", "anc_missing.csv", "pre")
ancova_case("ancova__small_n", "anc_small.csv", "pre", "tukey")
ancova_case("ancova__single_group", "anc_single_group.csv", "pre")

# =============================================================================
# Quade's rank ANCOVA
# =============================================================================
quade_case <- function(case, dataset, covs, ci = 0.95, outcome = "post") {
  request <- req(list(outcome = list(outcome), group = list("group"), covariates = as.list(covs)), empty_obj,
                 "two_sided", ci)
  cd <- cc_data(dataset, c(outcome, "group", covs))
  dd <- cd$d; levels_ <- cd$levels
  ry <- rank(dd[[outcome]])
  rx <- sapply(covs, function(cv) rank(dd[[cv]]))
  res <- stats::residuals(stats::lm(ry ~ rx))
  fit <- stats::lm(res ~ g, data = data.frame(res = res, g = dd$g))
  a <- stats::anova(fit)
  a3 <- car::Anova(fit, type = 3)
  stopifnot(abs(a3["g", "F value"] - a["g", "F value"]) < 1e-9)
  df1 <- a["g", "Df"]; df2 <- a["Residuals", "Df"]
  av <- stats::aov(res ~ g, data = data.frame(res = res, g = dd$g))
  e <- effectsize::eta_squared(av, partial = FALSE, ci = ci, alternative = "two.sided", verbose = FALSE)
  o <- effectsize::omega_squared(av, partial = FALSE, ci = ci, alternative = "two.sided", verbose = FALSE)
  cf <- effectsize::cohens_f(av, partial = FALSE, ci = ci, alternative = "two.sided", verbose = FALSE)
  effects <- list(pve_rec("eta_sq", e$Eta2, df1, df2, ci, e$CI_low, e$CI_high),
                  pve_rec("omega_sq", o$Omega2, df1, df2, ci, o$CI_low, o$CI_high),
                  pve_rec("cohens_f", e$Eta2, df1, df2, ci, cf$CI_low, cf$CI_high, cohens_f = TRUE))
  rr <- lapply(levels_, function(lv) list(group = lv, n = sum(dd$g == lv), mean_residual = num(mean(res[dd$g == lv])),
                                          mean_rank = num(mean(ry[dd$g == lv]))))
  write_anc(case, list(
    analysis_id = "ancova.quade", case = case, dataset = dataset, request = request,
    expected = list(n_used = nrow(dd), n_excluded = cd$n_excluded,
                    statistics = list(stat_rec("F", a["g", "F value"], c(df1, df2), a["g", "Pr(>F)"])),
                    effect_sizes = effects, descriptives = desc_all(dd, levels_, c(outcome, covs), ci),
                    rank_residuals = rr),
    error = NULL))
}
quade_case("quade__likert", "anc_likert.csv", "pre")
quade_case("quade__likert_two_covariates", "anc_likert.csv", c("pre", "interest"))
quade_case("quade__three_unequal", "anc_three_unequal.csv", "pre")
quade_case("quade__missing", "anc_missing.csv", "pre")
quade_case("quade__small_n", "anc_small.csv", "pre")

# =============================================================================
# MANOVA / MANCOVA
# =============================================================================
mv_tests <- function(H, E, q, dfe) {
  eig <- Re(eigen(qr.coef(qr(E), H), symmetric = FALSE)$values)
  list(pillai = car:::Pillai(eig, q, dfe), wilks = car:::Wilks(eig, q, dfe),
       hotelling_lawley = car:::HL(eig, q, dfe), roy = car:::Roy(eig, q, dfe))
}
manova_case <- function(case, dataset, outcomes, covs = character(0), ci = 0.95) {
  aid <- if (length(covs)) "mancova" else "manova"
  vars <- list(outcomes = as.list(outcomes), group = list("group"))
  if (length(covs)) vars$covariates <- as.list(covs)
  request <- req(vars, empty_obj, "two_sided", ci)
  cd <- cc_data(dataset, c(outcomes, "group", covs))
  dd <- cd$d; levels_ <- cd$levels; k <- length(levels_); N <- nrow(dd); p <- length(outcomes)
  Y <- as.matrix(dd[, outcomes])
  rhs <- paste(c("g", covs), collapse = " + ")
  fit <- stats::lm(stats::as.formula(paste("Y ~", rhs)), dd)
  man <- car::Manova(fit, type = 3)
  E <- man$SSPE; dfe <- man$error.df
  stats_l <- list(); eff <- list()
  tg <- mv_tests(man$SSP[["g"]], E, man$df[["g"]], dfe)
  # cross-check Pillai against stats::anova.mlm on nested models (Type II = III without interactions)
  red <- if (length(covs)) stats::lm(stats::as.formula(paste("Y ~", paste(covs, collapse = " + "))), dd) else stats::lm(Y ~ 1, dd)
  am <- stats::anova(fit, red, test = "Pillai")
  stopifnot(abs(am$Pillai[2] - tg$pillai[1]) < 1e-9, abs(am$`approx F`[2] - tg$pillai[2]) < 1e-8)
  for (nm in c("pillai", "wilks", "hotelling_lawley", "roy")) {
    v <- tg[[nm]]
    pv <- stats::pf(v[2], v[3], v[4], lower.tail = FALSE)
    stats_l[[length(stats_l) + 1]] <- stat_rec(nm, v[1], v[3:4], pv, "group")
    stats_l[[length(stats_l) + 1]] <- stat_rec(paste0(nm, "_F"), v[2], v[3:4], pv, "group")
  }
  es <- effectsize::eta_squared(man, partial = TRUE, ci = ci, alternative = "two.sided", verbose = FALSE)
  s <- min(p, man$df[["g"]])
  eg <- es[es$Parameter == "g", ]
  stopifnot(abs(eg$Eta2_partial - tg$pillai[1] / s) < 1e-10)
  eff[[1]] <- pve_rec("partial_eta_sq", eg$Eta2_partial, tg$pillai[3], tg$pillai[4], ci, eg$CI_low, eg$CI_high,
                      term = "group")
  for (cv in covs) {
    tc <- mv_tests(man$SSP[[cv]], E, man$df[[cv]], dfe)$pillai
    pv <- stats::pf(tc[2], tc[3], tc[4], lower.tail = FALSE)
    stats_l[[length(stats_l) + 1]] <- stat_rec("pillai", tc[1], tc[3:4], pv, cv)
    stats_l[[length(stats_l) + 1]] <- stat_rec("pillai_F", tc[2], tc[3:4], pv, cv)
    ec <- es[es$Parameter == cv, ]
    eff[[length(eff) + 1]] <- pve_rec("partial_eta_sq", ec$Eta2_partial, tc[3], tc[4], ci, ec$CI_low, ec$CI_high,
                                      term = cv)
  }
  # Univariate follow-ups (Type III), Bonferroni across outcomes.
  uni <- list(); am_l <- list()
  for (j in seq_len(p)) {
    yj <- outcomes[j]
    fj <- stats::lm(stats::as.formula(paste(yj, "~", rhs)), dd)
    aj <- car::Anova(fj, type = 3)
    ej <- effectsize::eta_squared(aj, partial = TRUE, ci = ci, alternative = "two.sided", verbose = FALSE)
    ej <- ej[ej$Parameter == "g", ]
    ej$Eta2_partial <- ej[[grep("^Eta2", names(ej))[1]]]   # one-term model: effectsize names it Eta2
    padj <- min(1, p * aj["g", "Pr(>F)"])
    stats_l[[length(stats_l) + 1]] <- stat_rec("F_univariate", aj["g", "F value"], c(aj["g", "Df"], aj["Residuals", "Df"]),
                                               padj, yj)
    eff[[length(eff) + 1]] <- pve_rec("partial_eta_sq", ej$Eta2_partial, aj["g", "Df"], aj["Residuals", "Df"], ci,
                                      ej$CI_low, ej$CI_high, term = yj)
    uni[[j]] <- list(outcome = yj, F = num(aj["g", "F value"]), p = num(aj["g", "Pr(>F)"]), p_bonferroni = num(padj))
    if (length(covs)) am_l <- c(am_l, adjusted_means(fj, levels_, ci, yj))
  }
  # Assumptions.
  R <- stats::residuals(fit)
  bm <- heplots::boxM(Y, dd$g)
  S <- crossprod(R) / dfe
  D2 <- stats::mahalanobis(R, rep(0, p), S)
  rmat <- stats::cor(Y); mx <- max(abs(rmat[upper.tri(rmat)]))
  checks <- list(asm_rec("box_m", "all groups", N, bm$statistic, bm$parameter, bm$p.value),
                 asm_rec("mahalanobis", "residuals", N, max(D2), p, stats::pchisq(max(D2), p, lower.tail = FALSE)),
                 asm_rec("outcome_correlations", "outcomes", N, mx))
  for (j in seq_len(p)) {
    checks[[length(checks) + 1]] <- shapiro_resid(R[, j], paste0("residuals: ", outcomes[j]))
    checks[[length(checks) + 1]] <- levene_resid(R[, j], dd$g, outcomes[j])
  }
  if (length(covs)) {
    int_rhs <- paste(rhs, "+", paste0("g:", covs, collapse = " + "))
    fi <- stats::lm(stats::as.formula(paste("Y ~", int_rhs)), dd)
    ai <- stats::anova(fi, fit, test = "Pillai")
    checks[[length(checks) + 1]] <- asm_rec("slopes_interaction", "all groups", N, ai$`approx F`[2],
                                            c(ai$`num Df`[2], ai$`den Df`[2]), ai$`Pr(>F)`[2])
  }
  expected <- list(n_used = N, n_excluded = cd$n_excluded, statistics = stats_l, effect_sizes = eff,
                   descriptives = desc_all(dd, levels_, c(outcomes, covs), ci), univariate = uni,
                   assumption_checks = checks, mahalanobis_flagged = sum(D2 > stats::qchisq(0.999, p)))
  if (length(covs)) expected$adjusted_means <- am_l
  write_anc(case, list(analysis_id = aid, case = case, dataset = dataset, request = request, expected = expected,
                       error = NULL))
}
manova_case("manova__two_groups_two_outcomes", "anc_mv_two.csv", c("y1", "y2"))
manova_case("manova__two_groups_three_outcomes", "anc_mv_two.csv", c("y1", "y2", "y3"))
manova_case("manova__three_groups_two_outcomes", "anc_mv_three.csv", c("y1", "y2"))
manova_case("manova__three_groups_three_outcomes", "anc_mv_three.csv", c("y1", "y2", "y3"))
manova_case("manova__three_groups_ci90", "anc_mv_three.csv", c("y1", "y3"), ci = 0.90)
manova_case("mancova__three_groups_one_covariate", "anc_mv_three.csv", c("y1", "y2", "y3"), "pre")
manova_case("mancova__two_groups_one_covariate", "anc_mv_two.csv", c("y1", "y2"), "pre")

cat("ancova/manova fixtures written:", length(list.files(file.path(EXPECTED, DIR))), "\n")
