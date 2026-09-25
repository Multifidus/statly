# Generates the reference datasets in fixtures/expected/data/*.csv (deterministic: set.seed).
# Both the R fixture scripts and the Python tests read these same CSVs. Values are rounded so the
# CSV text is exact and both languages parse identical doubles. Blank cell = missing.
if (!exists("R_DIR")) source(file.path(dirname(normalizePath(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))), "common.R"))
dir.create(DATA_DIR, recursive = TRUE, showWarnings = FALSE)
RNGkind("Mersenne-Twister", "Inversion", "Rejection")
set.seed(20260925)

two_groups <- function(n1, n2, m1, m2, s1, s2, digits = 2, labels = c("Control", "Treatment")) {
  data.frame(group = c(rep(labels[1], n1), rep(labels[2], n2)),
             y = round(c(rnorm(n1, m1, s1), rnorm(n2, m2, s2)), digits))
}

# Independent groups ---------------------------------------------------------
write_dataset(two_groups(25, 25, 50, 56, 10, 10), "indep_basic.csv")
write_dataset(two_groups(12, 40, 70, 74, 4, 12), "indep_unequal.csv")          # unequal n and SDs
write_dataset(two_groups(5, 5, 20, 24, 3, 3), "indep_small.csv")              # n = 5 per group
ties <- data.frame(group = c(rep("Control", 30), rep("Treatment", 28)),
                   y = c(sample(1:5, 30, TRUE, c(.10, .25, .35, .20, .10)),
                         sample(1:5, 28, TRUE, c(.05, .15, .30, .30, .20))))
write_dataset(ties, "indep_ties.csv")                                          # Likert item, heavy ties
miss <- two_groups(30, 30, 3.2, 3.6, 0.7, 0.7)
miss$y[c(3, 11, 34, 50)] <- NA
miss$group[c(7, 45)] <- NA
write_dataset(miss, "indep_missing.csv")                                       # missing outcome + group
write_dataset(data.frame(group = c(rep("Control", 10), rep("Treatment", 10)),
                         y = c(rep(4, 10), round(rnorm(10, 5, 1), 1))),
              "indep_constant_group.csv")                                      # one group constant
write_dataset(data.frame(group = rep("Control", 15), y = round(rnorm(15, 10, 2), 2)),
              "indep_single_group.csv")                                        # a single group

# One sample -----------------------------------------------------------------
write_dataset(data.frame(y = round(rnorm(40, 3.4, 0.8), 2)), "one_sample.csv")
write_dataset(data.frame(y = round(rexp(600, 1), 3)), "large_skewed.csv")     # n = 600, skewed
write_dataset(data.frame(y = rep(4, 12)), "constant.csv")                      # constant variable

# Paired (wide) --------------------------------------------------------------
pb <- data.frame(id = 1:30, pre = round(rnorm(30, 60, 12), 1))
pb$post <- round(pb$pre + rnorm(30, 5, 6), 1)
write_dataset(pb, "paired_basic.csv")
ps <- data.frame(id = 1:5, pre = round(rnorm(5, 3, 1), 1))
ps$post <- round(ps$pre + rnorm(5, 0.8, 0.5), 1)
write_dataset(ps, "paired_small.csv")
write_dataset(data.frame(y = ps$pre), "one_sample_small.csv")                # one sample, n = 5
pm <- data.frame(id = 1:35, pre = round(rnorm(35, 40, 8), 1))
pm$post <- round(pm$pre + rnorm(35, 2, 5), 1)
pm$pre[c(2, 9, 20)] <- NA
pm$post[c(9, 27)] <- NA
write_dataset(pm, "paired_missing.csv")

# Paired (long): 20 complete ids, 2 Pre-only, 1 Post-only, id 7 appears twice at Post (retake)
ids <- 1:23
pre <- data.frame(id = ids[1:22], time = "Pre", score = round(rnorm(22, 70, 10), 1))
post_ids <- c(1:20, 23, 7)
post <- data.frame(id = post_ids, time = "Post",
                   score = round(pre$score[match(post_ids, pre$id)] + rnorm(22, 4, 5), 1))
post$score[is.na(post$score)] <- round(rnorm(sum(is.na(post$score)), 74, 10), 1)
long <- rbind(pre, post)
long <- long[sample(nrow(long)), ]
write_dataset(long, "paired_long.csv")

cat("datasets written to", DATA_DIR, "\n")
