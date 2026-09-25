# Reference fixtures for reliability.* (engine/statly_engine/stats/reliability.py).
# Self-contained: writes its own datasets (fixtures/expected/data/reliability_*.csv) first. The
# 10-item Likert scale and the 20-item knowledge test come from fixtures/practice (see its README):
# Q3_3 / Q3_8 are reverse-scored (6 - x); the raw A-D test answers are scored against answer_key.csv.
# Conventions matched by the engine:
#   * cronbach_alpha: psych::alpha(check.keys = FALSE) defaults: items with no variance are deleted
#     (with a warning), covariances / correlations use pairwise-complete data (use = "pairwise").
#     Raw alpha (headline), standardized alpha, average inter-item r, alpha-if-item-deleted (raw and
#     standardized, k >= 3), corrected item-total r (r.drop), item mean / SD / n. 95% CI: Feldt
#     (psych::alpha.ci, the "feldt" element) with n = number of respondents.
#   * kr20: alpha on 0/1 items (identical to the KR-20 formula; checked below on complete data).
#   * mcdonald_omega: psych::omega(nfactors = 1, fm = "minres"): one-factor minimum-residual fit to the
#     pairwise correlation matrix, items with negative loadings flipped; omega_total =
#     (Vt - sum u²) / Vt and omega_h = (sum lambda)² / Vt with Vt = sum of the (flipped) correlation
#     matrix. psych's "alpha" in omega() is the standardized alpha of the flipped matrix. The engine
#     Heywood cases (a communality >= .995; here the n = 5 set) have no unique psych answer: its
#     L-BFGS-B stops on a line-search failure (tighter optim control does not move it), so those
#     fixtures are flagged heywood = TRUE and compared at 5e-3. The engine
#     refits in-house (least squares on the off-diagonal residuals), so tolerance 1e-4.
#   * split_half: hand computation (psych::splitHalf samples random splits and has no odd/even or
#     first/second split): complete cases; half sums; r between halves; Spearman-Brown 2r / (1 + r);
#     Guttman / Flanagan-Rulon 2 (1 - (var A + var B) / var total). Odd/even (items 1, 3, 5... vs
#     2, 4, 6...) is the headline; first/second = first ceiling(k / 2) items vs the rest.
#   * item_analysis: 0/1 items, complete cases. Difficulty = proportion correct; discrimination =
#     corrected item-total point-biserial (item vs total of the other items) and the upper-lower
#     index D = p(upper) - p(lower), groups = total >= 73rd / <= 27th percentile (quantile type 7,
#     ties included, so a group can exceed 27%). KR-20 of the complete cases alongside.
if (!exists("R_DIR")) source(file.path(dirname(normalizePath(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))), "common.R"))
suppressPackageStartupMessages({ library(psych); library(GPArotation) })

# ---- datasets ---------------------------------------------------------------------------------
PRACTICE <- file.path(REPO, "fixtures", "practice")
read_qualtrics <- function(path) {
  hdr <- names(utils::read.csv(path, nrows = 1, check.names = FALSE))
  d <- utils::read.csv(path, skip = 3, header = FALSE, stringsAsFactors = FALSE, na.strings = c(""))
  names(d) <- hdr
  d
}
lik <- read_qualtrics(file.path(PRACTICE, "one_group_prepost_likert", "pre.csv"))[, paste0("Q3_", 1:10)]
lik$Q3_3 <- 6 - lik$Q3_3; lik$Q3_8 <- 6 - lik$Q3_8
write_dataset(lik, "reliability_likert10.csv")
raw <- lik; raw$Q3_3 <- 6 - raw$Q3_3; raw$Q3_8 <- 6 - raw$Q3_8
write_dataset(raw, "reliability_likert10_unreversed.csv")                   # reverse-worded items left as-is
test <- read_qualtrics(file.path(PRACTICE, "three_groups_prepost_followup", "pre.csv"))
key <- utils::read.csv(file.path(PRACTICE, "three_groups_prepost_followup", "answer_key.csv"), stringsAsFactors = FALSE)
scored <- as.data.frame(sapply(key$item, function(it) as.integer(test[[it]] == key$correct_answer[key$item == it])))
write_dataset(scored, "reliability_test20.csv")

RNGkind("Mersenne-Twister", "Inversion", "Rejection")
set.seed(20260928)
post <- read_qualtrics(file.path(PRACTICE, "one_group_prepost_likert", "post.csv"))[, paste0("Q3_", 1:10)]
post$Q3_3 <- 6 - post$Q3_3; post$Q3_8 <- 6 - post$Q3_8
cells <- sample(length(as.matrix(post)), 25)
m <- as.matrix(post); m[cells] <- NA
write_dataset(as.data.frame(m), "reliability_missing.csv")                  # 25 missing answers
write_dataset(data.frame(i1 = c(2, 4, 3, 5, 1), i2 = c(3, 4, 3, 5, 2), i3 = c(2, 5, 4, 4, 1), i4 = c(1, 3, 3, 5, 2)),
              "reliability_small.csv")                                        # n = 5
lat <- rnorm(30)
zv <- as.data.frame(sapply(1:5, function(j) pmin(5, pmax(1, round(3 + 0.9 * lat + rnorm(30, 0, 0.8))))))
names(zv) <- paste0("item", 1:5); zv$item6 <- 4                              # zero-variance item
write_dataset(zv, "reliability_zero_var.csv")
tm <- scored; tm[as.matrix(data.frame(r = c(3, 10, 40, 77, 90, 121), c = c(2, 5, 5, 11, 18, 20)))] <- NA
write_dataset(tm, "reliability_test20_missing.csv")

# ---- helpers ----------------------------------------------------------------------------------
empty <- setNames(list(), character(0))
items_of <- function(d) as.list(names(d))

alpha_expected <- function(d, head_key) {
  a <- suppressWarnings(psych::alpha(d, check.keys = FALSE, warnings = FALSE))
  kept <- rownames(a$item.stats)
  k <- length(kept)
  n_obs <- nrow(d)
  items <- lapply(seq_len(k), function(i) {
    rec <- list(item = kept[i], n = a$item.stats$n[i], mean = num(a$item.stats$mean[i]), sd = num(a$item.stats$sd[i]),
                r_drop = num(a$item.stats$r.drop[i]))
    if (k >= 3) {
      rec$alpha_if_deleted <- num(a$alpha.drop$raw_alpha[i])
      rec$std_alpha_if_deleted <- num(a$alpha.drop$std.alpha[i])
    }
    rec
  })
  list(n_used = n_obs, n_excluded = 0,
       statistics = list(stat_rec(head_key, a$total$raw_alpha), stat_rec("alpha_standardized", a$total$std.alpha),
                         stat_rec("average_r", a$total$average_r)),
       effect_sizes = list(es_rec(head_key, a$total$raw_alpha, a$feldt$lower.ci, a$feldt$upper.ci)),
       items = items, deleted_items = as.list(setdiff(names(d), kept)))
}

alpha_case <- function(case, dataset, id = "reliability.cronbach_alpha", key = "cronbach_alpha") {
  d <- load_dataset(dataset)
  write_fixture(id, case, list(analysis_id = id, case = case, dataset = dataset,
                               request = req(list(items = items_of(d))), expected = alpha_expected(d, key), error = NULL))
}
alpha_case("likert10", "reliability_likert10.csv")
alpha_case("missing_pairwise", "reliability_missing.csv")
alpha_case("small_n5", "reliability_small.csv")
alpha_case("zero_variance_item", "reliability_zero_var.csv")
alpha_case("test20", "reliability_test20.csv")
alpha_case("unreversed_items", "reliability_likert10_unreversed.csv")

# KR-20 = alpha on 0/1 items; check the textbook formula on complete data.
t20 <- load_dataset("reliability_test20.csv")
k <- ncol(t20); p <- colMeans(t20)
kr20 <- k / (k - 1) * (1 - sum(p * (1 - p)) / (stats::var(rowSums(t20)) * (nrow(t20) - 1) / nrow(t20)))
stopifnot(abs(kr20 - psych::alpha(t20, warnings = FALSE)$total$raw_alpha) < 1e-12)
alpha_case("test20", "reliability_test20.csv", "reliability.kr20", "kr20")
alpha_case("test20_missing", "reliability_test20_missing.csv", "reliability.kr20", "kr20")

# ---- omega ------------------------------------------------------------------------------------
omega_case <- function(case, dataset) {
  d <- load_dataset(dataset)
  o <- suppressWarnings(suppressMessages(psych::omega(d, nfactors = 1, fm = "minres", plot = FALSE)))
  load <- o$schmid$sl[, 1]
  write_fixture("reliability.mcdonald_omega", case, list(
    analysis_id = "reliability.mcdonald_omega", case = case, dataset = dataset,
    request = req(list(items = items_of(d))),
    expected = list(n_used = nrow(d), n_excluded = 0,
                    statistics = list(stat_rec("omega_total", o$omega.tot), stat_rec("omega_h", o$omega_h),
                                      stat_rec("alpha_standardized", o$alpha)),
                    loadings = lapply(seq_along(load), function(i) list(item = names(d)[i], loading = num(load[i]))),
                    flipped = as.list(names(d)[o$key < 0]),
                    heywood = any(o$schmid$sl[, "h2"] >= 0.995)),
    error = NULL))
}
omega_case("likert10", "reliability_likert10.csv")
omega_case("missing_pairwise", "reliability_missing.csv")
omega_case("test20", "reliability_test20.csv")
omega_case("small_n5", "reliability_small.csv")
omega_case("unreversed_items_flipped", "reliability_likert10_unreversed.csv")

# ---- split-half ---------------------------------------------------------------------------------
split_stats <- function(cc, a_idx, b_idx, tag) {
  A <- rowSums(cc[, a_idx, drop = FALSE]); B <- rowSums(cc[, b_idx, drop = FALSE]); X <- A + B
  r <- stats::cor(A, B)
  list(stat_rec(paste0("spearman_brown_", tag), 2 * r / (1 + r)),
       stat_rec(paste0("guttman_", tag), 2 * (1 - (stats::var(A) + stats::var(B)) / stats::var(X))),
       stat_rec(paste0("r_halves_", tag), r))
}
split_case <- function(case, dataset, split = "odd_even") {
  d <- load_dataset(dataset)
  cc <- d[stats::complete.cases(d), ]
  k <- ncol(d)
  oe <- split_stats(cc, seq(1, k, 2), seq(2, k, 2), "odd_even")
  h <- ceiling(k / 2)
  fs <- split_stats(cc, 1:h, (h + 1):k, "first_second")
  st <- if (split == "odd_even") c(oe, fs) else c(fs, oe)
  write_fixture("reliability.split_half", case, list(
    analysis_id = "reliability.split_half", case = case, dataset = dataset,
    request = req(list(items = items_of(d)), list(split = split)),
    expected = list(n_used = nrow(cc), n_excluded = nrow(d) - nrow(cc), statistics = st),
    error = NULL))
}
split_case("likert10", "reliability_likert10.csv")
split_case("likert10_first_second", "reliability_likert10.csv", "first_second")
split_case("missing_complete_cases", "reliability_missing.csv")
split_case("test20", "reliability_test20.csv")
split_case("small_n5_odd_items", "reliability_small.csv")

# ---- item analysis ------------------------------------------------------------------------------
item_case <- function(case, dataset) {
  d <- load_dataset(dataset)
  cc <- d[stats::complete.cases(d), ]
  total <- rowSums(cc)
  up <- total >= stats::quantile(total, 0.73, type = 7)
  lo <- total <= stats::quantile(total, 0.27, type = 7)
  k <- ncol(cc); p <- colMeans(cc)
  kr <- k / (k - 1) * (1 - sum(apply(cc, 2, stats::var)) / stats::var(total))
  items <- lapply(names(cc), function(it) {
    rest <- total - cc[[it]]
    rpb <- if (stats::sd(cc[[it]]) > 0) stats::cor(cc[[it]], rest) else NA
    list(item = it, difficulty = num(mean(cc[[it]])), r_pb_corrected = num(rpb),
         d_index = num(mean(cc[[it]][up]) - mean(cc[[it]][lo])))
  })
  write_fixture("reliability.item_analysis", case, list(
    analysis_id = "reliability.item_analysis", case = case, dataset = dataset,
    request = req(list(items = items_of(d))),
    expected = list(n_used = nrow(cc), n_excluded = nrow(d) - nrow(cc),
                    statistics = list(stat_rec("kr20", kr), stat_rec("mean_difficulty", mean(p))),
                    n_upper = sum(up), n_lower = sum(lo), items = items),
    error = NULL))
}
item_case("test20", "reliability_test20.csv")
item_case("test20_missing", "reliability_test20_missing.csv")
