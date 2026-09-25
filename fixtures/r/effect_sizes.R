# Reference values for the generic noncentral CI helpers in stats/effect_sizes.py:
#   nct_ci  <-> effectsize:::.get_ncp_t via t_to_d / t_to_r   (pivot on the noncentral t)
#   ncf_ci  <-> effectsize:::.get_ncp_F via F_to_eta2 / F_to_epsilon2 / F_to_omega2
# effectsize's defaults for eta2-type CIs are ci = .95 with alternative = "greater" (a one-sided
# interval, computed as a two-sided .90 interval with the upper bound set to 1); both the default
# and an explicit two-sided interval are recorded.
if (!exists("R_DIR")) source(file.path(dirname(normalizePath(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))), "common.R"))
suppressPackageStartupMessages(library(effectsize))

t_cases <- list(c(2.5, 20), c(-1.1, 48), c(0.3, 9), c(6.2, 120.4))
nct <- lapply(t_cases, function(tc) {
  r2 <- t_to_r(tc[1], tc[2], ci = 0.95)
  d2 <- t_to_d(tc[1], tc[2], ci = 0.95, paired = TRUE)  # d = t / sqrt(df)
  list(t = tc[1], df = tc[2],
       r = num(r2$r), r_ci_lower = num(r2$CI_low), r_ci_upper = num(r2$CI_high),
       d = num(d2$d), d_ci_lower = num(d2$CI_low), d_ci_upper = num(d2$CI_high))
})

f_cases <- list(c(4.2, 2, 57), c(0.8, 3, 40), c(12.5, 1, 30), c(0.05, 2, 20))
ncf <- lapply(f_cases, function(fc) {
  e1 <- F_to_eta2(fc[1], fc[2], fc[3], ci = 0.95)                       # default: one-sided
  e2 <- F_to_eta2(fc[1], fc[2], fc[3], ci = 0.95, alternative = "two.sided")
  o2 <- F_to_omega2(fc[1], fc[2], fc[3], ci = 0.95, alternative = "two.sided")
  list(f = fc[1], df1 = fc[2], df2 = fc[3],
       eta2 = num(e1$Eta2_partial), eta2_ci_lower = num(e1$CI_low), eta2_ci_upper = num(e1$CI_high),
       eta2_2s_ci_lower = num(e2$CI_low), eta2_2s_ci_upper = num(e2$CI_high),
       omega2 = num(o2$Omega2_partial), omega2_2s_ci_lower = num(o2$CI_low),
       omega2_2s_ci_upper = num(o2$CI_high))
})

write_fixture("effect_sizes", "noncentral_ci", list(
  analysis_id = "effect_sizes", case = "noncentral_ci", dataset = NULL, request = NULL,
  expected = list(nct = nct, ncf = ncf), error = NULL))
cat("effect-size helper fixtures written\n")
