# Regenerate every reference fixture: Rscript fixtures/r/run_all.R  (from anywhere)
# Order matters: datasets first, then the analysis scripts that read them.
source(file.path(dirname(normalizePath(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))), "common.R"))
for (script in c("datasets.R", "descriptives.R", "assumptions.R", "ttests.R", "effect_sizes.R")) {
  cat("==>", script, "\n")
  source(file.path(R_DIR, script), local = new.env())
}
n <- length(list.files(EXPECTED, pattern = "\\.json$", recursive = TRUE))
cat("done:", n, "fixture JSON files under", EXPECTED, "\n")
