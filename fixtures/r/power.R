# Power analysis fixtures (SPEC §8, §12) -> fixtures/expected/power/*.json. No datasets.
#   Rscript fixtures/r/power.R
#
# Reference: R pwr 1.3.0 (pwr.t.test, pwr.t2n.test, pwr.anova.test, pwr.r.test, pwr.chisq.test,
# pwr.f2.test). pwr solves n / effect with uniroot's default tol (~1.2e-4), so every fixture records
# the exact root of pwr's own power function (uniroot, tol 1e-12) as the reference and keeps pwr's
# returned value as `pwr_solution` for information (its ceiling must give the same planned n).
# Repeated-measures / mixed designs have no pwr function: hand R code implements G*Power 3's formulas
# (Faul, Erdfelder, Lang & Buchner, 2007, Behavior Research Methods 39, 175-191, Table 3), and the
# printed G*Power results from that article (pp. 181-183) are recorded as gpower_*.json.
if (!exists("R_DIR")) source(file.path(dirname(normalizePath(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))), "common.R"))
suppressPackageStartupMessages(library(pwr))
.old_packages <- FIXTURE_PACKAGES
FIXTURE_PACKAGES <- c("stats", "pwr", "jsonlite")

OUT <- "power"
# Files are overwritten in place (deleting the folder first leaves sync-conflict copies on synced disks);
# stale cases are removed at the end.
WRITTEN <- character(0)
CONV <- list(d = c(small = .2, medium = .5, large = .8), f = c(small = .1, medium = .25, large = .4),
             r = c(small = .1, medium = .3, large = .5), w = c(small = .1, medium = .3, large = .5),
             f2 = c(small = .02, medium = .15, large = .35))
EMPTY <- setNames(list(), character(0))
TOL_ROOT <- 1e-12

root <- function(fn, target, lo, hi) {
  stats::uniroot(function(x) fn(x) - target, c(lo, hi), tol = TOL_ROOT, maxiter = 10000)$root
}
n_case <- 0L
emit <- function(analysis_id, case, options, tails, alpha, statistics, effect, pwr_solution = NULL, note = NULL) {
  n_case <<- n_case + 1L; WRITTEN <<- c(WRITTEN, case)
  write_fixture(OUT, case, list(
    analysis_id = analysis_id, case = case, dataset = NULL,
    request = req(EMPTY, options, tails = tails, alpha = alpha),
    expected = list(statistics = statistics, effect_sizes = list(effect)),
    pwr_solution = num(pwr_solution), note = note, error = NULL))
}
alt <- function(tails) r_alternative(tails)
tcrit <- function(nu, alpha, tails) switch(tails, two_sided = qt(alpha / 2, nu, lower.tail = FALSE),
                                           greater = qt(alpha, nu, lower.tail = FALSE), less = qt(alpha, nu))
sgn <- function(tails) if (tails == "less") -1 else 1

# Common a priori / sensitivity record builders -------------------------------------------------
apriori_stats <- function(n_req, n_exact, n_total, achieved, crit, crit_df, ncp, n2 = NULL) {
  s <- list(stat_rec("n_required", n_req), stat_rec("n_exact", n_exact), stat_rec("n_total", n_total))
  if (!is.null(n2)) s <- c(s, list(stat_rec("n2_required", n2)))
  s <- c(s, list(stat_rec("achieved_power", achieved), stat_rec("critical_value", crit, crit_df)))
  if (!is.null(ncp)) s <- c(s, list(stat_rec("ncp", ncp)))
  s
}
sens_stats <- function(eff, power, n_total, crit, crit_df, ncp) {
  s <- list(stat_rec("detectable_effect", eff), stat_rec("power", power), stat_rec("n_total", n_total),
            stat_rec("critical_value", crit, crit_df))
  if (!is.null(ncp)) s <- c(s, list(stat_rec("ncp", ncp)))
  s
}
check_ceiling <- function(pwr_n, n_req, rule = ceiling) {
  if (rule(pwr_n) != n_req) message("note: pwr's default-tolerance root rounds differently: ", pwr_n, " vs ", n_req)
}

# ---- t tests ------------------------------------------------------------------------------------
t_type <- c(independent = "two.sample", paired = "paired", one_sample = "one.sample")
t_key <- c(independent = "cohens_d", paired = "d_z", one_sample = "cohens_d")
for (design in names(t_type)) for (lbl in names(CONV$d)) for (alpha in c(.05, .01)) for (pw in c(.80, .95))
  for (tails in c("two_sided", "greater", "less")) {
    if (tails == "less" && !(lbl == "medium" && alpha == .05)) next   # 'less' mirrors 'greater': a few cases
    d <- sgn(tails) * CONV$d[[lbl]]
    f <- function(n) pwr.t.test(n = n, d = d, sig.level = alpha, type = t_type[[design]], alternative = alt(tails))$power
    n_exact <- root(f, pw, 2 + 1e-10, 1e9)
    pwr_n <- pwr.t.test(d = d, sig.level = alpha, power = pw, type = t_type[[design]], alternative = alt(tails))$n
    n_req <- ceiling(n_exact); check_ceiling(pwr_n, n_req)
    ts <- if (design == "independent") 2 else 1
    nu <- (n_req - 1) * ts
    st <- apriori_stats(n_req, n_exact, n_req * ts, f(n_req), tcrit(nu, alpha, tails), nu, sqrt(n_req / ts) * d,
                        n2 = if (design == "independent") n_req else NULL)
    emit("power.t_test", sprintf("t_%s_%s_a%s_p%s_%s", design, lbl, alpha * 100, pw * 100, tails),
         list(design = design, effect_size = lbl, power = pw), tails, alpha, st, es_rec(t_key[[design]], d), pwr_n)
  }

# Unequal allocation: n2 = ratio x n1; planned n1 = ceiling(exact), n2 = ceiling(ratio x n1).
for (ratio in c(2, 0.5, 1.5)) for (lbl in names(CONV$d)) for (tails in c("two_sided", "greater")) {
  d <- CONV$d[[lbl]]; alpha <- .05; pw <- .80
  f <- function(n1) pwr.t2n.test(n1 = n1, n2 = ratio * n1, d = d, sig.level = alpha, alternative = alt(tails))$power
  n_exact <- root(f, pw, max(2, 2 / ratio) + 1e-10, 1e9)
  n1 <- ceiling(n_exact); n2 <- ceiling(ratio * n1 - 1e-9)
  pw_int <- pwr.t2n.test(n1 = n1, n2 = n2, d = d, sig.level = alpha, alternative = alt(tails))$power
  stopifnot(pw_int >= pw)
  nu <- n1 + n2 - 2
  st <- apriori_stats(n1, n_exact, n1 + n2, pw_int, tcrit(nu, alpha, tails), nu, d / sqrt(1 / n1 + 1 / n2), n2 = n2)
  emit("power.t_test", sprintf("t_independent_ratio%s_%s_%s", ratio * 10, lbl, tails),
       list(design = "independent", effect_size = d, allocation_ratio = ratio, power = pw), tails, alpha, st,
       es_rec("cohens_d", d), note = "pwr.t2n.test power at (n1, ratio*n1); rounding n1 up, n2 = ceiling(ratio*n1)")
}

# Sensitivity (effect for a given n).
for (design in names(t_type)) for (n in c(20, 50)) for (tails in c("two_sided", "greater", "less")) {
  alpha <- .05; pw <- .80; s <- sgn(tails)
  f <- function(m) pwr.t.test(n = n, d = s * m, sig.level = alpha, type = t_type[[design]], alternative = alt(tails))$power
  d <- s * root(f, pw, 1e-7, 10)
  ts <- if (design == "independent") 2 else 1
  nu <- (n - 1) * ts
  pwr_d <- pwr.t.test(n = n, sig.level = alpha, power = pw, type = t_type[[design]], alternative = alt(tails))$d
  st <- sens_stats(d, pw, n * ts, tcrit(nu, alpha, tails), nu, sqrt(n / ts) * d)
  emit("power.t_test", sprintf("t_sens_%s_n%s_%s", design, n, tails),
       list(design = design, mode = "sensitivity", n = n, power = pw), tails, alpha, st, es_rec(t_key[[design]], d), pwr_d)
}
# Sensitivity with unequal groups (pwr.t2n.test).
local({
  n1 <- 30; n2 <- 45; alpha <- .05; pw <- .90
  f <- function(m) pwr.t2n.test(n1 = n1, n2 = n2, d = m, sig.level = alpha)$power
  d <- root(f, pw, 1e-7, 10); nu <- n1 + n2 - 2
  st <- sens_stats(d, pw, n1 + n2, tcrit(nu, alpha, "two_sided"), nu, d / sqrt(1 / n1 + 1 / n2))
  emit("power.t_test", "t_sens_independent_n30_45", list(design = "independent", mode = "sensitivity", n = n1, n2 = n2,
       power = pw), "two_sided", alpha, st, es_rec("cohens_d", d),
       pwr.t2n.test(n1 = n1, n2 = n2, sig.level = alpha, power = pw)$d)
})

# ---- one-way ANOVA (pwr.anova.test; n per group) ---------------------------------------------
for (k in c(3, 4)) for (lbl in names(CONV$f)) for (alpha in c(.05, .01)) for (pw in c(.80, .95)) {
  fv <- CONV$f[[lbl]]
  f <- function(n) pwr.anova.test(k = k, n = n, f = fv, sig.level = alpha)$power
  n_exact <- root(f, pw, 2 + 1e-10, 1e9); n_req <- ceiling(n_exact)
  pwr_n <- pwr.anova.test(k = k, f = fv, sig.level = alpha, power = pw)$n; check_ceiling(pwr_n, n_req)
  df2 <- (n_req - 1) * k
  st <- apriori_stats(n_req, n_exact, k * n_req, f(n_req), qf(alpha, k - 1, df2, lower.tail = FALSE), c(k - 1, df2),
                      k * n_req * fv^2)
  emit("power.anova", sprintf("anova_oneway_k%s_%s_a%s_p%s", k, lbl, alpha * 100, pw * 100),
       list(design = "one_way", groups = k, effect_size = lbl, power = pw), "two_sided", alpha, st, es_rec("cohens_f", fv), pwr_n)
}
for (n in c(15, 40)) local({
  k <- 3; alpha <- .05; pw <- .80
  f <- function(fv) pwr.anova.test(k = k, n = n, f = fv, sig.level = alpha)$power
  fv <- root(f, pw, 1e-7, 100); df2 <- (n - 1) * k
  st <- sens_stats(fv, pw, k * n, qf(alpha, k - 1, df2, lower.tail = FALSE), c(k - 1, df2), k * n * fv^2)
  emit("power.anova", sprintf("anova_sens_oneway_n%s", n), list(design = "one_way", groups = k, mode = "sensitivity",
       n = n, power = pw), "two_sided", alpha, st, es_rec("cohens_f", fv),
       pwr.anova.test(k = k, n = n, sig.level = alpha, power = pw)$f)
})

# ---- repeated measures / mixed: G*Power 3 formulas (hand R) ----------------------------------
rm_parts <- function(design, N, f, k, m, rho, eps) {
  switch(design,
    rm_within = list(df1 = (m - 1) * eps, df2 = (N - k) * (m - 1) * eps, lambda = f^2 * N * m * eps / (1 - rho)),
    rm_between = list(df1 = k - 1, df2 = N - k, lambda = f^2 * N * m / (1 + (m - 1) * rho)),
    mixed_interaction = list(df1 = (k - 1) * (m - 1) * eps, df2 = (N - k) * (m - 1) * eps,
                             lambda = f^2 * N * m * eps / (1 - rho)))
}
rm_power <- function(design, N, f, k, m, rho, eps, alpha) {
  p <- rm_parts(design, N, f, k, m, rho, eps)
  pf(qf(alpha, p$df1, p$df2, lower.tail = FALSE), p$df1, p$df2, p$lambda, lower.tail = FALSE)
}
rm_cases <- list(
  list(design = "rm_within", k = 1, m = 3, rho = .5, eps = 1), list(design = "rm_within", k = 1, m = 4, rho = .3, eps = .75),
  list(design = "rm_within", k = 2, m = 3, rho = .6, eps = 1), list(design = "rm_between", k = 2, m = 3, rho = .5, eps = 1),
  list(design = "rm_between", k = 3, m = 4, rho = .4, eps = 1), list(design = "mixed_interaction", k = 2, m = 3, rho = .5, eps = 1),
  list(design = "mixed_interaction", k = 3, m = 4, rho = .5, eps = .8))
for (cs in rm_cases) for (lbl in names(CONV$f)) for (pw in c(.80, .95)) {
  alpha <- .05; fv <- CONV$f[[lbl]]
  f <- function(N) rm_power(cs$design, N, fv, cs$k, cs$m, cs$rho, cs$eps, alpha)
  n_exact <- root(f, pw, cs$k + 1e-6, 1e9)
  N <- ceiling(ceiling(n_exact - 1e-9) / cs$k) * cs$k            # equal groups: next multiple of k
  while (f(N) < pw) N <- N + cs$k
  p <- rm_parts(cs$design, N, fv, cs$k, cs$m, cs$rho, cs$eps)
  st <- apriori_stats(N, n_exact, N, f(N), qf(alpha, p$df1, p$df2, lower.tail = FALSE), c(p$df1, p$df2), p$lambda)
  emit("power.anova", sprintf("anova_%s_k%s_m%s_r%s_e%s_%s_p%s", cs$design, cs$k, cs$m, cs$rho * 10, cs$eps * 100, lbl, pw * 100),
       list(design = cs$design, groups = cs$k, measurements = cs$m, correlation = cs$rho, epsilon = cs$eps,
            effect_size = lbl, power = pw), "two_sided", alpha, st, es_rec("cohens_f", fv),
       note = "hand R implementation of G*Power 3's univariate repeated-measures formulas (Faul et al., 2007, Table 3)")
}
for (cs in rm_cases[c(1, 4, 6)]) local({
  alpha <- .05; pw <- .80; N <- 12 * cs$k
  f <- function(fv) rm_power(cs$design, N, fv, cs$k, cs$m, cs$rho, cs$eps, alpha)
  fv <- root(f, pw, 1e-7, 100); p <- rm_parts(cs$design, N, fv, cs$k, cs$m, cs$rho, cs$eps)
  st <- sens_stats(fv, pw, N, qf(alpha, p$df1, p$df2, lower.tail = FALSE), c(p$df1, p$df2), p$lambda)
  emit("power.anova", sprintf("anova_sens_%s_N%s", cs$design, N), list(design = cs$design, groups = cs$k,
       measurements = cs$m, correlation = cs$rho, epsilon = cs$eps, mode = "sensitivity", n = N, power = pw),
       "two_sided", alpha, st, es_rec("cohens_f", fv), note = "hand R, G*Power 3 formulas")
})

# ---- correlation (pwr.r.test) --------------------------------------------------------------------
r_crit <- function(n, alpha, tails) {
  ttt <- qt(if (tails == "two_sided") alpha / 2 else alpha, n - 2, lower.tail = FALSE)
  sgn(tails) * sqrt(ttt^2 / (ttt^2 + n - 2))
}
for (lbl in names(CONV$r)) for (alpha in c(.05, .01)) for (pw in c(.80, .95)) for (tails in c("two_sided", "greater", "less")) {
  if (tails == "less" && !(lbl == "medium" && alpha == .05)) next
  r <- sgn(tails) * CONV$r[[lbl]]
  f <- function(n) pwr.r.test(n = n, r = r, sig.level = alpha, alternative = alt(tails))$power
  n_exact <- root(f, pw, 4 + 1e-10, 1e9); n_req <- ceiling(n_exact)
  pwr_n <- pwr.r.test(r = r, sig.level = alpha, power = pw, alternative = alt(tails))$n; check_ceiling(pwr_n, n_req)
  st <- apriori_stats(n_req, n_exact, n_req, f(n_req), r_crit(n_req, alpha, tails), n_req - 2, NULL)
  emit("power.correlation", sprintf("r_%s_a%s_p%s_%s", lbl, alpha * 100, pw * 100, tails),
       list(effect_size = lbl, power = pw), tails, alpha, st, es_rec("r", r), pwr_n)
}
for (n in c(30, 100)) for (tails in c("two_sided", "less")) local({
  alpha <- .05; pw <- .80; s <- sgn(tails)
  f <- function(m) pwr.r.test(n = n, r = s * m, sig.level = alpha, alternative = alt(tails))$power
  r <- s * root(f, pw, 1e-10, 1 - 1e-10)
  st <- sens_stats(r, pw, n, r_crit(n, alpha, tails), n - 2, NULL)
  emit("power.correlation", sprintf("r_sens_n%s_%s", n, tails), list(mode = "sensitivity", n = n, power = pw),
       tails, alpha, st, es_rec("r", r), pwr.r.test(n = n, sig.level = alpha, power = pw, alternative = alt(tails))$r)
})

# ---- chi-square (pwr.chisq.test) ------------------------------------------------------------------
for (df in c(1, 2, 4)) for (lbl in names(CONV$w)) for (alpha in c(.05, .01)) for (pw in c(.80, .95)) {
  if (df == 4 && alpha == .01) next
  w <- CONV$w[[lbl]]
  f <- function(N) pwr.chisq.test(w = w, N = N, df = df, sig.level = alpha)$power
  n_exact <- root(f, pw, 1 + 1e-10, 1e9); n_req <- ceiling(n_exact)
  pwr_n <- pwr.chisq.test(w = w, df = df, sig.level = alpha, power = pw)$N; check_ceiling(pwr_n, n_req)
  st <- apriori_stats(n_req, n_exact, n_req, f(n_req), qchisq(alpha, df, lower.tail = FALSE), df, n_req * w^2)
  opts <- if (df == 2) list(rows = 2, columns = 3, effect_size = lbl, power = pw) else list(df = df, effect_size = lbl, power = pw)
  emit("power.chi_square", sprintf("chisq_df%s_%s_a%s_p%s", df, lbl, alpha * 100, pw * 100), opts, "two_sided", alpha,
       st, es_rec("cohens_w", w), pwr_n)
}
for (n in c(50, 200)) local({
  alpha <- .05; pw <- .80; df <- 3
  f <- function(w) pwr.chisq.test(w = w, N = n, df = df, sig.level = alpha)$power
  w <- root(f, pw, 1e-7, 100)
  st <- sens_stats(w, pw, n, qchisq(alpha, df, lower.tail = FALSE), df, n * w^2)
  emit("power.chi_square", sprintf("chisq_sens_n%s", n), list(categories = 4, mode = "sensitivity", n = n, power = pw),
       "two_sided", alpha, st, es_rec("cohens_w", w), pwr.chisq.test(N = n, df = df, sig.level = alpha, power = pw)$w)
})

# ---- regression (pwr.f2.test; u = tested predictors, v = N - p - 1) ------------------------------
for (pq in list(c(3, 3), c(5, 2), c(1, 1))) for (lbl in names(CONV$f2)) for (alpha in c(.05, .01)) for (pw in c(.80, .95)) {
  if (pq[1] == 1 && alpha == .01) next
  p <- pq[1]; u <- pq[2]; f2 <- CONV$f2[[lbl]]
  f <- function(v) pwr.f2.test(u = u, v = v, f2 = f2, sig.level = alpha)$power
  v_exact <- root(f, pw, 1 + 1e-10, 1e9); v <- ceiling(v_exact)
  pwr_v <- pwr.f2.test(u = u, f2 = f2, sig.level = alpha, power = pw)$v; check_ceiling(pwr_v, v)
  N <- v + p + 1
  st <- apriori_stats(N, v_exact + p + 1, N, f(v), qf(alpha, u, v, lower.tail = FALSE), c(u, v), f2 * (u + v + 1))
  emit("power.regression", sprintf("reg_p%s_q%s_%s_a%s_p%s", p, u, lbl, alpha * 100, pw * 100),
       list(predictors = p, tested_predictors = u, effect_size = lbl, power = pw), "two_sided", alpha, st,
       es_rec("cohens_f2", f2), pwr_v + p + 1)
}
for (pq in list(c(4, 4), c(6, 2))) local({
  p <- pq[1]; u <- pq[2]; N <- 80; v <- N - p - 1; alpha <- .05; pw <- .80
  f <- function(f2) pwr.f2.test(u = u, v = v, f2 = f2, sig.level = alpha)$power
  f2 <- root(f, pw, 1e-7, 100)
  st <- sens_stats(f2, pw, N, qf(alpha, u, v, lower.tail = FALSE), c(u, v), f2 * (u + v + 1))
  emit("power.regression", sprintf("reg_sens_p%s_q%s_N%s", p, u, N), list(predictors = p, tested_predictors = u,
       mode = "sensitivity", n = N, power = pw), "two_sided", alpha, st, es_rec("cohens_f2", f2),
       pwr.f2.test(u = u, v = v, sig.level = alpha, power = pw)$f2)
})

# ---- G*Power 3 printed examples (Faul et al., 2007) ----------------------------------------------
# Printed values are compared at max(1e-3, half a unit of the printed precision), absolute. `hand_r` holds the
# exact values of the same formulas for reference.
write_gpower <- function(case, design, N, f, k, m, rho, eps, printed, decimals, source) {
  alpha <- .05
  p <- rm_parts(design, N, f, k, m, rho, eps)
  pw <- rm_power(design, N, f, k, m, rho, eps, alpha)
  n_case <<- n_case + 1L; WRITTEN <<- c(WRITTEN, case)
  write_fixture(OUT, case, list(
    analysis_id = "power.anova", case = case, dataset = NULL, kind = "gpower",
    request = req(EMPTY, list(design = design, groups = k, measurements = m, correlation = rho, epsilon = eps),
                  alpha = alpha),
    n = N, effect_size = f, printed = printed, printed_decimals = decimals, source = source,
    hand_r = list(power = pw, critical_value = qf(alpha, p$df1, p$df2, lower.tail = FALSE), ncp = p$lambda,
                  df1 = p$df1, df2 = p$df2), expected = NULL, error = NULL))
}
SRC183 <- paste("Faul, F., Erdfelder, E., Lang, A.-G., & Buchner, A. (2007). G*Power 3. Behavior Research Methods,",
                "39(2), 175-191, p. 183 (3 x 3 example of Figure 4, matrix SR1: N = 90, k = 3, m = 3, rho = .3, eps = 1).")
SRC181 <- paste("Faul et al. (2007), Behavior Research Methods, 39(2), p. 181 (Berti et al., 2006 example:",
                "N = 20, k = 2, m = 10, rho = .5, f = 0.25).")
# f as printed in the article (from its variances 5.35679 / 81 and 1.90123 / 81, sigma = 9).
write_gpower("gpower_within_p183", "rm_within", 90, 0.2572, 3, 3, .3, 1,
             list(power = .997, critical_value = 3.048, ncp = 25.52, df1 = 2, df2 = 174),
             list(power = 3, critical_value = 3, ncp = 2, df1 = 0, df2 = 0), SRC183)
write_gpower("gpower_interaction_p183", "mixed_interaction", 90, 0.1532, 3, 3, .3, 1,
             list(power = .653), list(power = 3), SRC183)
write_gpower("gpower_between_p183", "rm_between", 90, 0.1719571, 3, 3, .3, 1,
             list(power = .488), list(power = 3), SRC183)
write_gpower("gpower_between_p181", "rm_between", 20, .25, 2, 10, .5, 1, list(power = .30), list(power = 2), SRC181)
write_gpower("gpower_within_p181", "rm_within", 20, .25, 2, 10, .5, 1, list(power = .95), list(power = 2), SRC181)
write_gpower("gpower_interaction_p181", "mixed_interaction", 20, .25, 2, 10, .5, 1, list(power = .95),
             list(power = 2), SRC181)

stale <- setdiff(sub("\\.json$", "", list.files(file.path(EXPECTED, OUT), "\\.json$")), WRITTEN)
if (length(stale)) invisible(file.remove(file.path(EXPECTED, OUT, paste0(stale, ".json"))))
FIXTURE_PACKAGES <- .old_packages
cat(sprintf("power.R: wrote %d fixtures to %s\n", n_case, file.path(EXPECTED, OUT)))
