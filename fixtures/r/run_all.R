# Regenerate every reference fixture: Rscript fixtures/r/run_all.R  (from anywhere)
# Order matters: datasets first, then the analysis scripts that read them.
source(file.path(dirname(normalizePath(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))), "common.R"))
others <- setdiff(sort(list.files(R_DIR, pattern = "\\.R$")), c("common.R", "datasets.R", "run_all.R"))
for (script in c("datasets.R", others)) {
  cat("==>", script, "\n")
  source(file.path(R_DIR, script), local = new.env())
}
n <- length(list.files(EXPECTED, pattern = "\\.json$", recursive = TRUE))
cat("done:", n, "fixture JSON files under", EXPECTED, "\n")
