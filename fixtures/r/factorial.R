# Reference fixtures for the factorial family (Phase 5): anova.factorial, anova.mixed, anova.art,
# posthoc.simple_effects. Self-contained: generates its own seeded datasets
# (fixtures/expected/data/fact_*.csv) first, then writes fixtures/expected/factorial/<case>.json.
# Conventions matched by engine/statly_engine/stats/anova_factorial.py, anova_mixed.py, art.py,
# posthoc_simple.py (see stats/README.md, "Factorial, mixed, ART, simple effects"):
#   * Factorial: car::Anova(lm(y ~ A * B), type = 3) with contr.sum (asserted equal to
#     afex::aov_car); partial eta2 / partial omega2 / Cohen's f from effectsize on that table,
#     two-sided CIs recorded as the exact noncentral-F inversion (effectsize's optim bounds kept).
#     Levene (median) across the A x B cells; Shapiro-Wilk on the model residuals; emmeans
#     cell and marginal means (unweighted, pooled MSE).
#   * Mixed: afex::aov_ez(between, within, type = 3) (car's multivariate-approach univariate tests).
#     Mauchly / GG / HF (car's Huynh-Feldt-Lecoutre, N - g + 1) per within term; HF capped at 1 as
#     afex. Box's M = heplots::boxM (checked against a hand computation). Levene and residual
#     Shapiro-Wilk per time point. effectsize partial eta2 / generalized eta2 (afex ges) / partial
#     omega2 (strata formula) / Cohen's f.
#   * ART: ARTool::art + anova(): Type III lm for between designs; Error(id) designs are aov
#     strata, i.e. Type I (identical to Type III when the groups are the same size).
#   * Simple effects: emmeans::joint_tests(by =) + pairs(emmeans(~ A | B), adjust = "holm"),
#     Bonferroni-adjusted CIs within each by level (emmeans). Mixed designs use afex's default
#     emmeans_model = "multivariate" (asserted), i.e. the wide mlm with df = N - g.
if (!exists("R_DIR")) source(file.path(dirname(normalizePath(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))), "common.R"))
suppressPackageStartupMessages({
  library(afex); library(emmeans); library(effectsize); library(car); library(psych); library(ARTool)
})
HAVE_HEPLOTS <- requireNamespace("heplots", quietly = TRUE)
options(contrasts = c("contr.sum", "contr.poly"))
stopifnot(afex::afex_options("emmeans_model") == "multivariate")

DIR <- "factorial"
FACT_PACKAGES <- c("afex", "emmeans", "effectsize", "car", "psych", "ARTool", "heplots")
write_fact <- function(case, fx) {
  fx$r_factorial_packages <- lapply(setNames(FACT_PACKAGES, FACT_PACKAGES), function(p)
    tryCatch(as.character(utils::packageVersion(p)), error = function(e) NA_character_))
  write_fixture(DIR, case, fx)
}
error_fact <- function(case, analysis_id, dataset, request, expr) {
  msg <- tryCatch({ force(expr); NA_character_ }, error = function(e) conditionMessage(e))
  stopifnot(!is.na(msg))
  write_fact(case, list(analysis_id = analysis_id, case = case, dataset = dataset, request = request,
                        expected = NULL, error = msg))
}
unlink(file.path(EXPECTED, DIR, "*.json"))
X <- "×"
empty_obj <- setNames(list(), character(0))

# =============================================================================
# Datasets (seeded, rounded to 2 dp, blank = missing)
# =============================================================================
cells_df <- function(yv, av, bv, alev, blev, ns, means, sd, digits = 2) {
  rows <- list()
  for (i in seq_along(alev)) for (j in seq_along(blev)) {
    n <- ns[i, j]
    if (n == 0) next
    rows[[length(rows) + 1]] <- data.frame(a = alev[i], b = blev[j],
                                           y = round(stats::rnorm(n, means[i, j], sd), digits),
                                           stringsAsFactors = FALSE)
  }
  d <- do.call(rbind, rows)
  d <- d[sample(nrow(d)), ]
  out <- data.frame(d$y, d$a, d$b, stringsAsFactors = FALSE)
  names(out) <- c(yv, av, bv)
  rownames(out) <- NULL
  out
}
set.seed(5101)
# 2 x 2 balanced (n = 10 per cell), an interaction.
write_dataset(cells_df("score", "method", "gender", c("Active", "Lecture"), c("Female", "Male"),
                       matrix(10, 2, 2), matrix(c(78, 70, 74, 71), 2, 2), 7), "fact_2x2.csv")
# 2 x 3 unbalanced with missing scores and factors.
d23 <- cells_df("score", "method", "grade", c("Active", "Lecture"), c("G6", "G7", "G8"),
                matrix(c(9, 14, 12, 8, 15, 10), 2, 3), matrix(c(60, 58, 66, 59, 71, 61), 2, 3), 6)
d23$score[c(3, 17, 40)] <- NA
d23$method[c(8, 25)] <- NA
d23$grade[c(33)] <- NA
write_dataset(d23, "fact_2x3.csv")
# 3 x 3 balanced, n = 5 per cell.
write_dataset(cells_df("score", "method", "school", c("A", "B", "C"), c("North", "South", "West"),
                       matrix(5, 3, 3), matrix(c(10, 12, 15, 11, 12, 13, 12, 16, 14), 3, 3), 2.5),
              "fact_3x3.csv")
# 2 x 3 with an empty cell (Lecture x G8).
write_dataset(cells_df("score", "method", "grade", c("Active", "Lecture"), c("G6", "G7", "G8"),
                       matrix(c(6, 6, 6, 6, 6, 0), 2, 3), matrix(60, 2, 3), 5), "fact_empty_cell.csv")
# Likert (1-5) outcome, 2 x 3, unbalanced, heavy ties, one missing rating.
lik <- do.call(rbind, lapply(list(list("Active", "G6", 8, c(.05, .15, .30, .35, .15)),
                                  list("Active", "G7", 9, c(.05, .10, .25, .35, .25)),
                                  list("Active", "G8", 7, c(.10, .20, .30, .25, .15)),
                                  list("Lecture", "G6", 8, c(.15, .30, .30, .20, .05)),
                                  list("Lecture", "G7", 8, c(.20, .30, .30, .15, .05)),
                                  list("Lecture", "G8", 9, c(.10, .25, .35, .20, .10))), function(r)
  data.frame(rating = sample(1:5, r[[3]], TRUE, r[[4]]), method = r[[1]], grade = r[[2]],
             stringsAsFactors = FALSE)))
lik <- lik[sample(nrow(lik)), ]
lik$rating[11] <- NA
write_dataset(lik, "fact_likert.csv")

# Mixed designs. 2 groups x 3 times (roughly spherical), missing values -> unequal groups.
set.seed(5202)
mixed_wide <- function(ns, glev, slopes, sd_subj, sd_err, walk = FALSE) {
  g <- rep(glev, ns); N <- sum(ns)
  b <- stats::rnorm(N, 0, sd_subj)
  e <- matrix(stats::rnorm(N * 3, 0, sd_err), N, 3)
  if (walk) e <- t(apply(e, 1, cumsum))
  mu <- t(sapply(g, function(gg) 50 + slopes[[gg]]))
  Y <- round(mu + b + e, 2)
  data.frame(id = sprintf("S%03d", seq_len(N)), group = g, t1 = Y[, 1], t2 = Y[, 2], t3 = Y[, 3],
             stringsAsFactors = FALSE)
}
m23 <- mixed_wide(c(14, 14), c("Control", "Program"),
                  list(Control = c(0, 1, 1.5), Program = c(0, 3, 6)), 5, 3)
m23$t2[c(4)] <- NA; m23$t3[c(20, 22)] <- NA; m23$group[9] <- NA
write_dataset(m23, "fact_mixed_2x3_wide.csv")
to_long <- function(w) {
  do.call(rbind, lapply(c("t1", "t2", "t3"), function(t)
    data.frame(id = w$id, group = w$group, time = t, score = w[[t]], stringsAsFactors = FALSE)))
}
l23 <- to_long(m23)
l23 <- l23[!(l23$id == "S020" & l23$time == "t3"), ]                           # a person missing a row
l23 <- rbind(l23, data.frame(id = "S999", group = "Control", time = "t1", score = 51))  # unmatched ID
l23 <- rbind(l23, data.frame(id = NA, group = "Program", time = "t2", score = 49.5))  # no ID
l23$group[l23$id == "S005" & l23$time == "t2"] <- "Program"   # inconsistent group (S005 is Control)
l23 <- l23[sample(nrow(l23)), ]
write_dataset(l23, "fact_mixed_2x3_long.csv")
# 3 groups x 3 times, unequal n, random-walk errors (variance grows over time: sphericity violated).
m33 <- mixed_wide(c(10, 12, 15), c("Coach", "Online", "Tutor"),
                  list(Coach = c(0, 2, 5), Online = c(0, 1, 2), Tutor = c(0, 3, 4)), 4, 3, walk = TRUE)
write_dataset(m33, "fact_mixed_3x3_wide.csv")
# 2 groups x 3 times, Likert (1-7), equal groups (n = 10), long layout.
set.seed(5303)
lik_m <- do.call(rbind, lapply(1:20, function(i) {
  g <- if (i <= 10) "Control" else "Program"
  base <- sample(2:5, 1)
  shift <- if (g == "Program") c(0, 1, 2) else c(0, 0, 1)
  data.frame(id = sprintf("P%02d", i), group = g, time = c("t1", "t2", "t3"),
             rating = pmin(7, pmax(1, base + shift + sample(-1:1, 3, TRUE))), stringsAsFactors = FALSE)
}))
write_dataset(lik_m[sample(nrow(lik_m)), ], "fact_mixed_likert_long.csv")

# =============================================================================
# Helpers
# =============================================================================
grp <- function(...) { a <- list(...); a }
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
pve_rec <- function(key, value, df1, df2, ci, es_lo = NULL, es_hi = NULL, cohens_f = FALSE, term = NULL) {
  v <- max(0, value)
  lam <- ncp_F_exact((v / df1) / ((1 - v) / df2), df1, df2, ci)
  b <- lam / (lam + df2)
  if (cohens_f) { value <- sqrt(v / (1 - v)); b <- sqrt(b / (1 - b)) }
  # effectsize finds the bounds with optim (Nelder-Mead), which can stop ~3e-3 short of the root.
  if (!is.null(es_lo)) stopifnot(abs(es_lo - b[1]) < 5e-3, abs(es_hi - b[2]) < 5e-3)
  rec <- es_rec(key, value, b[1], b[2])
  rec$effectsize_ci_lower <- num(es_lo)
  rec$effectsize_ci_upper <- num(es_hi)
  rec$term <- term
  rec
}
asm_rec <- function(test, kind, label, n, statistic, p, df = list()) {
  list(test = test, kind = kind, label = label, n = n, statistic = num(statistic), p = num(p), df = df)
}
emm_recs <- function(em, what, labels) {
  s <- as.data.frame(summary(em))
  lapply(seq_len(nrow(s)), function(i) list(
    kind = what, label = labels(s[i, ]), emmean = num(s$emmean[i]), se = num(s$SE[i]), df = num(s$df[i]),
    lower = num(s$lower.CL[i]), upper = num(s$upper.CL[i])))
}
# effectsize row for a term
es_row <- function(tab, term) tab[tab$Parameter == term, ]

# ---- between-subjects data (complete cases on y, A, B) ----
fact_data <- function(dataset, yv, av, bv) {
  d <- load_dataset(dataset)
  keep <- !is.na(d[[yv]]) & !is.na(d[[av]]) & !is.na(d[[bv]])
  al <- sort(unique(d[[av]][keep])); bl <- sort(unique(d[[bv]][keep]))
  f <- data.frame(y = d[[yv]][keep], A = factor(d[[av]][keep], levels = al),
                  B = factor(d[[bv]][keep], levels = bl))
  f$id <- factor(seq_len(nrow(f)))
  list(d = d, f = f, al = al, bl = bl, yv = yv, av = av, bv = bv, n_excluded = nrow(d) - sum(keep))
}
fact_desc <- function(fd, ci = 0.95) {
  d <- fd$d; out <- list()
  for (i in fd$al) for (j in fd$bl) {
    sel <- !is.na(d[[fd$av]]) & !is.na(d[[fd$bv]]) & d[[fd$av]] == i & d[[fd$bv]] == j
    out[[length(out) + 1]] <- desc_rec(fd$yv, setNames(list(i, j), c(fd$av, fd$bv)), d[[fd$yv]][sel], ci)
  }
  out
}
fact_request <- function(fd, opts = empty_obj, ci = 0.95) {
  req(list(outcome = list(fd$yv), factors = list(fd$av, fd$bv)), opts, "two_sided", ci)
}

# =============================================================================
# anova.factorial
# =============================================================================
factorial_case <- function(case, dataset, yv, av, bv, ci = 0.95) {
  fd <- fact_data(dataset, yv, av, bv)
  request <- fact_request(fd, ci = ci)
  f <- fd$f
  if (any(table(f$A, f$B) == 0)) {
    return(error_fact(case, "anova.factorial", dataset, request,
                      afex::aov_car(y ~ A * B + Error(id), data = f, type = 3)))
  }
  fit <- stats::lm(y ~ A * B, data = f)
  a3 <- car::Anova(fit, type = 3)
  af <- suppressMessages(afex::aov_car(y ~ A * B + Error(id), data = f, type = 3))
  an <- anova(af, es = "none")
  terms <- c("A", "B", "A:B")
  labels <- c(av, bv, paste(av, X, bv))
  df2 <- a3["Residuals", "Df"]
  pes <- effectsize::eta_squared(a3, partial = TRUE, ci = ci, alternative = "two.sided", verbose = FALSE)
  om <- effectsize::omega_squared(a3, partial = TRUE, ci = ci, alternative = "two.sided", verbose = FALSE)
  cf <- effectsize::cohens_f(a3, partial = TRUE, ci = ci, alternative = "two.sided", verbose = FALSE)
  mse <- a3["Residuals", "Sum Sq"] / df2
  statistics <- list(); effects <- list(); ss <- list()
  for (k in seq_along(terms)) {
    t <- terms[k]
    stopifnot(abs(an[t, "F"] - a3[t, "F value"]) < 1e-9 * max(1, a3[t, "F value"]))
    df1 <- a3[t, "Df"]
    statistics[[k]] <- stat_rec("F", a3[t, "F value"], c(df1, df2), a3[t, "Pr(>F)"], labels[k])
    p <- es_row(pes, t); o <- es_row(om, t); c_ <- es_row(cf, t)
    ssA <- a3[t, "Sum Sq"]
    stopifnot(abs(o$Omega2_partial - max(0, (ssA - df1 * mse) / (ssA + (nrow(f) - df1) * mse))) < 1e-12)
    effects <- c(effects, list(
      pve_rec("partial_eta_sq", p$Eta2_partial, df1, df2, ci, p$CI_low, p$CI_high, term = labels[k]),
      pve_rec("omega_sq", o$Omega2_partial, df1, df2, ci, o$CI_low, o$CI_high, term = labels[k]),
      pve_rec("cohens_f", p$Eta2_partial, df1, df2, ci, c_$CI_low, c_$CI_high, cohens_f = TRUE,
              term = labels[k])))
    ss[[labels[k]]] <- num(ssA)
  }
  ss[["Error"]] <- num(a3["Residuals", "Sum Sq"])
  lv <- car::leveneTest(y ~ A * B, data = f, center = median)
  sw <- stats::shapiro.test(stats::residuals(fit))
  asm <- list(asm_rec("levene_brown_forsythe", "overall", "all cells", nrow(f), lv[["F value"]][1],
                      lv[["Pr(>F)"]][1], list(lv$Df[1], lv$Df[2])),
              asm_rec("shapiro_wilk", "residuals", "model residuals", nrow(f), sw$statistic, sw$p.value))
  emms <- c(emm_recs(emmeans::emmeans(fit, ~A, level = ci), "marginal", function(r) setNames(list(as.character(r$A)), av)),
            emm_recs(emmeans::emmeans(fit, ~B, level = ci), "marginal", function(r) setNames(list(as.character(r$B)), bv)),
            emm_recs(emmeans::emmeans(fit, ~A:B, level = ci), "cell",
                     function(r) setNames(list(as.character(r$A), as.character(r$B)), c(av, bv))))
  write_fact(case, list(
    analysis_id = "anova.factorial", case = case, dataset = dataset, request = request,
    expected = list(n_used = nrow(f), n_excluded = fd$n_excluded, statistics = statistics,
                    effect_sizes = effects, descriptives = fact_desc(fd, ci), assumptions_ext = asm,
                    sums_of_squares = ss, emmeans = emms),
    error = NULL))
}
factorial_case("factorial__2x2", "fact_2x2.csv", "score", "method", "gender")
factorial_case("factorial__2x3_unbalanced_missing", "fact_2x3.csv", "score", "method", "grade")
factorial_case("factorial__3x3_n5", "fact_3x3.csv", "score", "method", "school")
factorial_case("factorial__3x3_n5_ci90", "fact_3x3.csv", "score", "method", "school", ci = 0.90)
factorial_case("factorial__likert_ties", "fact_likert.csv", "rating", "method", "grade")
factorial_case("factorial__empty_cell", "fact_empty_cell.csv", "score", "method", "grade")

# =============================================================================
# Mixed designs: data (wide or long, complete cases)
# =============================================================================
mixed_data <- function(dataset, layout, measures = NULL, yv = "score", tv = "time", sv = "id", gv = "group") {
  d <- load_dataset(dataset)
  if (layout == "wide") {
    Y <- as.matrix(d[, measures])
    cc <- stats::complete.cases(Y) & !is.na(d[[gv]])
    gl <- sort(unique(d[[gv]][cc]))
    desc <- list()
    for (g in gl) for (j in seq_along(measures)) {
      sel <- !is.na(d[[gv]]) & d[[gv]] == g
      desc[[length(desc) + 1]] <- desc_rec(measures[j], setNames(list(g), gv), Y[cc & d[[gv]] %in% g, j], 0.95,
                                           n_missing = sum(is.na(Y[sel, j])))
    }
    return(list(Y = Y[cc, , drop = FALSE], g = factor(d[[gv]][cc], levels = gl), gl = gl, tl = measures,
                n_excluded = sum(!cc), desc = desc, gv = gv, time_label = "Time"))
  }
  tl <- sort(unique(d[[tv]][!is.na(d[[tv]])]))
  in_lv <- d[[tv]] %in% tl
  f <- d[in_lv & !is.na(d[[sv]]), ]
  ids <- sort(unique(f[[sv]]))
  gs <- sapply(ids, function(i) { u <- unique(f[[gv]][f[[sv]] == i & !is.na(f[[gv]])]); if (length(u) == 1) u else NA })
  tab <- table(factor(f[[sv]], levels = ids), factor(f[[tv]], levels = tl))
  ok <- ids[apply(tab == 1, 1, all) & !is.na(gs)]
  Y <- sapply(tl, function(t) { s <- f[f[[tv]] == t, ]; s[[yv]][match(ok, s[[sv]])] })
  if (!is.matrix(Y)) Y <- matrix(Y, nrow = length(ok))
  cc <- stats::complete.cases(Y)
  ok <- ok[cc]; Y <- Y[cc, , drop = FALSE]
  g <- gs[ok]
  gl <- sort(unique(g))
  desc <- list()
  for (gg in gl) for (j in seq_along(tl)) {
    sel <- !is.na(d[[gv]]) & d[[gv]] == gg & d[[tv]] %in% tl[j]
    desc[[length(desc) + 1]] <- desc_rec(yv, setNames(list(gg, tl[j]), c(gv, tv)), Y[g == gg, j], 0.95,
                                         n_missing = sum(is.na(d[[yv]][sel])))
  }
  list(Y = Y, g = factor(g, levels = gl), gl = gl, tl = as.character(tl), n_excluded = sum(in_lv) - length(tl) * length(ok),
       desc = desc, gv = gv, time_label = tv)
}
mixed_request <- function(layout, measures, opts = empty_obj, yv = "score", tv = "time") {
  v <- if (layout == "wide") list(measures = as.list(measures), between = list("group"))
       else list(outcome = list(yv), time = list(tv), subject_id = list("id"), between = list("group"))
  req(v, opts)
}
mixed_long <- function(md) {
  n <- nrow(md$Y); k <- ncol(md$Y)
  data.frame(id = factor(rep(seq_len(n), k)), group = rep(md$g, k),
             time = factor(rep(md$tl, each = n), levels = md$tl), score = as.vector(md$Y))
}
box_m_hand <- function(Y, g) {
  p <- ncol(Y); lv <- levels(g); k <- length(lv); N <- nrow(Y)
  ni <- sapply(lv, function(l) sum(g == l))
  Si <- lapply(lv, function(l) stats::cov(Y[g == l, , drop = FALSE]))
  Sp <- Reduce(`+`, Map(function(S, n) (n - 1) * S, Si, ni)) / (N - k)
  M <- (N - k) * log(det(Sp)) - sum((ni - 1) * sapply(Si, function(S) log(det(S))))
  c1 <- (sum(1 / (ni - 1)) - 1 / (N - k)) * (2 * p^2 + 3 * p - 1) / (6 * (p + 1) * (k - 1))
  chi <- M * (1 - c1); df <- p * (p + 1) * (k - 1) / 2
  c(chi = chi, df = df, p = stats::pchisq(chi, df, lower.tail = FALSE))
}

# =============================================================================
# anova.mixed
# =============================================================================
mixed_case <- function(case, dataset, layout, measures = NULL, correction = NULL, ci = 0.95, yv = "score") {
  md <- mixed_data(dataset, layout, measures, yv = yv)
  Y <- md$Y; n <- nrow(Y); k <- ncol(Y); gl <- md$gl; G <- length(gl)
  long <- mixed_long(md)
  fit <- suppressMessages(afex::aov_ez("id", "score", long, between = "group", within = "time", type = 3))
  s <- summary(fit)
  u <- s$univariate.tests
  an <- anova(fit, correction = "none", es = "none")
  an_gg <- anova(fit, correction = "GG", es = "none")
  an_hf <- suppressWarnings(anova(fit, correction = "HF", es = "none"))
  tlab <- md$time_label
  labels <- c(group = "group", time = tlab, `group:time` = paste("group", X, tlab))
  sph_p <- if (k > 2) s$sphericity.tests["time", "p-value"] else NA
  mode <- if (is.null(correction)) "auto" else correction
  used <- switch(mode, auto = if (is.finite(sph_p) && sph_p < 0.05) "gg" else "none", mode)
  statistics <- list(stat_rec("F", an["group", "F"], c(an["group", "num Df"], an["group", "den Df"]),
                              an["group", "Pr(>F)"], labels[["group"]]))
  ssb_err <- u["(Intercept)", "Error SS"]; dfb_err <- u["(Intercept)", "den Df"]
  ssw_err <- u["time", "Error SS"]
  gg <- if (k > 2) s$pval.adjustments["time", "GG eps"] else 1
  hf_raw <- if (k > 2) s$pval.adjustments["time", "HF eps"] else 1
  hf <- min(1, hf_raw)
  for (t in c("time", "group:time")) {
    df1 <- an[t, "num Df"]; df2 <- an[t, "den Df"]
    if (k > 2) stopifnot(abs(an_gg[t, "num Df"] - df1 * gg) < 1e-9, abs(an_hf[t, "num Df"] - df1 * hf) < 1e-9)
    rec <- list(none = stat_rec("F", an[t, "F"], c(df1, df2), an[t, "Pr(>F)"], labels[[t]]),
                gg = stat_rec("F_gg", an[t, "F"], c(df1 * gg, df2 * gg), an_gg[t, "Pr(>F)"], labels[[t]]),
                hf = stat_rec("F_hf", an[t, "F"], c(df1 * hf, df2 * hf), an_hf[t, "Pr(>F)"], labels[[t]]))
    statistics <- c(statistics, unname(rec[c(used, setdiff(c("none", "gg", "hf"), used))]))
  }
  statistics <- c(statistics, list(stat_rec("epsilon_gg", gg, term = labels[["time"]]),
                                   stat_rec("epsilon_hf", hf, term = labels[["time"]])))
  pes <- effectsize::eta_squared(fit, partial = TRUE, ci = ci, alternative = "two.sided", verbose = FALSE)
  ges <- effectsize::eta_squared(fit, generalized = TRUE, ci = ci, alternative = "two.sided", verbose = FALSE)
  om <- effectsize::omega_squared(fit, partial = TRUE, ci = ci, alternative = "two.sided", verbose = FALSE)
  cf <- effectsize::cohens_f(fit, partial = TRUE, ci = ci, alternative = "two.sided", verbose = FALSE)
  ges_afex <- anova(fit, es = "ges")
  effects <- list(); ss <- list()
  for (t in c("group", "time", "group:time")) {
    df1 <- an[t, "num Df"]; df2 <- an[t, "den Df"]
    p <- es_row(pes, t); gz <- es_row(ges, t); o <- es_row(om, t); c_ <- es_row(cf, t)
    stopifnot(abs(gz$Eta2_generalized - ges_afex[t, "ges"]) < 1e-12)
    ssT <- u[t, "Sum Sq"]; err <- u[t, "Error SS"]
    within <- t != "group"
    om_hand <- max(0, (ssT - df1 * err / df2) / (ssT + within * err + ssb_err + ssb_err / dfb_err))
    stopifnot(abs(om_hand - o$Omega2_partial) < 1e-12)
    effects <- c(effects, list(
      pve_rec("partial_eta_sq", p$Eta2_partial, df1, df2, ci, p$CI_low, p$CI_high, term = labels[[t]]),
      pve_rec("generalized_eta_sq", gz$Eta2_generalized, df1, df2, ci, gz$CI_low, gz$CI_high, term = labels[[t]]),
      pve_rec("omega_sq", o$Omega2_partial, df1, df2, ci, o$CI_low, o$CI_high, term = labels[[t]]),
      pve_rec("cohens_f", p$Eta2_partial, df1, df2, ci, c_$CI_low, c_$CI_high, cohens_f = TRUE, term = labels[[t]])))
    ss[[labels[[t]]]] <- num(ssT)
  }
  ss[["Error (between)"]] <- num(ssb_err); ss[["Error (within)"]] <- num(ssw_err)
  # assumptions
  asm <- list()
  if (k > 2) {
    for (t in c("time", "group:time")) stopifnot(abs(s$sphericity.tests[t, "Test statistic"] - s$sphericity.tests["time", "Test statistic"]) < 1e-12)
    asm[[1]] <- asm_rec("mauchly", "overall", "all time points", n, s$sphericity.tests["time", "Test statistic"],
                        sph_p, list(k * (k - 1) / 2 - 1))
  }
  bm <- box_m_hand(Y, md$g)
  if (HAVE_HEPLOTS) {
    hb <- heplots::boxM(Y, md$g)
    stopifnot(abs(hb$statistic - bm[["chi"]]) < 1e-9, abs(hb$p.value - bm[["p"]]) < 1e-12,
              hb$parameter == bm[["df"]])
  }
  asm[[length(asm) + 1]] <- asm_rec("box_m", "overall", "all groups", n, bm[["chi"]], bm[["p"]], list(bm[["df"]]))
  for (j in seq_len(k)) {
    lv <- car::leveneTest(Y[, j] ~ md$g, center = median)
    asm[[length(asm) + 1]] <- asm_rec("levene_brown_forsythe", "group", md$tl[j], n, lv[["F value"]][1],
                                      lv[["Pr(>F)"]][1], list(lv$Df[1], lv$Df[2]))
    sw <- stats::shapiro.test(stats::residuals(stats::lm(Y[, j] ~ md$g)))
    asm[[length(asm) + 1]] <- asm_rec("shapiro_wilk", "residuals", md$tl[j], n, sw$statistic, sw$p.value)
  }
  emms <- c(emm_recs(emmeans::emmeans(fit, ~group, level = ci), "marginal", function(r) list(group = as.character(r$group))),
            emm_recs(emmeans::emmeans(fit, ~time, level = ci), "marginal", function(r) setNames(list(as.character(r$time)), tlab)),
            emm_recs(emmeans::emmeans(fit, ~group:time, level = ci), "cell",
                     function(r) setNames(list(as.character(r$group), as.character(r$time)), c("group", tlab))))
  opts <- if (is.null(correction)) empty_obj else list(correction = correction)
  write_fact(case, list(
    analysis_id = "anova.mixed", case = case, dataset = dataset, request = mixed_request(layout, measures, opts, yv = yv),
    expected = list(n_used = n, n_excluded = md$n_excluded, statistics = statistics, effect_sizes = effects,
                    descriptives = md$desc, assumptions_ext = asm, sums_of_squares = ss, emmeans = emms,
                    epsilon_hf_uncapped = num(hf_raw), headline_correction = used),
    error = NULL))
}
mixed_case("mixed__2x3_wide", "fact_mixed_2x3_wide.csv", "wide", c("t1", "t2", "t3"))
mixed_case("mixed__2x3_long", "fact_mixed_2x3_long.csv", "long")
mixed_case("mixed__2x2_wide_two_times", "fact_mixed_2x3_wide.csv", "wide", c("t1", "t3"))
mixed_case("mixed__3x3_wide_sphericity", "fact_mixed_3x3_wide.csv", "wide", c("t1", "t2", "t3"))
mixed_case("mixed__3x3_wide_hf", "fact_mixed_3x3_wide.csv", "wide", c("t1", "t2", "t3"), correction = "hf")
mixed_case("mixed__likert_long", "fact_mixed_likert_long.csv", "long", yv = "rating")

# =============================================================================
# anova.art
# =============================================================================
art_effects <- function(Fv, df1, df2, ci, term) {
  e <- effectsize::F_to_eta2(Fv, df1, df2, ci = ci, alternative = "two.sided")
  pve_rec("partial_eta_sq", e$Eta2_partial, df1, df2, ci, e$CI_low, e$CI_high, term = term)
}
art_factorial_case <- function(case, dataset, yv, av, bv, ci = 0.95) {
  fd <- fact_data(dataset, yv, av, bv)
  f <- fd$f
  m <- ARTool::art(y ~ A * B, data = f)
  a <- anova(m)
  terms <- c("A", "B", "A:B"); labels <- c(av, bv, paste(av, X, bv))
  statistics <- list(); effects <- list()
  for (k in seq_along(terms)) {
    r <- a[a$Term == terms[k], ]
    statistics[[k]] <- stat_rec("F", r$F, c(r$Df, r$Df.res), r$`Pr(>F)`, labels[k])
    effects[[k]] <- art_effects(r$F, r$Df, r$Df.res, ci, labels[k])
  }
  write_fact(case, list(
    analysis_id = "anova.art", case = case, dataset = dataset, request = fact_request(fd, ci = ci),
    expected = list(n_used = nrow(f), n_excluded = fd$n_excluded, statistics = statistics, effect_sizes = effects,
                    descriptives = fact_desc(fd, ci)),
    error = NULL))
}
art_factorial_case("art__likert_ties", "fact_likert.csv", "rating", "method", "grade")
art_factorial_case("art__2x2", "fact_2x2.csv", "score", "method", "gender")
art_factorial_case("art__3x3_n5", "fact_3x3.csv", "score", "method", "school")
art_factorial_case("art__2x3_unbalanced_missing", "fact_2x3.csv", "score", "method", "grade")

art_mixed_case <- function(case, dataset, layout, measures = NULL, yv = "score", ci = 0.95) {
  md <- mixed_data(dataset, layout, measures, yv = yv)
  long <- mixed_long(md)
  m <- ARTool::art(score ~ group * time + Error(id), data = long)
  a <- anova(m)
  tlab <- md$time_label
  terms <- c("group", "time", "group:time")
  labels <- c("group", tlab, paste("group", X, tlab))
  statistics <- list(); effects <- list()
  for (k in seq_along(terms)) {
    r <- a[a$Term == terms[k], ]
    statistics[[k]] <- stat_rec("F", r$F, c(r$Df, r$Df.res), r$`Pr(>F)`, labels[k])
    effects[[k]] <- art_effects(r$F, r$Df, r$Df.res, ci, labels[k])
  }
  write_fact(case, list(
    analysis_id = "anova.art", case = case, dataset = dataset,
    request = mixed_request(layout, measures, yv = yv),
    expected = list(n_used = nrow(md$Y), n_excluded = md$n_excluded, statistics = statistics,
                    effect_sizes = effects, descriptives = md$desc),
    error = NULL))
}
art_mixed_case("art__mixed_likert_long", "fact_mixed_likert_long.csv", "long", yv = "rating")
art_mixed_case("art__mixed_3x3_wide_unequal", "fact_mixed_3x3_wide.csv", "wide", c("t1", "t2", "t3"))
art_mixed_case("art__mixed_2x3_long", "fact_mixed_2x3_long.csv", "long")
error_fact("art__empty_cell", "anova.art", "fact_empty_cell.csv",
           fact_request(fact_data("fact_empty_cell.csv", "score", "method", "grade")),
           { f <- fact_data("fact_empty_cell.csv", "score", "method", "grade")$f
             anova(ARTool::art(y ~ A * B, data = f)) })

# =============================================================================
# posthoc.simple_effects
# =============================================================================
simple_recs <- function(emm, jt, by_levels, by_name, eff_label, ci, adjust) {
  pr <- summary(pairs(emm, adjust = adjust), infer = c(TRUE, TRUE), level = ci)
  pr <- as.data.frame(pr)
  jt <- as.data.frame(jt)
  cc <- emmeans::contrast(emm, "consec")
  cs <- as.data.frame(summary(cc)); V <- stats::vcov(cc)
  statistics <- list(); effects <- list(); by_out <- list()
  for (lv in by_levels) {
    j <- jt[as.character(jt[[by_name]]) == lv, ]
    stopifnot(nrow(j) == 1)
    term <- paste(eff_label, "at", lv)
    # joint_tests prints F rounded to 3 dp, so the Wald F is recomputed from emmeans' own consecutive
    # contrasts and their covariance (the same quantity, unrounded) and checked against it.
    idx <- which(as.character(cs[[by_name]]) == lv)
    est <- cs$estimate[idx]
    Fx <- drop(t(est) %*% solve(V[idx, idx, drop = FALSE], est)) / length(idx)
    stopifnot(length(idx) == j$df1, abs(Fx - j$F.ratio) < 1e-3 * max(1, Fx))
    px <- stats::pf(Fx, j$df1, j$df2, lower.tail = FALSE)
    stopifnot(abs(px - j$p.value) < 1e-4)
    statistics[[length(statistics) + 1]] <- stat_rec("F", Fx, c(j$df1, j$df2), px, term)
    e <- effectsize::F_to_eta2(Fx, j$df1, j$df2, ci = ci, alternative = "two.sided")
    effects[[length(effects) + 1]] <- pve_rec("partial_eta_sq", e$Eta2_partial, j$df1, j$df2, ci, e$CI_low,
                                              e$CI_high, term = term)
  }
  for (lv in by_levels) {
    rows <- pr[as.character(pr[[by_name]]) == lv, ]
    m <- nrow(rows)
    for (r in seq_len(m)) {
      ct <- strsplit(as.character(rows$contrast[r]), " - ", fixed = TRUE)[[1]]
      term <- paste(ct[1], "vs", ct[2], "at", lv)
      statistics[[length(statistics) + 1]] <- stat_rec("t", rows$t.ratio[r], rows$df[r], rows$p.value[r], term)
      qc <- stats::qt(1 - (1 - ci) / (2 * m), rows$df[r])
      stopifnot(abs(rows$estimate[r] - qc * rows$SE[r] - rows$lower.CL[r]) < 1e-9)
      md <- es_rec("mean_difference", rows$estimate[r], rows$lower.CL[r], rows$upper.CL[r])
      md$term <- term
      effects[[length(effects) + 1]] <- md
    }
  }
  list(statistics = statistics, effects = effects)
}
simple_factorial_case <- function(case, dataset, yv, av, bv, by = NULL, adjust = "holm", ci = 0.95) {
  fd <- fact_data(dataset, yv, av, bv)
  f <- fd$f
  fit <- stats::lm(y ~ A * B, data = f)
  by_var <- if (is.null(by)) bv else by
  if (by_var == bv) {
    emm <- emmeans::emmeans(fit, ~ A | B); jt <- emmeans::joint_tests(fit, by = "B")
    names(jt)[names(jt) == "B"] <- "B"; recs <- simple_recs(emm, jt, fd$bl, "B", av, ci, adjust)
  } else {
    emm <- emmeans::emmeans(fit, ~ B | A); jt <- emmeans::joint_tests(fit, by = "A")
    recs <- simple_recs(emm, jt, fd$al, "A", bv, ci, adjust)
  }
  opts <- list(); if (!is.null(by)) opts$by <- by; if (adjust != "holm") opts$adjust <- adjust
  if (!length(opts)) opts <- empty_obj
  write_fact(case, list(
    analysis_id = "posthoc.simple_effects", case = case, dataset = dataset,
    request = fact_request(fd, opts, ci),
    expected = list(n_used = nrow(f), n_excluded = fd$n_excluded, statistics = recs$statistics,
                    effect_sizes = recs$effects, descriptives = fact_desc(fd, ci)),
    error = NULL))
}
simple_factorial_case("simple__2x2", "fact_2x2.csv", "score", "method", "gender")
simple_factorial_case("simple__2x3_unbalanced_by_grade", "fact_2x3.csv", "score", "method", "grade")
simple_factorial_case("simple__2x3_unbalanced_by_method", "fact_2x3.csv", "score", "method", "grade", by = "method")
simple_factorial_case("simple__3x3_n5_bonferroni", "fact_3x3.csv", "score", "method", "school", adjust = "bonferroni")

simple_mixed_case <- function(case, dataset, layout, measures = NULL, by = NULL, adjust = "holm", ci = 0.95) {
  md <- mixed_data(dataset, layout, measures)
  long <- mixed_long(md)
  fit <- suppressMessages(afex::aov_ez("id", "score", long, between = "group", within = "time", type = 3))
  by_between <- is.null(by) || by == "group"
  tlab <- md$time_label
  if (by_between) {
    emm <- emmeans::emmeans(fit, ~ time | group); jt <- emmeans::joint_tests(fit, by = "group")
    recs <- simple_recs(emm, jt, md$gl, "group", tlab, ci, adjust)
    # multivariate model check: Wald F on the pooled within-group covariance, df = N - g
    Sp <- crossprod(stats::residuals(stats::lm(md$Y ~ md$g))) / (nrow(md$Y) - length(md$gl))
    k <- ncol(md$Y); L <- cbind(diag(k - 1), 0) - cbind(0, diag(k - 1))
    for (i in seq_along(md$gl)) {
      yy <- md$Y[md$g == md$gl[i], , drop = FALSE]; mu <- colMeans(yy)
      Fh <- drop(t(L %*% mu) %*% solve(L %*% Sp %*% t(L) / nrow(yy)) %*% (L %*% mu)) / (k - 1)
      stopifnot(abs(Fh - recs$statistics[[i]]$value) < 1e-9 * max(1, Fh))
    }
  } else {
    emm <- emmeans::emmeans(fit, ~ group | time); jt <- emmeans::joint_tests(fit, by = "time")
    recs <- simple_recs(emm, jt, md$tl, "time", "group", ci, adjust)
  }
  opts <- list(); if (!is.null(by)) opts$by <- by; if (adjust != "holm") opts$adjust <- adjust
  if (!length(opts)) opts <- empty_obj
  write_fact(case, list(
    analysis_id = "posthoc.simple_effects", case = case, dataset = dataset,
    request = mixed_request(layout, measures, opts),
    expected = list(n_used = nrow(md$Y), n_excluded = md$n_excluded, statistics = recs$statistics,
                    effect_sizes = recs$effects, descriptives = md$desc),
    error = NULL))
}
simple_mixed_case("simple__mixed_2x3_wide_by_group", "fact_mixed_2x3_wide.csv", "wide", c("t1", "t2", "t3"))
simple_mixed_case("simple__mixed_2x3_long_by_time", "fact_mixed_2x3_long.csv", "long", by = "time")
simple_mixed_case("simple__mixed_3x3_wide_by_group", "fact_mixed_3x3_wide.csv", "wide", c("t1", "t2", "t3"))
simple_mixed_case("simple__mixed_3x3_wide_by_time", "fact_mixed_3x3_wide.csv", "wide", c("t1", "t2", "t3"),
                  by = "within")

cat("factorial fixtures written:", length(list.files(file.path(EXPECTED, DIR))), "\n")
