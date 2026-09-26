# Reference values for Test Log family corrections (stats/corrections.py, SPEC §9):
# stats::p.adjust with method = "bonferroni", "holm", "BH" (Statly ids bonferroni, holm, fdr_bh).
# Cases cover ties, n = 1, missing p-values (NA does not count towards n), and values capped at 1.
if (!exists("R_DIR")) source(file.path(dirname(normalizePath(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))), "common.R"))

cases <- list(
  basic      = c(0.01, 0.04, 0.03, 0.005, 0.20),
  ties       = c(0.02, 0.02, 0.02, 0.04, 0.001, 0.04),
  n1         = c(0.037),
  two        = c(0.049, 0.012),
  with_na    = c(0.01, NA, 0.03, 0.5, NA),
  cap_at_one = c(0.3, 0.6, 0.9, 0.45),
  edges      = c(0, 1, 0.05, 0.5),
  many       = c(0.0001, 0.0021, 0.0034, 0.0098, 0.0112, 0.0203, 0.0317, 0.0415, 0.0499, 0.0612,
                 0.1044, 0.2319, 0.3808, 0.5555, 0.7392, 0.9901)
)
methods <- c(bonferroni = "bonferroni", holm = "holm", fdr_bh = "BH")

for (nm in names(cases)) {
  p <- cases[[nm]]
  expected <- lapply(methods, function(m) num(p.adjust(p, method = m)))
  expected <- lapply(expected, function(x) if (is.list(x)) x else list(x))  # keep arrays for n = 1
  write_fixture("corrections", nm, list(
    analysis_id = "corrections", case = nm, dataset = NULL,
    request = list(p_values = lapply(p, function(v) if (is.na(v)) NULL else v)),
    expected = expected, error = NULL))
}
cat("corrections fixtures written\n")
