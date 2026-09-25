# Reference fixtures for rater agreement (engine/statly_engine/stats/agreement.py) and the
# education family (stats/education.py). Self-contained: writes its own seeded agr_*.csv first.
# Run: Rscript fixtures/r/agreement_education.R   (dev only; needs psych, irr, effectsize, boot)
#
# R functions matched:
#   reliability.icc: psych::ICC(lmer = FALSE, alpha = 1 - ci) on complete cases (the classical
#     two-way ANOVA mean squares, as SPSS; psych's default lmer = TRUE gives REML variance components,
#     which differ when a variance component estimate is negative). All six Shrout-Fleiss forms with
#     psych's F, df, p and CIs; F_raters = rater mean square / residual mean square.
#   reliability.cohen_kappa: psych::cohen.kappa (kappa, weighted kappa with w.exp = 1 linear and 2
#     quadratic, CI = estimate +/- z sqrt(var), clipped to [-1, 1]); z and p from irr::kappa2 with
#     weight "unweighted" / "equal" / "squared" (null-hypothesis SE). Complete pairs; categories =
#     those used by either rater (sorted).
#   reliability.fleiss_kappa: irr::kappam.fleiss (complete cases) kappa, z, p; per-category kappas
#     recomputed unrounded with irr's detail = TRUE formulas. CI = kappa +/- z SE (irr's SE, as
#     DescTools::KappaM "Fleiss"), clipped to [-1, 1] as psych does for Cohen's kappa.
#   reliability.kendall_w: irr::kendall(correct = TRUE) (tie-corrected W, chi-square on n - 1 df);
#     CI = boot::boot resampling subjects (rows; raters fixed), R = 2000, set.seed(12345), boot.ci
#     "perc" two-sided (all replicates equal, e.g. perfect agreement -> [W, W]). effectsize's
#     kendalls_w CI resamples blocks (= raters here), which with 3-5 raters pins the lower bound at W.
#   education.gain_score: gain = post - pre per person; t.test(post, pre, paired = TRUE); d_av =
#     repeated_measures_d(post, pre, method = "av", adjust = FALSE), d_z = cohens_d(paired = TRUE)
#     with the exact noncentral-t CI. Grouped (wide + group): per-group paired t, gains compared with
#     Welch's t (2 groups, + Hedges' g of the gains) or Welch's F (oneway.test, 3+ groups).
#   education.normalized_gain: Hake's class-average g = (mean post - mean pre) / (max - mean pre);
#     average individual g (people with pre = max excluded); Marx & Cummings (2007) normalized change c
#     (post < pre: (post - pre) / pre; post = pre: 0; pre = post = max or 0 excluded). CIs: boot::boot
#     ordinary resampling of people, R = 2000, set.seed(12345) before each boot (per group), boot.ci
#     type "perc".
if (!exists("R_DIR")) source(file.path(dirname(normalizePath(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))), "common.R"))
suppressPackageStartupMessages({ library(psych); library(irr); library(effectsize); library(boot) })
RNGkind("Mersenne-Twister", "Inversion", "Rejection")

DIR <- "agreement_education"
BOOT_SEED <- 12345
KW_ITER <- 2000
NG_ITER <- 2000
USED <- function() {
  pk <- c("stats", "psych", "irr", "effectsize", "boot", "jsonlite")
  setNames(lapply(pk, function(p) as.character(utils::packageVersion(p))), pk)
}
empty <- setNames(list(), character(0))
fixture <- function(id, case, dataset, request, expected, conventions, meta = NULL, error = NULL) {
  fx <- list(analysis_id = id, case = case, dataset = dataset, request = request, expected = expected,
             error = error, r_packages_used = USED(), conventions = conventions)
  if (!is.null(meta)) fx$meta <- meta
  write_fixture(DIR, paste0(id, "__", case), fx)
}

# ---- datasets ---------------------------------------------------------------------------------
local({
  set.seed(20260930)
  noisy <- function(t, p, k) ifelse(runif(length(t)) < p, t, sample(1:k, length(t), TRUE))
  truth <- sample(1:3, 40, TRUE, prob = c(.3, .4, .3))
  r1 <- noisy(truth, .75, 3); r2 <- noisy(truth, .7, 3)
  r1[c(4, 17)] <- NA; r2[9] <- NA
  write_dataset(data.frame(subject = 1:40, rater1 = r1, rater2 = r2), "agr_two3.csv")
  t5 <- sample(1:5, 30, TRUE)
  m <- sapply(1:4, function(j) pmin(5, pmax(1, t5 + sample(c(-1, 0, 0, 0, 1), 30, TRUE))))
  m[cbind(c(3, 12, 25), c(2, 4, 1))] <- NA
  write_dataset(data.frame(subject = 1:30, r1 = m[, 1], r2 = m[, 2], r3 = m[, 3], r4 = m[, 4]), "agr_four5.csv")
  p <- sample(1:3, 12, TRUE)
  write_dataset(data.frame(subject = 1:12, a = p, b = p, c = p), "agr_perfect.csv")
  write_dataset(data.frame(subject = 1:50, a = sample(1:4, 50, TRUE), b = sample(1:4, 50, TRUE),
                           c = sample(1:4, 50, TRUE)), "agr_chance.csv")
  write_dataset(data.frame(judge1 = c(9, 6, 8, 7, 10, 6), judge2 = c(2, 1, 4, 1, 5, 2),
                           judge3 = c(5, 3, 6, 2, 6, 4), judge4 = c(8, 2, 8, 6, 9, 7)), "agr_shrout_fleiss.csv")
  tr <- rnorm(25, 70, 10)
  sc <- sapply(c(0, 2, -1), function(bias) round(tr + bias + rnorm(25, 0, 4), 1))
  sc[7, 2] <- NA; sc[19, 3] <- NA
  write_dataset(data.frame(student = 1:25, rater_a = sc[, 1], rater_b = sc[, 2], rater_c = sc[, 3]),
                "agr_icc_scores.csv")
  q <- rnorm(8)
  rk <- sapply(1:5, function(j) rank(q + rnorm(8, 0, .8)))
  write_dataset(data.frame(essay = 1:8, judge1 = rk[, 1], judge2 = rk[, 2], judge3 = rk[, 3], judge4 = rk[, 4],
                           judge5 = rk[, 5]), "agr_rankings.csv")
  write_dataset(data.frame(subject = 1:8, rater1 = rep(2, 8), rater2 = c(rep(2, 7), NA)), "agr_one_category.csv")

  # linked pre/post practice data -> long layout (raw, unnormalised IDs)
  rq <- function(path) {
    hdr <- names(utils::read.csv(path, nrows = 1, check.names = FALSE))
    d <- utils::read.csv(path, skip = 3, header = FALSE, stringsAsFactors = FALSE, na.strings = c(""))
    names(d) <- hdr
    d
  }
  pr <- rq(file.path(REPO, "fixtures", "practice", "linked_id_prepost", "pre.csv"))
  po <- rq(file.path(REPO, "fixtures", "practice", "linked_id_prepost", "post.csv"))
  write_dataset(data.frame(id = c(pr$Q1, po$Q1), time = rep(c("pre", "post"), c(nrow(pr), nrow(po))),
                           score = c(pr$Q4, po$Q4), stringsAsFactors = FALSE), "agr_gain_linked_long.csv")
  write_dataset(data.frame(id = 1:12, pre = c(2, 4, 5, 10, 10, 6, 3, 7, 8, 1, 5, 9),
                           post = c(6, 8, 5, 10, 9, 9, 7, 6, 10, 4, NA, 10)), "agr_gain_hand.csv")
  pre <- pmin(20, pmax(0, round(rnorm(26, 9, 3)))); gain <- round(rnorm(26, rep(c(3, 5), c(14, 12)), 2.5))
  d2 <- data.frame(id = 1:26, group = rep(c("A", "B"), c(14, 12)), pre = pre, post = pmin(20, pmax(0, pre + gain)),
                   stringsAsFactors = FALSE)
  d2$pre[5] <- NA; d2$group[20] <- NA
  write_dataset(d2, "agr_gain_groups2.csv")
  n3 <- c(10, 11, 9)
  pre <- pmin(20, pmax(0, round(rnorm(30, 8, 3)))); gain <- round(rnorm(30, rep(c(2, 4, 7), n3), 2.5))
  d3 <- data.frame(id = 1:30, group = rep(c("Control", "Online", "Tutoring"), n3), pre = pre,
                   post = pmin(20, pmax(0, pre + gain)), stringsAsFactors = FALSE)
  d3$post[c(4, 22)] <- NA
  write_dataset(d3, "agr_gain_groups3.csv")
})

# ---- ICC --------------------------------------------------------------------------------------
ICC_KEYS <- c(ICC1 = "icc1", ICC2 = "icc2", ICC3 = "icc3", ICC1k = "icc1k", ICC2k = "icc2k", ICC3k = "icc3k")
raters_of <- function(d, cols) list(raters = as.list(cols))
icc_case <- function(case, dataset, cols, form = NULL, ci = 0.95) {
  d <- load_dataset(dataset)[, cols]
  cc <- stats::complete.cases(d)
  x <- d[cc, ]
  r <- psych::ICC(x, lmer = FALSE, alpha = 1 - ci)
  res <- r$results
  form <- if (is.null(form)) "ICC2" else form
  order <- c(form, setdiff(names(ICC_KEYS), form))
  effects <- lapply(order, function(f) {
    row <- res[res$type == f, ]
    es_rec(ICC_KEYS[[f]], row$ICC, row[["lower bound"]], row[["upper bound"]])
  })
  one <- res[res$type == "ICC1", ]; two <- res[res$type == "ICC2", ]
  st <- r$stats
  s_one <- stat_rec("F_one_way", one$F, c(one$df1, one$df2), one$p)
  s_two <- stat_rec("F_two_way", two$F, c(two$df1, two$df2), two$p)
  s_rat <- stat_rec("F_raters", st["F", "Judges"], c(st["df", "Judges"], st["df", "Residual"]), st["p", "Judges"])
  stats <- if (form %in% c("ICC1", "ICC1k")) list(s_one, s_two, s_rat) else list(s_two, s_one, s_rat)
  opts <- if (case == "default" || form == "ICC2") empty else list(form = form)
  fixture("reliability.icc", case, dataset, req(raters_of(d, cols), opts, "two_sided", ci),
          list(n_used = sum(cc), n_excluded = sum(!cc), statistics = stats, effect_sizes = effects,
               descriptives = lapply(cols, function(v) desc_rec(v, empty, x[[v]], ci, 0))),
          "psych::ICC(lmer = FALSE) on complete cases; headline = options.form (default ICC2)")
}
icc_case("shrout_fleiss", "agr_shrout_fleiss.csv", paste0("judge", 1:4))
icc_case("shrout_fleiss_icc3k", "agr_shrout_fleiss.csv", paste0("judge", 1:4), form = "ICC3k")
icc_case("scores_missing", "agr_icc_scores.csv", c("rater_a", "rater_b", "rater_c"))
icc_case("ordinal_four_icc1", "agr_four5.csv", paste0("r", 1:4), form = "ICC1")
icc_case("chance", "agr_chance.csv", c("a", "b", "c"), ci = 0.90)

# ---- Cohen's kappa ----------------------------------------------------------------------------
W_KEYS <- c(unweighted = "kappa", linear = "kappa_linear", quadratic = "kappa_quadratic")
Z_KEYS <- c(unweighted = "z_unweighted", linear = "z_linear", quadratic = "z_quadratic")
IRR_W <- c(unweighted = "unweighted", linear = "equal", quadratic = "squared")
cohen_case <- function(case, dataset, cols, weights = "unweighted", ci = 0.95) {
  d <- load_dataset(dataset)[, cols]
  cc <- stats::complete.cases(d)
  x <- d[cc, ]
  request <- req(list(raters = as.list(cols)), if (weights == "unweighted") empty else list(weights = weights),
                 "two_sided", ci)
  if (length(unique(c(x[[1]], x[[2]]))) < 2) {
    fixture("reliability.cohen_kappa", case, dataset, request, NULL, "psych::cohen.kappa", error =
              "Your data seem to have no variance and in complete agreement across raters (psych: kappa NA)")
    return(invisible())
  }
  lin <- suppressWarnings(psych::cohen.kappa(x, alpha = 1 - ci, w.exp = 1))
  quad <- suppressWarnings(psych::cohen.kappa(x, alpha = 1 - ci, w.exp = 2))
  est <- list(unweighted = lin$confid[1, ], linear = lin$confid[2, ], quadratic = quad$confid[2, ])
  z <- lapply(IRR_W, function(w) irr::kappa2(x, weight = w))
  stopifnot(abs(z$unweighted$value - lin$kappa) < 1e-12, abs(z$linear$value - lin$weighted.kappa) < 1e-12,
            abs(z$quadratic$value - quad$weighted.kappa) < 1e-12)
  order <- c(weights, setdiff(names(W_KEYS), weights))
  fixture("reliability.cohen_kappa", case, dataset, request,
          list(n_used = sum(cc), n_excluded = sum(!cc),
               statistics = lapply(order, function(w) stat_rec(Z_KEYS[[w]], z[[w]]$statistic, numeric(0), z[[w]]$p.value)),
               effect_sizes = lapply(order, function(w) es_rec(W_KEYS[[w]], est[[w]][["estimate"]], est[[w]][["lower"]],
                                                                est[[w]][["upper"]])),
               observed_agreement = num(sum(diag(table(factor(x[[1]], levels = sort(unique(c(x[[1]], x[[2]])))),
                                                     factor(x[[2]], levels = sort(unique(c(x[[1]], x[[2]]))))))) / nrow(x))),
          "psych::cohen.kappa (CI) + irr::kappa2 (z, p); complete pairs; observed categories")
}
cohen_case("two3", "agr_two3.csv", c("rater1", "rater2"))
cohen_case("two3_quadratic", "agr_two3.csv", c("rater1", "rater2"), weights = "quadratic")
cohen_case("five_linear", "agr_four5.csv", c("r1", "r2"), weights = "linear")
cohen_case("perfect", "agr_perfect.csv", c("a", "b"))
cohen_case("chance", "agr_chance.csv", c("a", "b"), ci = 0.99)
cohen_case("one_category", "agr_one_category.csv", c("rater1", "rater2"))

# ---- Fleiss' kappa ----------------------------------------------------------------------------
fleiss_case <- function(case, dataset, cols, ci = 0.95) {
  d <- load_dataset(dataset)[, cols]
  cc <- stats::complete.cases(d)
  x <- d[cc, ]
  fk <- irr::kappam.fleiss(x)
  ns <- nrow(x); nr <- ncol(x)
  lev <- sort(unique(unlist(x)))
  ttab <- t(apply(x, 1, function(r) table(factor(r, levels = lev))))
  pj <- colSums(ttab) / (ns * nr)
  pjk <- (colSums(ttab^2) - ns * nr * pj) / (ns * nr * (nr - 1) * pj)
  kK <- (pjk - pj) / (1 - pj)
  seK <- sqrt(2 / (ns * nr * (nr - 1)))
  qj <- 1 - pj
  se <- sqrt((2 / (sum(pj * qj)^2 * (ns * nr * (nr - 1)))) * (sum(pj * qj)^2 - sum(pj * qj * (qj - pj))))
  stopifnot(abs(se - fk$value / fk$statistic) < 1e-10 || fk$value == 0)
  z <- stats::qnorm(1 - (1 - ci) / 2)
  det <- irr::kappam.fleiss(x, detail = TRUE)$detail
  stopifnot(all(abs(round(kK, 3) - det[, "Kappa"]) < 1e-9))
  cat_stats <- lapply(seq_along(lev), function(j) stat_rec("z", kK[j] / seK, numeric(0),
                                                          2 * (1 - stats::pnorm(abs(kK[j] / seK))), term = as.character(lev[j])))
  clip <- function(v) pmin(1, pmax(-1, v))
  cat_es <- lapply(seq_along(lev), function(j) c(es_rec("category_kappa", kK[j], clip(kK[j] - z * seK), clip(kK[j] + z * seK)),
                                                list(term = as.character(lev[j]))))
  fixture("reliability.fleiss_kappa", case, dataset, req(list(raters = as.list(cols)), empty, "two_sided", ci),
          list(n_used = ns, n_excluded = sum(!cc),
               statistics = c(list(stat_rec("z", fk$statistic, numeric(0), fk$p.value)), cat_stats),
               effect_sizes = list(es_rec("fleiss_kappa", fk$value, clip(fk$value - z * se), clip(fk$value + z * se))),
               category_effects = cat_es),
          "irr::kappam.fleiss (complete cases); CI = kappa +/- z SE; per-category kappas unrounded")
}
fleiss_case("two3", "agr_two3.csv", c("rater1", "rater2"))
fleiss_case("four5", "agr_four5.csv", paste0("r", 1:4))
fleiss_case("perfect", "agr_perfect.csv", c("a", "b", "c"))
fleiss_case("chance", "agr_chance.csv", c("a", "b", "c"))

# ---- Kendall's W (agreement) ------------------------------------------------------------------
kendall_case <- function(case, dataset, cols, ci = 0.95) {
  d <- load_dataset(dataset)[, cols]
  cc <- stats::complete.cases(d)
  x <- as.matrix(d[cc, ])
  kw <- irr::kendall(x, correct = TRUE)
  set.seed(BOOT_SEED)
  bt <- boot::boot(x, function(m, i) irr::kendall(m[i, ], correct = TRUE)$value, R = KW_ITER)
  b <- if (diff(range(bt$t[, 1])) < 1e-12) rep(kw$value, 2) else boot::boot.ci(bt, conf = ci, type = "perc")$percent[4:5]
  fixture("reliability.kendall_w", case, dataset, req(list(raters = as.list(cols)), empty, "two_sided", ci),
          list(n_used = nrow(x), n_excluded = sum(!cc),
               statistics = list(stat_rec("chi_sq", kw$statistic, nrow(x) - 1, kw$p.value)),
               effect_sizes = list(es_rec("kendall_w", kw$value, b[1], b[2])),
               bootstrap = list(seed = BOOT_SEED, iterations = KW_ITER)),
          "irr::kendall(correct = TRUE); CI = boot::boot over subjects (rows), R = 2000, perc")
}
kendall_case("rankings", "agr_rankings.csv", paste0("judge", 1:5))
kendall_case("four5_ties", "agr_four5.csv", paste0("r", 1:4))
kendall_case("perfect", "agr_perfect.csv", c("a", "b", "c"))
kendall_case("chance", "agr_chance.csv", c("a", "b", "c"))

# ---- gain data --------------------------------------------------------------------------------
LINK_META <- list(variables = list(), link = list(mode = "linked", id_variable = "id",
                                                  normalization = list(trim_whitespace = TRUE, case_insensitive = TRUE)))
# Pairs as stats/ttests.py _paired_long builds them: normalised IDs, IDs duplicated at a time point
# dropped, complete scores, sorted by ID (C collation).
linked_pairs <- function() {
  d <- load_dataset("agr_gain_linked_long.csv")
  d$nid <- toupper(trimws(d$id))
  d$nid[d$nid == ""] <- NA
  inl <- d$time %in% c("pre", "post")
  f <- d[inl & !is.na(d$nid), ]
  ids <- sort(unique(f$nid), method = "radix")
  cnt <- sapply(c("pre", "post"), function(l) sapply(ids, function(i) sum(f$nid == i & f$time == l)))
  ok <- ids[cnt[, "pre"] == 1 & cnt[, "post"] == 1]
  pre <- sapply(ok, function(i) f$score[f$nid == i & f$time == "pre"])
  post <- sapply(ok, function(i) f$score[f$nid == i & f$time == "post"])
  cc <- !is.na(pre) & !is.na(post)
  list(pre = unname(pre[cc]), post = unname(post[cc]), n_excluded = sum(inl) - 2 * sum(cc),
       n_miss = c(sum(is.na(d$score[d$time == "pre"])), sum(is.na(d$score[d$time == "post"]))),
       vars = list(outcome = list("score"), time = list("time"), subject_id = list("id")),
       opts = list(levels = list("pre", "post")), long = TRUE)
}
wide_pairs <- function(dataset) {
  d <- load_dataset(dataset)
  cc <- !is.na(d$pre) & !is.na(d$post)
  list(pre = d$pre[cc], post = d$post[cc], n_excluded = sum(!cc), n_miss = c(sum(is.na(d$pre)), sum(is.na(d$post))),
       vars = list(measures = list("pre", "post")), opts = empty, long = FALSE)
}
pair_desc <- function(p, ci) {
  if (p$long) list(desc_rec("score", list(time = "pre"), p$pre, ci, p$n_miss[1]),
                   desc_rec("score", list(time = "post"), p$post, ci, p$n_miss[2]))
  else list(desc_rec("pre", empty, p$pre, ci, p$n_miss[1]), desc_rec("post", empty, p$post, ci, p$n_miss[2]))
}

# ---- gain score -------------------------------------------------------------------------------
gain_case <- function(case, p, dataset, meta = NULL, ci = 0.95) {
  g <- p$post - p$pre
  tt <- stats::t.test(p$post, p$pre, paired = TRUE, conf.level = ci)
  dz <- cohens_d(p$post, p$pre, paired = TRUE, ci = ci, verbose = FALSE)
  dav <- repeated_measures_d(p$post, p$pre, method = "av", adjust = FALSE, ci = ci, verbose = FALSE)
  fixture("education.gain_score", case, dataset, req(p$vars, p$opts, "two_sided", ci),
          list(n_used = length(g), n_excluded = p$n_excluded,
               statistics = list(stat_rec("t", tt$statistic, tt$parameter, tt$p.value)),
               effect_sizes = list(es_rec("mean_gain", mean(g), tt$conf.int[1], tt$conf.int[2]),
                                   es_rec("d_av", dav$d_av, dav$CI_low, dav$CI_high),
                                   es_rec_nct("d_z", dz$Cohens_d, dz, tt$statistic, length(g) - 1, 1 / length(g), ci, "two.sided")),
               descriptives = c(pair_desc(p, ci), list(desc_rec("gain", empty, g, ci, p$n_excluded))),
               assumptions = list(shapiro_rec(g, "differences"))),
          "gain = post - pre; t.test(post, pre, paired = TRUE); d_av, d_z (effectsize)", meta = meta)
}
gain_case("linked", linked_pairs(), "agr_gain_linked_long.csv", meta = LINK_META)
gain_case("hand", wide_pairs("agr_gain_hand.csv"), "agr_gain_hand.csv")

gain_group_case <- function(case, dataset, ci = 0.95) {
  d <- load_dataset(dataset)
  ok <- !is.na(d$group) & !is.na(d$pre) & !is.na(d$post)
  lv <- sort(unique(d$group[!is.na(d$group)]))
  x <- d[ok, ]; x$gain <- x$post - x$pre
  per_t <- lapply(lv, function(l) {
    s <- x[x$group == l, ]; tt <- stats::t.test(s$post, s$pre, paired = TRUE, conf.level = ci)
    list(stat = stat_rec("t", tt$statistic, tt$parameter, tt$p.value, term = l),
         es = c(es_rec("mean_gain", mean(s$gain), tt$conf.int[1], tt$conf.int[2]), list(term = l)))
  })
  if (length(lv) == 2) {
    a <- x$gain[x$group == lv[1]]; b <- x$gain[x$group == lv[2]]
    w <- stats::t.test(a, b, conf.level = ci)
    st <- stats::t.test(a, b, var.equal = TRUE)
    hg <- hedges_g(a, b, pooled_sd = TRUE, ci = ci, verbose = FALSE)
    head <- stat_rec("welch_t", w$statistic, w$parameter, w$p.value)
    effects <- list(es_rec("gain_difference", mean(a) - mean(b), w$conf.int[1], w$conf.int[2]),
                    es_rec_nct("hedges_g", hg$Hedges_g, hg, st$statistic, length(a) + length(b) - 2,
                               1 / length(a) + 1 / length(b), ci, "two.sided", adjust = TRUE))
  } else {
    w <- stats::oneway.test(gain ~ group, data = x, var.equal = FALSE)
    head <- stat_rec("welch_F", w$statistic, w$parameter, w$p.value)
    effects <- list()
  }
  desc <- unlist(lapply(lv, function(l) {
    rows <- d[!is.na(d$group) & d$group == l, ]; s <- x[x$group == l, ]
    gg <- list(group = l)
    list(desc_rec("pre", gg, s$pre, ci, sum(is.na(rows$pre))), desc_rec("post", gg, s$post, ci, sum(is.na(rows$post))),
         desc_rec("gain", gg, s$gain, ci, sum(is.na(rows$pre) | is.na(rows$post))))
  }), recursive = FALSE)
  fixture("education.gain_score", case, dataset,
          req(list(measures = list("pre", "post"), group = list("group")), empty, "two_sided", ci),
          list(n_used = nrow(x), n_excluded = sum(!ok), statistics = c(list(head), lapply(per_t, `[[`, "stat")),
               effect_sizes = effects, group_effects = lapply(per_t, `[[`, "es"), descriptives = desc,
               assumptions = lapply(lv, function(l) shapiro_rec(x$gain[x$group == l], l))),
          "grouped gains: per-group paired t; Welch t (2 groups, Hedges' g) or Welch F (3+) on the gains")
}
gain_group_case("groups2", "agr_gain_groups2.csv")
gain_group_case("groups3", "agr_gain_groups3.csv")

# ---- normalized gain --------------------------------------------------------------------------
ng_stats <- function(pre, post, mx) {
  gc <- (mean(post) - mean(pre)) / (mx - mean(pre))
  ok <- pre < mx
  gi <- if (any(ok)) mean((post[ok] - pre[ok]) / (mx - pre[ok])) else NA
  cv <- ifelse(post > pre, (post - pre) / (mx - pre), ifelse(post < pre, (post - pre) / pre, 0))
  keep <- !(post == pre & (pre == mx | pre == 0))
  c(gc, gi, if (any(keep)) mean(cv[keep]) else NA)
}
ng_block <- function(pre, post, mx, ci, term = NULL) {
  set.seed(BOOT_SEED)
  bt <- boot::boot(data.frame(pre = pre, post = post), function(d, i) ng_stats(d$pre[i], d$post[i], mx), R = NG_ITER)
  keys <- c("g_class", "g_individual", "normalized_change")
  lapply(1:3, function(j) {
    b <- boot::boot.ci(bt, conf = ci, type = "perc", index = j)$percent[4:5]
    r <- es_rec(keys[j], bt$t0[j], b[1], b[2])
    if (!is.null(term)) r$term <- term
    r
  })
}
ng_case <- function(case, p, dataset, mx, meta = NULL, ci = 0.95) {
  opts <- c(p$opts, list(max_score = mx))
  fixture("education.normalized_gain", case, dataset, req(p$vars, opts, "two_sided", ci),
          list(n_used = length(p$pre), n_excluded = p$n_excluded, statistics = list(),
               effect_sizes = ng_block(p$pre, p$post, mx, ci), descriptives = pair_desc(p, ci),
               n_g_excluded = sum(p$pre >= mx), n_c_excluded = sum(p$post == p$pre & (p$pre == mx | p$pre == 0)),
               bootstrap = list(seed = BOOT_SEED, iterations = NG_ITER)),
          "Hake g (class average), mean individual g (pre = max excluded), Marx-Cummings c; boot perc CI",
          meta = meta)
}
ng_case("linked", linked_pairs(), "agr_gain_linked_long.csv", 100, meta = LINK_META)
ng_case("hand", wide_pairs("agr_gain_hand.csv"), "agr_gain_hand.csv", 10)

ng_group_case <- function(case, dataset, mx, ci = 0.95) {
  d <- load_dataset(dataset)
  ok <- !is.na(d$group) & !is.na(d$pre) & !is.na(d$post)
  x <- d[ok, ]
  lv <- sort(unique(x$group))
  ge <- unlist(lapply(lv, function(l) ng_block(x$pre[x$group == l], x$post[x$group == l], mx, ci, term = l)),
               recursive = FALSE)
  fixture("education.normalized_gain", case, dataset,
          req(list(measures = list("pre", "post"), group = list("group")), list(max_score = mx), "two_sided", ci),
          list(n_used = nrow(x), n_excluded = sum(!ok), statistics = list(),
               effect_sizes = ng_block(x$pre, x$post, mx, ci), group_effects = ge,
               n_g_excluded = sum(x$pre >= mx), bootstrap = list(seed = BOOT_SEED, iterations = NG_ITER)),
          "overall + per-group normalized gains; set.seed(12345) before every boot")
}
ng_group_case("groups3", "agr_gain_groups3.csv", 20)
cat("agreement_education fixtures written\n")
