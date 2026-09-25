# Reference fixtures for validity.efa and validity.cfa (engine/statly_engine/stats/efa.py, cfa.py,
# factor_utils.py). Self-contained: writes its own seeded datasets (fixtures/expected/data/fac_*.csv),
# then one JSON per case into fixtures/expected/factor/.
# Conventions matched by the engine (psych 2.6.5, GPArotation 2026.8.2, lavaan 0.7.2):
#   * Correlations: pairwise-complete (psych use = "pairwise"); n = rows with at least one answer.
#   * KMO = psych::KMO (overall MSA + per item); Bartlett = psych::cortest.bartlett(R, n).
#   * Parallel analysis = psych::fa.parallel(fa = "fa", fm = "minres", n.iter = 100, SMC = FALSE,
#     sim = TRUE, quant = .95) after set.seed(seed), with options(mc.cores = 1): psych runs the
#     iterations through parallel::mclapply, which forks on 2 cores by default and makes the random
#     stream depend on the fork. Each iteration draws the column resamples (sample(y, n, TRUE)) and then
#     rnorm(n * p); the engine reproduces R's RNG draw for draw. Suggested factors = number of leading
#     observed factor eigenvalues above the 95th percentile of the simulated ones (psych fa.test).
#   * Extraction psych::fa(fm = "minres" | "ml" | "pa"), rotation "oblimin" (GPArotation::oblimin,
#     gam = 0, bb algorithm, eps 1e-5) | "varimax" (stats::varimax, Kaiser-normalized) | "promax"
#     (psych::kaiser(rotate = "Promax"): GPArotation::Varimax + power 4). Factors are then signed so
#     each column sum is positive and sorted by SS loadings (diag(Phi L'L) for oblique), as psych does.
#   * CFA = lavaan::cfa(model, std.lv = FALSE (first-indicator marker), estimator = "ML",
#     missing = "listwise", likelihood "normal" (S divided by N)); expected information SEs.
#     Standardized loadings = standardizedSolution (std.all) with delta-method SE / z / p.
#     Fit: chi2 = 2 N Fmin, CFI, TLI, RMSEA (+ 90% CI), SRMR (lavaan "srmr" = Bentler's).
if (!exists("R_DIR")) source(file.path(dirname(normalizePath(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))), "common.R"))
suppressPackageStartupMessages({ library(psych); library(GPArotation); library(lavaan) })
options(mc.cores = 1)
RNGkind("Mersenne-Twister", "Inversion", "Rejection")

# ---- datasets ---------------------------------------------------------------------------------
likert <- function(z) pmin(5, pmax(1, round(3 + 1.1 * z)))          # 1-5 with many ties
simulate_scale <- function(n, lambda, phi, seed) {
  set.seed(seed)
  k <- ncol(lambda)
  f <- matrix(rnorm(n * k), n, k) %*% chol(phi)
  e <- matrix(rnorm(n * nrow(lambda)), n, nrow(lambda)) %*% diag(sqrt(pmax(1 - rowSums((lambda %*% phi) * lambda), 0.05)))
  x <- f %*% t(lambda) + e; x[] <- likert(x)
  colnames(x) <- paste0("q", seq_len(nrow(lambda)))
  as.data.frame(x)
}
L2 <- cbind(c(.75, .70, .65, .60, .45, 0, 0, 0, 0, 0), c(0, 0, 0, 0, .40, .72, .68, .62, .58, .55))  # q5 cross-loads
P2 <- matrix(c(1, .3, .3, 1), 2)
d2 <- simulate_scale(300, L2, P2, 20260901)
set.seed(20260902)
m <- as.matrix(d2); m[sample(length(m), 60)] <- NA                                                    # 2% missing
m[rowSums(is.na(m)) == ncol(m), 1] <- 3
write_dataset(as.data.frame(m), "fac_2f10_n300.csv")
L3 <- cbind(c(.7, .7, .65, .6, .55, rep(0, 10)), c(rep(0, 5), .75, .7, .6, .6, .5, rep(0, 5)), c(rep(0, 10), .7, .65, .65, .6, .55))
P3 <- matrix(c(1, .3, .2, .3, 1, .4, .2, .4, 1), 3)
write_dataset(simulate_scale(300, L3, P3, 20260903), "fac_3f15_n300.csv")
write_dataset(simulate_scale(60, L2, P2, 20260904), "fac_2f10_n60.csv")

# ---- helpers ----------------------------------------------------------------------------------
empty <- setNames(list(), character(0))
DIR <- "factor"
SEED <- 12345
vec <- function(x) lapply(unname(as.numeric(x)), num)
mat_rows <- function(m) lapply(seq_len(nrow(m)), function(i) vec(m[i, ]))

# ---- EFA ----------------------------------------------------------------------------------------
efa_case <- function(case, dataset, n_factors = NULL, fm = "minres", rotate = "oblimin", iter = 100) {
  d <- load_dataset(dataset)
  keep <- rowSums(!is.na(d)) > 0
  d <- d[keep, ]
  n <- nrow(d)
  r <- stats::cor(d, use = "pairwise")
  kmo <- psych::KMO(r)
  bart <- psych::cortest.bartlett(r, n = n)
  set.seed(SEED)
  invisible(utils::capture.output(pa <- suppressWarnings(suppressMessages(psych::fa.parallel(d, fm = "minres", fa = "fa", n.iter = iter, plot = FALSE)))))
  p <- ncol(d)
  sims <- pa$values[, (3 * p + 1):(4 * p)]                         # simulated normal data, factor eigenvalues
  p95 <- apply(sims, 2, stats::quantile, 0.95)
  stopifnot(max(abs(colMeans(sims) - pa$fa.sim)) < 1e-12)
  suggested <- pa$nfact
  nf <- if (is.null(n_factors)) max(1, suggested) else n_factors
  f <- suppressWarnings(suppressMessages(psych::fa(d, nfactors = nf, fm = fm, rotate = rotate)))
  L <- unclass(f$loadings)
  phi <- if (is.null(f$Phi)) NULL else mat_rows(f$Phi)
  va <- f$Vaccounted
  opts <- list(extraction = fm, rotation = rotate, parallel_iterations = iter, seed = SEED)
  if (!is.null(n_factors)) opts$n_factors <- n_factors
  write_fixture(DIR, case, list(
    analysis_id = "validity.efa", case = case, dataset = dataset,
    request = req(list(items = as.list(names(d))), opts),
    expected = list(
      n_used = n, n_excluded = sum(!keep),
      statistics = list(stat_rec("kmo", kmo$MSA), stat_rec("bartlett_chi2", bart$chisq, bart$df, bart$p.value)),
      kmo_items = vec(kmo$MSAi), eigenvalues = vec(f$e.values), factor_eigenvalues = vec(f$values),
      parallel = list(observed = vec(pa$fa.values), sim_mean = vec(pa$fa.sim), sim_p95 = vec(p95),
                      suggested = suggested),
      n_factors = nf, loadings = mat_rows(L), communalities = vec(f$communality), uniquenesses = vec(f$uniquenesses),
      phi = phi, ss_loadings = vec(va[1, ]), proportion_var = vec(va[2, ])),
    error = NULL))
}
efa_case("efa_2f_minres_oblimin", "fac_2f10_n300.csv", 2)
efa_case("efa_2f_minres_varimax", "fac_2f10_n300.csv", 2, rotate = "varimax")
efa_case("efa_2f_minres_promax", "fac_2f10_n300.csv", 2, rotate = "promax")
efa_case("efa_3f_parallel_oblimin", "fac_3f15_n300.csv")
efa_case("efa_3f_ml_oblimin", "fac_3f15_n300.csv", 3, fm = "ml")
efa_case("efa_3f_pa_varimax", "fac_3f15_n300.csv", 3, fm = "pa", rotate = "varimax")
efa_case("efa_3f_ml_promax", "fac_3f15_n300.csv", 3, fm = "ml", rotate = "promax")
efa_case("efa_2f_n60_parallel", "fac_2f10_n60.csv")
efa_case("efa_2f_n60_one_factor", "fac_2f10_n60.csv", 1)

# ---- CFA ----------------------------------------------------------------------------------------
cfa_case <- function(case, dataset, model) {
  d0 <- load_dataset(dataset)
  items <- unique(unlist(model))
  d <- d0[stats::complete.cases(d0[, items]), items]                  # lavaan missing = "listwise"
  syntax <- paste(sprintf("%s =~ %s", names(model), sapply(model, paste, collapse = " + ")), collapse = "\n")
  fit <- lavaan::cfa(syntax, data = d, std.lv = FALSE, estimator = "ML")
  stopifnot(lavaan::lavInspect(fit, "converged"), lavaan::lavInspect(fit, "nobs") == nrow(d))
  fm <- lavaan::fitMeasures(fit)
  pe <- lavaan::parameterEstimates(fit)
  ss <- lavaan::standardizedSolution(fit)
  row <- function(i) list(est = num(pe$est[i]), se = num(if (pe$se[i] == 0) NA else pe$se[i]),
                          z = num(pe$z[i]), p = num(pe$pvalue[i]), std = num(ss$est.std[i]),
                          std_se = num(ss$se[i]), std_p = num(ss$pvalue[i]))
  lo <- which(pe$op == "=~")
  cv <- which(pe$op == "~~" & pe$lhs %in% names(model) & pe$lhs != pe$rhs)
  rv <- which(pe$op == "~~" & pe$lhs %in% items & pe$lhs == pe$rhs)
  fv <- which(pe$op == "~~" & pe$lhs %in% names(model) & pe$lhs == pe$rhs)
  write_fixture(DIR, case, list(
    analysis_id = "validity.cfa", case = case, dataset = dataset,
    request = req(list(items = as.list(items)), list(model = lapply(model, as.list))),
    expected = list(
      n_used = nrow(d), n_excluded = nrow(d0) - nrow(d),
      statistics = list(stat_rec("chi2", fm["chisq"], fm["df"], fm["pvalue"]), stat_rec("cfi", fm["cfi"]),
                        stat_rec("tli", fm["tli"]), stat_rec("rmsea", fm["rmsea"]),
                        stat_rec("rmsea_ci_lower", fm["rmsea.ci.lower"]), stat_rec("rmsea_ci_upper", fm["rmsea.ci.upper"]),
                        stat_rec("srmr", fm["srmr"])),
      baseline_chi2 = num(fm["baseline.chisq"]), baseline_df = num(fm["baseline.df"]),
      loadings = lapply(lo, function(i) c(list(factor = pe$lhs[i], item = pe$rhs[i]), row(i))),
      factor_covariances = lapply(cv, function(i) c(list(factor_a = pe$lhs[i], factor_b = pe$rhs[i]), row(i))),
      factor_variances = lapply(fv, function(i) c(list(factor = pe$lhs[i]), row(i))),
      residual_variances = lapply(rv, function(i) c(list(item = pe$lhs[i]), row(i)))),
    error = NULL))
}
M2 <- list(F1 = paste0("q", 1:5), F2 = paste0("q", 6:10))
M3 <- list(F1 = paste0("q", 1:5), F2 = paste0("q", 6:10), F3 = paste0("q", 11:15))
cfa_case("cfa_2f_n300_missing", "fac_2f10_n300.csv", M2)
cfa_case("cfa_2f_one_factor_misspecified", "fac_2f10_n300.csv", list(General = paste0("q", 1:10)))
cfa_case("cfa_3f_n300", "fac_3f15_n300.csv", M3)
cfa_case("cfa_3f_misspecified", "fac_3f15_n300.csv", list(F1 = paste0("q", c(1:6)), F2 = paste0("q", 7:10), F3 = paste0("q", 11:15)))
cfa_case("cfa_2f_n60", "fac_2f10_n60.csv", M2)
cfa_case("cfa_1f_n300", "fac_3f15_n300.csv", list(F3 = paste0("q", 11:15)))
