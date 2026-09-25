# Reference fixtures for the regression family (Phase 5): regression.linear, regression.hierarchical,
# regression.logistic, regression.ordinal. Self-contained: writes its seeded datasets
# (fixtures/expected/data/reg_*.csv) first, then fixtures/expected/regression/<case>.json.
# Conventions matched by engine/statly_engine/stats/regression.py, regression_logistic.py and
# assumptions_regression.py (see stats/README.md, "Regression"):
#   * Complete cases on every model variable. Categorical predictors: treatment (dummy) coding, reference
#     = first level (value-label order, else sorted), overridable with options.reference. Terms are named
#     "var" for numeric predictors and "var[level]" for dummies.
#   * linear = lm + summary; beta = effectsize::standardize_parameters(method = "basic") (SPSS "Beta":
#     b * SD(column) / SD(y), dummies included); R² CI = exact two-sided noncentral-F inversion of the model
#     F (effectsize::F_to_eta2(alternative = "two.sided") by uniroot); f² = R² / (1 - R²).
#   * hierarchical = nested lm per block on the same complete cases; ΔF, p = anova(m_prev, m_block)
#     (block 1 vs the intercept-only model).
#   * logistic = glm(binomial) (epsilon 1e-12); OR CIs = exact profile-likelihood inversion (uniroot on
#     the offset-refit deviance); MASS/stats confint()'s spline-interpolated bounds kept as confint_*.
#     Hosmer-Lemeshow = ResourceSelection::hoslem.test(g = 10); classification cut: p >= .5.
#   * ordinal = MASS::polr(Hess = TRUE) with optim reltol 1e-14; p from the normal approximation of
#     t = b / SE (as summary.polr's t value); OR CIs exact profile inversion; Brant = brant::brant.
#   * Assumptions: shapiro.test(residuals), lmtest::bptest (studentized), lmtest::resettest (fitted^2,^3),
#     car::vif (GVIF; statistic = max GVIF^(1/Df)), cooks.distance with cutoff 4/n.
if (!exists("R_DIR")) source(file.path(dirname(normalizePath(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))), "common.R"))
suppressPackageStartupMessages({
  library(car); library(effectsize); library(lmtest); library(MASS); library(brant); library(ResourceSelection)
})
.old_contrasts <- options(contrasts = c("contr.treatment", "contr.poly"))

DIR <- "regression"
REG_PACKAGES <- c("car", "effectsize", "lmtest", "MASS", "brant", "ResourceSelection")
write_reg <- function(case, fx) {
  fx$r_regression_packages <- lapply(setNames(REG_PACKAGES, REG_PACKAGES),
                                     function(p) as.character(utils::packageVersion(p)))
  write_fixture(DIR, case, fx)
}
unlink(file.path(EXPECTED, DIR, "*.json"))

# =============================================================================
# Datasets (seeded, rounded, blank = missing)
# =============================================================================
set.seed(5101)
n <- 40
hours <- round(stats::runif(n, 0, 10), 1)
write_dataset(data.frame(hours = hours, score = round(55 + 2.5 * hours + stats::rnorm(n, 0, 6), 1)),
              "reg_simple.csv")

set.seed(5102)
n <- 90
region <- sample(c("Rural", "Suburban", "Urban"), n, TRUE)
female <- stats::rbinom(n, 1, 0.5)
hours <- round(stats::runif(n, 0, 10), 1)
motivation <- round(stats::rnorm(n, 3.5, 0.8), 2)
score <- round(50 + 2 * hours + 3 * motivation + 2.5 * female + c(Rural = 0, Suburban = 3, Urban = 5)[region] +
                 stats::rnorm(n, 0, 6), 1)
mult <- data.frame(id = seq_len(n), score = score, hours = hours, motivation = motivation, female = female,
                   region = region, stringsAsFactors = FALSE)
write_dataset(mult, "reg_multiple.csv")
mis <- mult
mis$score[c(5, 17, 33)] <- NA
mis$hours[c(8, 40)] <- NA
mis$region[c(12, 60)] <- NA
write_dataset(mis, "reg_missing.csv")

set.seed(5103)
n <- 60
x1 <- round(stats::rnorm(n, 50, 10), 2)
x2 <- round(x1 + stats::rnorm(n, 0, 3), 2)
x3 <- round(stats::rnorm(n, 20, 5), 2)
write_dataset(data.frame(x1 = x1, x2 = x2, x3 = x3, x4 = 2 * x1 + 1,
                         y = round(10 + 0.4 * x1 + 0.3 * x2 + 0.5 * x3 + stats::rnorm(n, 0, 5), 2)),
              "reg_collinear.csv")

set.seed(5104)
n <- 10
x1 <- round(stats::rnorm(n, 5, 2), 1)
x2 <- round(stats::rnorm(n, 10, 3), 1)
write_dataset(data.frame(x1 = x1, x2 = x2, y = round(3 + 1.2 * x1 + 0.5 * x2 + stats::rnorm(n, 0, 2), 1)),
              "reg_small.csv")

set.seed(5105)
n <- 150
region <- sample(c("Rural", "Suburban", "Urban"), n, TRUE)
hours <- round(stats::runif(n, 0, 10), 1)
motivation <- round(stats::rnorm(n, 3.5, 0.8), 2)
lp <- -5 + 0.5 * hours + 0.6 * motivation + c(Rural = 0, Suburban = 0.4, Urban = 0.8)[region]
lp_rare <- -6.3 + 0.35 * hours + 0.7 * motivation
pass <- stats::rbinom(n, 1, stats::plogis(lp))
rare <- stats::rbinom(n, 1, stats::plogis(lp_rare))
lg <- data.frame(pass = pass, rare = rare, result = ifelse(pass == 1, "Pass", "Fail"), hours = hours,
                 motivation = motivation, region = region, stringsAsFactors = FALSE)
lg$hours[c(3, 50)] <- NA
write_dataset(lg, "reg_logistic.csv")

set.seed(5106)
n <- 30
# quasi-complete separation: y = 0 below x = 5, y = 1 above, both outcomes at x = 5 exactly
x <- round(c(seq(1, 4.8, length.out = 13), rep(5, 4), seq(5.2, 9, length.out = 13)), 1)
z <- round(stats::rnorm(n, 0, 1), 2)
y <- c(rep(0, 13), 0, 1, 0, 1, rep(1, 13))
write_dataset(data.frame(x = x, z = z, y = y), "reg_separation.csv")

set.seed(5107)
n <- 160
region <- sample(c("Rural", "Suburban", "Urban"), n, TRUE)
female <- stats::rbinom(n, 1, 0.5)
hours <- round(stats::runif(n, 0, 10), 1)
latent <- 0.35 * hours + 0.5 * female + c(Rural = 0, Suburban = 0.3, Urban = 0.7)[region] + stats::rlogis(n)
sat <- as.integer(cut(latent, c(-Inf, 0.8, 2.2, 3.6, Inf)))
od <- data.frame(satisfaction = sat, hours = hours, female = female, region = region, stringsAsFactors = FALSE)
od$satisfaction[c(9, 77)] <- NA
write_dataset(od, "reg_ordinal.csv")

# =============================================================================
# Helpers
# =============================================================================
TOL_OPT <- 1e-12

prepare <- function(d, outcome, preds, factors, reference) {
  d <- d[stats::complete.cases(d[, c(outcome, preds), drop = FALSE]), , drop = FALSE]
  for (f in factors) {
    lv <- sort(unique(d[[f]]))
    ref <- if (!is.null(reference[[f]])) reference[[f]] else lv[1]
    d[[f]] <- factor(d[[f]], levels = c(ref, setdiff(lv, ref)))
  }
  d
}

# R coefficient names -> Statly term keys ("var", "var[level]", "(Intercept)").
term_names <- function(mm, d, preds, factors) {
  cn <- colnames(mm)
  out <- cn
  for (f in factors) for (lv in levels(d[[f]])) out[cn == paste0(f, lv)] <- paste0(f, "[", lv, "]")
  out
}

ncp_f_exact <- function(f, df1, df2, level) {
  a <- 1 - level
  g <- function(lam, p) stats::pf(f, df1, df2, ncp = lam) - p
  lo <- if (stats::pf(f, df1, df2) <= 1 - a / 2) 0 else
    stats::uniroot(g, c(0, f * df1 + 10), p = 1 - a / 2, extendInt = "downX", tol = 1e-13)$root
  hi <- if (stats::pf(f, df1, df2) <= a / 2) 0 else
    stats::uniroot(g, c(0, f * df1 + 10), p = a / 2, extendInt = "downX", tol = 1e-13)$root
  c(lo, hi)
}

r2_ci <- function(f, df1, df2, level) {
  lam <- ncp_f_exact(f, df1, df2, level)
  b <- lam / (lam + df2)
  e <- effectsize::F_to_eta2(f, df1, df2, ci = level, alternative = "two.sided")
  stopifnot(abs(e$CI_low - b[1]) < 1e-3, abs(e$CI_high - b[2]) < 1e-3)
  b
}

vif_recs <- function(m) {
  v <- tryCatch(car::vif(m), error = function(e) NULL)
  if (is.null(v)) return(list())
  if (is.null(dim(v))) v <- cbind(GVIF = v, Df = 1, `GVIF^(1/(2*Df))` = sqrt(v))
  lapply(seq_len(nrow(v)), function(i) list(term = rownames(v)[i], gvif = num(v[i, 1]), df = num(v[i, 2]),
                                            gvif_adj = num(v[i, 3])))
}

vif_assumption <- function(vr, n) {
  if (!length(vr)) return(NULL)
  s <- max(sapply(vr, function(r) r$gvif_adj^2))
  list(test = "vif", n = n, statistic = s, p = NULL, df = list())
}

cooks_rec <- function(m) {
  d <- stats::cooks.distance(m)
  n <- length(d)
  list(test = "cooks_distance", n = n, statistic = num(max(d)), p = NULL, df = list(),
       n_over = sum(d > 4 / n), cutoff = 4 / n)
}

lm_block <- function(m, d, outcome, preds, factors, level) {
  s <- summary(m)
  mm <- stats::model.matrix(m)
  tn <- term_names(mm, d, preds, factors)
  ct <- s$coefficients
  ci <- stats::confint(m, level = level)
  sp <- effectsize::standardize_parameters(m, method = "basic", ci = level)
  # basic beta = b * SD(column) / SD(y) (checked by hand)
  sdy <- stats::sd(d[[outcome]])
  for (j in 2:ncol(mm)) stopifnot(abs(sp$Std_Coefficient[j] - ct[j, 1] * stats::sd(mm[, j]) / sdy) < 1e-10)
  coefs <- lapply(seq_len(nrow(ct)), function(j) list(
    term = tn[j], estimate = num(ct[j, 1]), se = num(ct[j, 2]), statistic = num(ct[j, 3]), p = num(ct[j, 4]),
    ci_lower = num(ci[j, 1]), ci_upper = num(ci[j, 2]),
    beta = if (j == 1) NULL else num(sp$Std_Coefficient[j]),
    beta_ci_lower = if (j == 1) NULL else num(sp$CI_low[j]),
    beta_ci_upper = if (j == 1) NULL else num(sp$CI_high[j])))
  fs <- s$fstatistic
  p <- stats::pf(fs[1], fs[2], fs[3], lower.tail = FALSE)
  r2 <- s$r.squared
  b <- r2_ci(fs[1], fs[2], fs[3], level)
  list(m = m, tn = tn, coefs = coefs,
       model = list(r_squared = num(r2), adj_r_squared = num(s$adj.r.squared), sigma = num(s$sigma),
                    f = num(fs[1]), df1 = num(fs[2]), df2 = num(fs[3]), p = num(p),
                    f_sq = num(r2 / (1 - r2)), r_squared_ci_lower = num(b[1]), r_squared_ci_upper = num(b[2]),
                    f_sq_ci_lower = num(b[1] / (1 - b[1])), f_sq_ci_upper = num(b[2] / (1 - b[2]))))
}

lm_assumptions <- function(m, vr) {
  n <- stats::nobs(m)
  r <- stats::residuals(m)
  sw <- stats::shapiro.test(r)
  bp <- lmtest::bptest(m)
  rs <- lmtest::resettest(m, power = 2:3, type = "fitted")
  out <- list(
    list(test = "shapiro_wilk", n = n, statistic = num(sw$statistic), p = num(sw$p.value), df = list()),
    list(test = "breusch_pagan", n = n, statistic = num(bp$statistic), p = num(bp$p.value),
         df = list(num(bp$parameter))),
    list(test = "reset", n = n, statistic = num(rs$statistic), p = num(rs$p.value),
         df = lapply(unname(rs$parameter), num)),
    cooks_rec(m))
  va <- vif_assumption(vr, n)
  if (!is.null(va)) out <- c(out, list(va))
  out
}

linear_case <- function(case, dataset, outcome, preds, factors = character(0), reference = list(),
                        level = 0.95) {
  raw <- load_dataset(dataset)
  d <- prepare(raw, outcome, preds, factors, reference)
  m <- stats::lm(stats::reformulate(preds, outcome), data = d)
  blk <- lm_block(m, d, outcome, preds, factors, level)
  vr <- vif_recs(m)
  mod <- blk$model
  opts <- if (length(reference)) list(reference = reference) else setNames(list(), character(0))
  stats_ <- c(list(stat_rec("F", mod$f, c(mod$df1, mod$df2), mod$p)),
              lapply(blk$coefs, function(c) stat_rec("t", c$statistic, mod$df2, c$p, c$term)))
  effects <- c(list(es_rec("r_squared", mod$r_squared, mod$r_squared_ci_lower, mod$r_squared_ci_upper),
                    es_rec("adj_r_squared", mod$adj_r_squared),
                    es_rec("f_sq", mod$f_sq, mod$f_sq_ci_lower, mod$f_sq_ci_upper)),
               lapply(blk$coefs[-1], function(c) c(es_rec("beta", c$beta, c$beta_ci_lower, c$beta_ci_upper),
                                                   list(term = c$term))))
  dummy <- lapply(factors, function(f) list(variable = f, reference = levels(d[[f]])[1], levels = levels(d[[f]])))
  write_reg(case, list(
    analysis_id = "regression.linear", case = case, dataset = dataset,
    request = req(list(outcome = list(outcome), predictors = as.list(preds)), opts, ci_level = level),
    expected = list(n_used = nrow(d), n_excluded = nrow(raw) - nrow(d), statistics = stats_,
                    effect_sizes = effects, coefficients = blk$coefs, model = mod, vif = vr,
                    dummy_coding = dummy, assumptions = lm_assumptions(m, vr)),
    error = NULL))
}

hier_case <- function(case, dataset, outcome, blocks, factors = character(0), level = 0.95) {
  raw <- load_dataset(dataset)
  allp <- unlist(blocks)
  d <- prepare(raw, outcome, allp, factors, list())
  ms <- list(); recs <- list(); prev <- stats::lm(stats::reformulate("1", outcome), data = d)
  blks <- list()
  for (i in seq_along(blocks)) {
    preds <- unlist(blocks[seq_len(i)])
    m <- stats::lm(stats::reformulate(preds, outcome), data = d)
    a <- stats::anova(prev, m)
    blk <- lm_block(m, d, outcome, preds, factors, level)
    r2_prev <- if (i == 1) 0 else summary(prev)$r.squared
    dr2 <- blk$model$r_squared - r2_prev
    recs[[i]] <- list(block = i, r_squared = blk$model$r_squared, adj_r_squared = blk$model$adj_r_squared,
                      delta_r_squared = num(dr2), f_change = num(a$F[2]), df1 = num(a$Df[2]),
                      df2 = num(a$Res.Df[2]), p_change = num(a$`Pr(>F)`[2]),
                      f_sq_change = num(dr2 / (1 - blk$model$r_squared)))
    blks[[i]] <- blk
    prev <- m
  }
  k <- length(blocks)
  fin <- blks[[k]]
  mod <- fin$model
  vr <- vif_recs(fin$m)
  chg <- function(i) stat_rec("F_change", recs[[i]]$f_change, c(recs[[i]]$df1, recs[[i]]$df2),
                              recs[[i]]$p_change, paste("Block", i))
  stats_ <- c(list(chg(k)), lapply(seq_len(k - 1), chg),
              list(stat_rec("F", mod$f, c(mod$df1, mod$df2), mod$p)),
              lapply(fin$coefs, function(c) stat_rec("t", c$statistic, mod$df2, c$p, c$term)))
  effects <- c(list(es_rec("r_squared", mod$r_squared, mod$r_squared_ci_lower, mod$r_squared_ci_upper),
                    es_rec("adj_r_squared", mod$adj_r_squared),
                    es_rec("f_sq", mod$f_sq, mod$f_sq_ci_lower, mod$f_sq_ci_upper)),
               lapply(seq_len(k), function(i) c(es_rec("delta_r_squared", recs[[i]]$delta_r_squared),
                                                list(term = paste("Block", i)))),
               lapply(seq_len(k), function(i) c(es_rec("f_sq_change", recs[[i]]$f_sq_change),
                                                list(term = paste("Block", i)))),
               lapply(fin$coefs[-1], function(c) c(es_rec("beta", c$beta, c$beta_ci_lower, c$beta_ci_upper),
                                                   list(term = c$term))))
  vars <- setNames(lapply(blocks, as.list), paste0("block_", seq_len(k)))
  write_reg(case, list(
    analysis_id = "regression.hierarchical", case = case, dataset = dataset,
    request = req(c(list(outcome = list(outcome)), vars), ci_level = level),
    expected = list(n_used = nrow(d), n_excluded = nrow(raw) - nrow(d), statistics = stats_,
                    effect_sizes = effects, coefficients = fin$coefs, model = mod, blocks = recs, vif = vr,
                    block_coefficients = lapply(blks, function(b) b$coefs),
                    assumptions = lm_assumptions(fin$m, vr)),
    error = NULL))
}

error_case <- function(case, analysis_id, dataset, variables, options, expr) {
  msg <- tryCatch({ v <- force(expr); if (is.character(v)) v else NA_character_ },
                  error = function(e) conditionMessage(e))
  stopifnot(!is.na(msg))
  write_reg(case, list(analysis_id = analysis_id, case = case, dataset = dataset,
                       request = req(variables, options), expected = NULL, error = msg))
}

# Exact profile-likelihood CI: refit with coefficient j fixed (as an offset), solve dev(b) - dev_min = qchisq.
profile_ci <- function(dev_at, b, se, dev0, level) {
  crit <- stats::qchisq(level, 1)
  f <- function(v) dev_at(v) - dev0 - crit
  lo <- tryCatch(stats::uniroot(f, c(b - 2 * se, b), extendInt = "downX", tol = 1e-12, maxiter = 2000)$root,
                 error = function(e) NA)
  hi <- tryCatch(stats::uniroot(f, c(b, b + 2 * se), extendInt = "upX", tol = 1e-12, maxiter = 2000)$root,
                 error = function(e) NA)
  c(lo, hi)
}

GLM_CTRL <- stats::glm.control(epsilon = TOL_OPT, maxit = 100)

logistic_case <- function(case, dataset, outcome, preds, factors = character(0), event = NULL, level = 0.95,
                          separation = FALSE) {
  raw <- load_dataset(dataset)
  d <- prepare(raw, outcome, preds, factors, list())
  lv <- sort(unique(d[[outcome]]))
  ev <- if (is.null(event)) lv[2] else event
  d$.y <- as.numeric(d[[outcome]] == ev)
  opts <- if (is.null(event)) setNames(list(), character(0)) else list(event = event)
  request <- req(list(outcome = list(outcome), predictors = as.list(preds)), opts, ci_level = level)
  m <- suppressWarnings(stats::glm(stats::reformulate(preds, ".y"), data = d, family = stats::binomial(),
                                   control = GLM_CTRL))
  n <- nrow(d)
  if (separation) {
    write_reg(case, list(analysis_id = "regression.logistic", case = case, dataset = dataset, request = request,
                         expected = list(n_used = n, n_excluded = nrow(raw) - n, warning = "perfect_separation",
                                         glm_converged = m$converged,
                                         max_fitted_extreme = min(min(m$fitted.values), 1 - max(m$fitted.values))),
                         error = NULL))
    return(invisible())
  }
  stopifnot(m$converged)
  mm <- stats::model.matrix(m)
  tn <- term_names(mm, d, preds, factors)
  ct <- summary(m)$coefficients
  X <- mm; y <- d$.y; dev0 <- stats::deviance(m)
  dev_at <- function(j) function(v) stats::glm.fit(X[, -j, drop = FALSE], y, offset = v * X[, j],
                                                   family = stats::binomial(), control = GLM_CTRL)$deviance
  rci <- suppressMessages(stats::confint(m, level = level))
  coefs <- lapply(seq_len(nrow(ct)), function(j) {
    ci <- profile_ci(dev_at(j), ct[j, 1], ct[j, 2], dev0, level)
    stopifnot(all(abs(ci - rci[j, ]) < 5e-3))
    list(term = tn[j], estimate = num(ct[j, 1]), se = num(ct[j, 2]), statistic = num(ct[j, 3]),
         p = num(ct[j, 4]), ci_lower = num(ci[1]), ci_upper = num(ci[2]), or = num(exp(ct[j, 1])),
         or_ci_lower = num(exp(ci[1])), or_ci_upper = num(exp(ci[2])),
         confint_ci_lower = num(rci[j, 1]), confint_ci_upper = num(rci[j, 2]))
  })
  chi2 <- m$null.deviance - m$deviance
  dfm <- m$df.null - m$df.residual
  pm <- stats::pchisq(chi2, dfm, lower.tail = FALSE)
  cs <- 1 - exp(-chi2 / n)
  nk <- cs / (1 - exp(-m$null.deviance / n))
  hl <- suppressWarnings(ResourceSelection::hoslem.test(y, stats::fitted(m), g = 10))
  pred <- as.numeric(stats::fitted(m) >= 0.5)
  cls <- list(tn = sum(pred == 0 & y == 0), fp = sum(pred == 1 & y == 0), fn = sum(pred == 0 & y == 1),
              tp = sum(pred == 1 & y == 1))
  cls$percent_correct <- 100 * (cls$tn + cls$tp) / n
  vr <- vif_recs(m)
  asm <- list(list(test = "hosmer_lemeshow", n = n, statistic = num(hl$statistic), p = num(hl$p.value),
                   df = list(num(hl$parameter))), cooks_rec(m))
  va <- vif_assumption(vr, n)
  if (!is.null(va)) asm <- c(asm, list(va))
  stats_ <- c(list(stat_rec("chi2", chi2, dfm, pm)),
              lapply(coefs, function(c) stat_rec("z", c$statistic, numeric(0), c$p, c$term)))
  effects <- c(list(es_rec("nagelkerke_r2", nk), es_rec("cox_snell_r2", cs)),
               lapply(coefs[-1], function(c) c(es_rec("odds_ratio", c$or, c$or_ci_lower, c$or_ci_upper),
                                               list(term = c$term))))
  write_reg(case, list(
    analysis_id = "regression.logistic", case = case, dataset = dataset, request = request,
    expected = list(n_used = n, n_excluded = nrow(raw) - n, event = ev, statistics = stats_, effect_sizes = effects,
                    coefficients = coefs,
                    model = list(chi2 = num(chi2), df = num(dfm), p = num(pm), deviance = num(m$deviance),
                                 null_deviance = num(m$null.deviance), cox_snell_r2 = num(cs),
                                 nagelkerke_r2 = num(nk), n_events = sum(y)),
                    classification = cls, vif = vr, assumptions = asm),
    error = NULL))
}

POLR_CTRL <- list(reltol = 1e-14, maxit = 5000)

ordinal_case <- function(case, dataset, outcome, preds, factors = character(0), level = 0.95) {
  raw <- load_dataset(dataset)
  d <- prepare(raw, outcome, preds, factors, list())
  d$.y <- factor(d[[outcome]], levels = sort(unique(d[[outcome]])), ordered = TRUE)
  f <- stats::reformulate(preds, ".y")
  m <- MASS::polr(f, data = d, Hess = TRUE, control = POLR_CTRL)
  m_default <- MASS::polr(f, data = d, Hess = TRUE)
  stopifnot(max(abs(coef(m) - coef(m_default))) < 1e-3)
  n <- nrow(d)
  mm <- stats::model.matrix(m)[, -1, drop = FALSE]
  tn <- term_names(mm, d, preds, factors)
  V <- stats::vcov(m)
  b <- coef(m); se <- sqrt(diag(V))[names(b)]
  dev0 <- stats::deviance(m)
  y <- d$.y
  dev_at <- function(j) function(v) {
    off <- v * mm[, j]
    dd <- as.data.frame(mm[, -j, drop = FALSE]); names(dd) <- make.names(names(dd))
    dd$.y <- y
    ff <- if (ncol(dd) > 1) stats::as.formula(".y ~ . + offset(off)") else stats::as.formula(".y ~ offset(off)")
    environment(ff) <- environment()
    stats::deviance(MASS::polr(ff, data = dd, control = POLR_CTRL,
                               start = c(b[-j], m$zeta)))
  }
  rci <- suppressMessages(stats::confint(m, level = level))
  if (is.null(dim(rci))) rci <- matrix(rci, nrow = 1)
  coefs <- lapply(seq_along(b), function(j) {
    z <- b[j] / se[j]
    ci <- profile_ci(dev_at(j), b[j], se[j], dev0, level)
    stopifnot(all(abs(ci - rci[j, ]) < 5e-3))
    list(term = tn[j], estimate = num(b[j]), se = num(se[j]), statistic = num(z), p = num(2 * stats::pnorm(-abs(z))),
         ci_lower = num(ci[1]), ci_upper = num(ci[2]), or = num(exp(b[j])), or_ci_lower = num(exp(ci[1])),
         or_ci_upper = num(exp(ci[2])), confint_ci_lower = num(rci[j, 1]), confint_ci_upper = num(rci[j, 2]))
  })
  zs <- m$zeta; zse <- sqrt(diag(V))[names(zs)]
  thr <- lapply(seq_along(zs), function(k) list(threshold = names(zs)[k], estimate = num(zs[k]), se = num(zse[k]),
                                                statistic = num(zs[k] / zse[k])))
  m0 <- MASS::polr(.y ~ 1, data = d, control = POLR_CTRL)
  chi2 <- stats::deviance(m0) - dev0
  dfm <- length(b)
  pm <- stats::pchisq(chi2, dfm, lower.tail = FALSE)
  cs <- 1 - exp(-chi2 / n)
  nk <- cs / (1 - exp(-stats::deviance(m0) / n))
  br <- suppressWarnings({ utils::capture.output(res <- brant::brant(m)); res })
  brec <- lapply(seq_len(nrow(br)), function(i) list(term = if (i == 1) "Omnibus" else tn[i - 1],
                                                    statistic = num(br[i, 1]), df = num(br[i, 2]),
                                                    p = num(br[i, 3])))
  vr <- vif_recs(m)
  asm <- list(list(test = "brant", n = n, statistic = num(br[1, 1]), p = num(br[1, 3]), df = list(num(br[1, 2]))))
  va <- vif_assumption(vr, n)
  if (!is.null(va)) asm <- c(asm, list(va))
  stats_ <- c(list(stat_rec("chi2", chi2, dfm, pm)),
              lapply(coefs, function(c) stat_rec("z", c$statistic, numeric(0), c$p, c$term)))
  effects <- c(list(es_rec("nagelkerke_r2", nk), es_rec("cox_snell_r2", cs)),
               lapply(coefs, function(c) c(es_rec("odds_ratio", c$or, c$or_ci_lower, c$or_ci_upper),
                                           list(term = c$term))))
  write_reg(case, list(
    analysis_id = "regression.ordinal", case = case, dataset = dataset,
    request = req(list(outcome = list(outcome), predictors = as.list(preds)), ci_level = level),
    expected = list(n_used = n, n_excluded = nrow(raw) - n, statistics = stats_, effect_sizes = effects,
                    coefficients = coefs, thresholds = thr,
                    model = list(chi2 = num(chi2), df = num(dfm), p = num(pm), deviance = num(dev0),
                                 null_deviance = num(stats::deviance(m0)), cox_snell_r2 = num(cs),
                                 nagelkerke_r2 = num(nk)),
                    brant = brec, vif = vr, assumptions = asm,
                    polr_default = list(coefficients = num(coef(m_default)), zeta = num(m_default$zeta))),
    error = NULL))
}

# =============================================================================
# Cases
# =============================================================================
linear_case("simple", "reg_simple.csv", "score", "hours")
linear_case("multiple", "reg_multiple.csv", "score", c("hours", "motivation", "female", "region"), "region")
linear_case("multiple_ref_urban", "reg_multiple.csv", "score", c("hours", "motivation", "female", "region"),
            "region", list(region = "Urban"))
linear_case("multiple_ci90", "reg_multiple.csv", "score", c("hours", "motivation"), level = 0.90)
linear_case("collinear", "reg_collinear.csv", "y", c("x1", "x2", "x3"))
linear_case("small_n10", "reg_small.csv", "y", c("x1", "x2"))
linear_case("missing", "reg_missing.csv", "score", c("hours", "motivation", "female", "region"), "region")
error_case("aliased", "regression.linear", "reg_collinear.csv",
           list(outcome = list("y"), predictors = list("x1", "x4")), setNames(list(), character(0)), {
             m <- stats::lm(y ~ x1 + x4, data = load_dataset("reg_collinear.csv"))
             stopifnot(any(is.na(coef(m))))
             car::vif(stats::lm(y ~ x1 + x4 + x3, data = load_dataset("reg_collinear.csv")))
           })

hier_case("two_blocks", "reg_multiple.csv", "score", list(c("female"), c("hours", "motivation")))
hier_case("three_blocks", "reg_multiple.csv", "score", list(c("female"), c("hours", "motivation"), c("region")),
          "region")
hier_case("three_blocks_missing", "reg_missing.csv", "score",
          list(c("female", "region"), c("hours"), c("motivation")), "region")

logistic_case("balanced", "reg_logistic.csv", "pass", c("hours", "motivation", "region"), "region")
logistic_case("text_outcome", "reg_logistic.csv", "result", c("hours", "motivation"))
logistic_case("event_fail", "reg_logistic.csv", "result", c("hours"), event = "Fail")
logistic_case("imbalanced", "reg_logistic.csv", "rare", c("hours", "motivation"))
logistic_case("quasi_separation", "reg_separation.csv", "y", c("x", "z"), separation = TRUE)

ordinal_case("four_levels", "reg_ordinal.csv", "satisfaction", c("hours", "female", "region"), "region")
ordinal_case("single_predictor", "reg_ordinal.csv", "satisfaction", c("hours"))

options(.old_contrasts)
cat("regression fixtures:", length(list.files(file.path(EXPECTED, DIR), pattern = "\\.json$")), "\n")
