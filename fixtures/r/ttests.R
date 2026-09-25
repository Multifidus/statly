# Reference fixtures for t_test.one_sample / t_test.independent / t_test.paired.
# Conventions matched by engine/statly_engine/stats/ttests.py:
#   * Two-sample direction is R's x - y with x = first level / first measure listed.
#   * Welch (var.equal = FALSE) and Student (var.equal = TRUE) t are both recorded.
#   * effectsize::cohens_d / hedges_g with pooled_sd = TRUE (noncentral-t CI);
#     glass_delta with adjust = FALSE (classical Glass's delta, SD of the second/reference group);
#     paired d_z = cohens_d(paired = TRUE) (noncentral-t CI);
#     paired d_av = repeated_measures_d(method = "av", adjust = FALSE) (normal-approximation CI);
#     r = t_to_r(t, df) of the headline test.
if (!exists("R_DIR")) source(file.path(dirname(normalizePath(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))), "common.R"))
suppressPackageStartupMessages({ library(effectsize); library(car); library(psych) })

t_rec <- function(key, tt) stat_rec(key, tt$statistic, tt$parameter, tt$p.value)

error_fixture <- function(dir, case, analysis_id, dataset, request, expr) {
  msg <- tryCatch({ force(expr); NA_character_ }, error = function(e) conditionMessage(e))
  stopifnot(!is.na(msg))
  write_fixture(dir, case, list(analysis_id = analysis_id, case = case, dataset = dataset,
                                request = request, expected = NULL, error = msg))
}

# ---- one sample -------------------------------------------------------------
one_sample_case <- function(case, dataset, mu, tails = "two_sided", ci = 0.95) {
  d <- load_dataset(dataset)
  x_all <- d$y
  x <- x_all[!is.na(x_all)]
  alt <- r_alternative(tails)
  request <- req(list(outcome = list("y")), list(test_value = mu), tails, ci)
  if (stats::sd(x) == 0) {
    return(error_fixture("t_test.one_sample", case, "t_test.one_sample", dataset, request,
                         stats::t.test(x, mu = mu)))
  }
  tt <- stats::t.test(x, mu = mu, alternative = alt, conf.level = ci)
  cd <- cohens_d(x, mu = mu, ci = ci, alternative = alt, verbose = FALSE)
  hg <- hedges_g(x, mu = mu, ci = ci, alternative = alt, verbose = FALSE)
  n <- length(x)
  write_fixture("t_test.one_sample", case, list(
    analysis_id = "t_test.one_sample", case = case, dataset = dataset, request = request,
    expected = list(
      n_used = length(x), n_excluded = sum(is.na(x_all)),
      statistics = list(t_rec("t", tt)),
      effect_sizes = list(
        es_rec_nct("cohens_d", cd$Cohens_d, cd, tt$statistic, n - 1, 1 / n, ci, alt),
        es_rec_nct("hedges_g", hg$Hedges_g, hg, tt$statistic, n - 1, 1 / n, ci, alt, adjust = TRUE),
        es_rec("mean_difference", mean(x) - mu, tt$conf.int[1] - mu, tt$conf.int[2] - mu)),
      descriptives = list(desc_rec("y", setNames(list(), character(0)), x_all, ci)),
      assumptions = list(shapiro_rec(x, "overall"))),
    error = NULL))
}

one_sample_case("basic", "one_sample.csv", 3)
one_sample_case("greater", "one_sample.csv", 3, tails = "greater")
one_sample_case("ci90", "one_sample.csv", 3.5, ci = 0.90)
one_sample_case("large_skewed", "large_skewed.csv", 1)
one_sample_case("small_n", "one_sample_small.csv", 2.5)
one_sample_case("ties", "indep_ties.csv", 3)
one_sample_case("constant", "constant.csv", 3)

# ---- independent samples ------------------------------------------------------
independent_case <- function(case, dataset, variant = "welch", tails = "two_sided", ci = 0.95) {
  d <- load_dataset(dataset)
  alt <- r_alternative(tails)
  request <- req(list(outcome = list("y"), group = list("group")), list(variant = variant), tails, ci)
  keep_g <- !is.na(d$group)
  levels_ <- sort(unique(d$group[keep_g]))
  if (length(levels_) != 2) {
    return(error_fixture("t_test.independent", case, "t_test.independent", dataset, request,
                         stats::t.test(y ~ group, data = d)))
  }
  xa <- d$y[keep_g & d$group == levels_[1]]
  ya <- d$y[keep_g & d$group == levels_[2]]
  x <- xa[!is.na(xa)]; y <- ya[!is.na(ya)]
  welch <- stats::t.test(x, y, var.equal = FALSE, alternative = alt, conf.level = ci)
  student <- stats::t.test(x, y, var.equal = TRUE, alternative = alt, conf.level = ci)
  head <- if (variant == "welch") welch else student
  stats_list <- if (variant == "welch") list(t_rec("welch_t", welch), t_rec("student_t", student))
                else list(t_rec("student_t", student), t_rec("welch_t", welch))
  cd <- cohens_d(x, y, pooled_sd = TRUE, paired = FALSE, ci = ci, alternative = alt, verbose = FALSE)
  hg <- hedges_g(x, y, pooled_sd = TRUE, paired = FALSE, ci = ci, alternative = alt, verbose = FALSE)
  gd <- glass_delta(x, y, adjust = FALSE, ci = ci, alternative = alt, verbose = FALSE)
  n1 <- length(x); n2 <- length(y)
  hn_g <- 1 / n2 + var(x) / (n1 * var(y))
  g1 <- setNames(list(levels_[1]), "group"); g2 <- setNames(list(levels_[2]), "group")
  write_fixture("t_test.independent", case, list(
    analysis_id = "t_test.independent", case = case, dataset = dataset, request = request,
    expected = list(
      n_used = length(x) + length(y), n_excluded = nrow(d) - length(x) - length(y),
      statistics = stats_list,
      effect_sizes = list(
        es_rec_nct("hedges_g", hg$Hedges_g, hg, student$statistic, n1 + n2 - 2, 1 / n1 + 1 / n2, ci, alt,
                   adjust = TRUE),
        es_rec_nct("cohens_d", cd$Cohens_d, cd, student$statistic, n1 + n2 - 2, 1 / n1 + 1 / n2, ci, alt),
        es_rec_nct("glass_delta", gd$Glass_delta, gd, (mean(x) - mean(y)) / (sd(y) * sqrt(hn_g)), n2 - 1,
                   hn_g, ci, alt),
        es_rec_r(head$statistic, head$parameter, ci, alt),
        es_rec("mean_difference", mean(x) - mean(y), head$conf.int[1], head$conf.int[2])),
      descriptives = list(desc_rec("y", g1, xa, ci), desc_rec("y", g2, ya, ci)),
      assumptions = list(shapiro_rec(x, levels_[1]), shapiro_rec(y, levels_[2]),
                         levene_rec(d$y, d$group))),
    error = NULL))
}

independent_case("basic", "indep_basic.csv")
independent_case("basic_student", "indep_basic.csv", variant = "student")
independent_case("unequal", "indep_unequal.csv")
independent_case("unequal_student", "indep_unequal.csv", variant = "student")
independent_case("small_n", "indep_small.csv")
independent_case("ties", "indep_ties.csv")
independent_case("missing", "indep_missing.csv")
independent_case("constant_group", "indep_constant_group.csv")
independent_case("less", "indep_basic.csv", tails = "less")
independent_case("single_group", "indep_single_group.csv")

# ---- paired -------------------------------------------------------------------
paired_expected <- function(x, y, x_name, y_name, g1, g2, n_miss, tails, ci, n_excluded, x_var, y_var) {
  alt <- r_alternative(tails)
  tt <- stats::t.test(x, y, paired = TRUE, alternative = alt, conf.level = ci)
  dz <- cohens_d(x, y, paired = TRUE, ci = ci, alternative = alt, verbose = FALSE)
  dav <- repeated_measures_d(x, y, method = "av", adjust = FALSE, ci = ci, alternative = alt,
                             verbose = FALSE)
  list(
    n_used = length(x), n_excluded = n_excluded,
    statistics = list(t_rec("t", tt)),
    effect_sizes = list(
      es_rec("d_av", dav$d_av, dav$CI_low, dav$CI_high),
      es_rec_nct("d_z", dz$Cohens_d, dz, tt$statistic, length(x) - 1, 1 / length(x), ci, alt),
      es_rec("mean_difference", mean(x - y), tt$conf.int[1], tt$conf.int[2])),
    descriptives = list(desc_rec(x_var, g1, x, ci, n_miss[1]), desc_rec(y_var, g2, y, ci, n_miss[2])),
    assumptions = list(shapiro_rec(x - y, "differences")))
}

paired_wide_case <- function(case, dataset, tails = "two_sided", ci = 0.95) {
  d <- load_dataset(dataset)
  cc <- stats::complete.cases(d$pre, d$post)
  request <- req(list(measures = list("pre", "post")), setNames(list(), character(0)), tails, ci)
  empty <- setNames(list(), character(0))
  write_fixture("t_test.paired", case, list(
    analysis_id = "t_test.paired", case = case, dataset = dataset, request = request,
    expected = paired_expected(d$pre[cc], d$post[cc], "pre", "post", empty, empty,
                               c(sum(is.na(d$pre)), sum(is.na(d$post))), tails, ci,
                               sum(!cc), "pre", "post"),
    error = NULL))
}

paired_wide_case("basic", "paired_basic.csv")
paired_wide_case("small_n", "paired_small.csv")
paired_wide_case("missing", "paired_missing.csv")
paired_wide_case("greater", "paired_basic.csv", tails = "greater")

# Long layout: ids present once at each of the two levels are paired; ids with duplicate rows at a
# level, or missing a level, are excluded (engine rule, SPEC §5.4/§5.5).
local({
  dataset <- "paired_long.csv"
  d <- load_dataset(dataset)
  lv <- c("Pre", "Post")
  cnt <- table(factor(d$id), factor(d$time, levels = lv))
  ok_ids <- as.numeric(rownames(cnt)[cnt[, "Pre"] == 1 & cnt[, "Post"] == 1])
  pre <- d[d$time == "Pre" & d$id %in% ok_ids, ]; pre <- pre[order(pre$id), ]
  post <- d[d$time == "Post" & d$id %in% ok_ids, ]; post <- post[order(post$id), ]
  stopifnot(identical(pre$id, post$id))
  cc <- stats::complete.cases(pre$score, post$score)
  request <- req(list(outcome = list("score"), time = list("time"), subject_id = list("id")),
                 list(levels = list("Pre", "Post")))
  write_fixture("t_test.paired", "long", list(
    analysis_id = "t_test.paired", case = "long", dataset = dataset, request = request,
    expected = paired_expected(pre$score[cc], post$score[cc], "Pre", "Post",
                               list(time = "Pre"), list(time = "Post"),
                               c(sum(is.na(d$score[d$time == "Pre"])), sum(is.na(d$score[d$time == "Post"]))),
                               "two_sided", 0.95, nrow(d) - 2 * sum(cc), "score", "score"),
    error = NULL))
})

cat("t-test fixtures written\n")
