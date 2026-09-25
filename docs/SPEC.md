# STATLY — Project Development Plan
Version 1.0 · Prepared for Claude Code (orchestrated build)

## 0. How to use this document (for the orchestrator)
This is the complete specification for Statly, a cross-platform desktop app (macOS + Windows) that teaches beginners which statistical tests to run for education research, then runs them on their data. Build in the phases in Section 13. Each phase has acceptance criteria; do not start a phase until the previous phase's criteria pass. After Phase 1, the Stats Engine, Frontend, and Learning Content workstreams can run in parallel against the shared contracts defined in Section 4. Statistical correctness is the top priority: every analysis must pass the reference-validation tests in Section 12 before its UI is considered done.

## 1. Product summary
Statly is a guided statistics tutor and analysis tool for education researchers and students, most of whom know no statistics. Users describe their study, upload data (usually Qualtrics CSV/XLSX exports), are interviewed column by column about what their data means, get guided to the right tests with plain-language explanations and worked examples at every step, run the analyses, and export APA 7th edition tables, write-ups, and customizable charts. It also includes a Study Planner (design + power analysis before data collection) and a qualitative module for tagging open-ended responses.

Core principles:
1. Assume zero statistics knowledge. Every test, assumption, and output has a plain-language explanation and a worked education example.
2. Teach, don't just compute. The app explains why at every decision point, and the user makes key decisions (e.g., multiple-comparison corrections) with guidance.
3. All data stays local. No network calls, no telemetry, no accounts. Works fully offline.
4. Clean, modern, friendly UI. Explicitly not SPSS-style. Light, dark, and system themes.
5. Correctness verified against R.

## 2. Users
Primary: education graduate students and undergraduates with no stats background. Secondary: instructors/researchers (the owner) reviewing student projects. Typical data: pre/post (and delayed follow-up) tests and Likert surveys, 1–4 groups (control, intervention 1, intervention 2, or cohorts like undergrad/graduate, gender), 20–2,000 respondents, usually exported from Qualtrics.

## 3. Technology stack
- Shell: Tauri 2 (Rust) for small native installers on macOS and Windows.
- Frontend: React + TypeScript + Vite, Tailwind CSS, shadcn/ui (Radix primitives) for accessible components, Zustand for state, TanStack Table with virtualization for the data grid, dnd-kit for drag-and-drop.
- Charts: Vega-Lite via vega-embed (grammar-of-graphics model maps naturally to "drag a variable onto an axis"; native SVG/PNG export).
- Stats engine: Python 3.12 sidecar process, packaged with PyInstaller as a Tauri externalBin (one binary per target triple). Libraries: pandas, numpy, scipy, statsmodels, pingouin, scikit-posthocs, factor_analyzer, semopy, openpyxl, python-docx, reportlab. Check every library's license (see Section 15).
- IPC: JSON-RPC 2.0 over the sidecar's stdin/stdout (no localhost ports, avoids firewall prompts). Sidecar starts once per session and stays alive. Show a friendly "warming up" state on first launch.
- Reference validation (dev only, never shipped): R with psych, lavaan, car, afex, emmeans, effectsize, rstatix, pwr, ARTool, to generate expected-output fixtures.
- Builds: GitHub Actions matrix. macOS runners build .dmg (separate arm64 and x86_64 builds, or universal if the sidecar can be made universal2); Windows runner builds NSIS setup .exe. Do not attempt cross-compiling Windows from Mac.
- Security: strict Tauri CSP, no remote URLs, Tauri capabilities limited to file dialogs, fs within user-chosen paths, clipboard, and the sidecar.

Statistical defaults must match SPSS where users will compare results: Type III sums of squares with sum-to-zero (effect) contrasts for factorial ANOVA/ANCOVA, Greenhouse-Geisser reported alongside sphericity tests, two-tailed tests by default.

## 4. Architecture and shared contracts (define first)
- /app (Tauri + React), /engine (Python), /content (Markdown learning content + decision tree YAML), /fixtures (datasets + R-generated expected outputs), /docs.
- Define JSON Schemas in /contracts before parallel work: VariableSchema, DatasetMeta, ProjectFile, AnalysisRequest, AnalysisResult, AssumptionResult, ChartSpec, TestLogEntry, TagCodebook, StudyPlan.
- Every AnalysisResult contains: machine-readable statistics, effect sizes with 95% CIs, assumption results, a plain_language_summary, apa_sentence, apa_table (structured, renderable to HTML/DOCX), warnings (e.g., small sample), and the exact inputs used (for reproducibility and the test log).
- Engine functions are pure: (dataset snapshot + request) → result. No hidden state.

## 5. Data import
### 5.1 Formats
CSV (auto-detect delimiter and encoding, including UTF-8 with BOM and UTF-16 which Qualtrics sometimes produces) and XLSX (sheet picker if multiple sheets). Headers in the first row by default.

### 5.2 Qualtrics mode (auto-detected, user-confirmable)
- Detect Qualtrics exports: row 1 = short IDs (Q4, Q53, Q5_1), row 2 = full question text, row 3 = JSON import IDs like {"ImportId":"QID4"} (older exports have only 2 header rows). Use row 1 as variable name, row 2 as label/question text, discard row 3.
- Recognize metadata columns (StartDate, EndDate, Status, IPAddress, Progress, Duration (in seconds), Finished, RecordedDate, ResponseId, RecipientLastName, RecipientFirstName, RecipientEmail, ExternalReference, LocationLatitude, LocationLongitude, DistributionChannel, UserLanguage). Hide by default; keep available.
- PII flagging: IPAddress, names, email, location coordinates, and any column whose values look like emails or names. Offer to drop them on import, explained in plain language (FERPA/IRB).
- Row filters with explanations: exclude Status = Survey Preview or Spam, optionally exclude unfinished responses or Progress below a user-set threshold.
- Matrix/grid questions (Q5_1, Q5_2, …): group automatically and suggest them as a candidate scale.
- "_TEXT" suffix columns (e.g., "Other, please specify") → open-ended text.
- Multi-select ("select all that apply") stored as comma-separated values in one cell → offer to split into yes/no indicator variables.
- Timing columns (_First Click, _Last Click, _Page Submit, _Click Count) → metadata.
- Choice text vs numeric exports: if text ("Strongly agree"), detect the response set and ask the user to confirm order and numeric coding. If numeric, warn that Qualtrics recode values may not be 1–5 and show the observed values for confirmation.
- Score columns (SC0 etc.) recognized as scored-test totals.

### 5.3 Multi-file stacking
Users can upload several files (e.g., Pre, Post, Follow-up), tag each with a time label (editable), and Statly stacks them into one long dataset with a new Time variable. Columns are matched across files by short ID and question text, with a review screen showing matched, unmatched, and possibly-renamed questions (fuzzy match on text) for the user to confirm.

### 5.4 Aggregate vs. linked mode
- Default is aggregate mode: respondents are not linked across time; comparisons across time are between independent groups.
- Optional linked mode: the user picks an identifier variable ("match students by variable X"). Statly normalizes IDs (trim, case), reports matched/unmatched/duplicate IDs, explains why unmatched respondents are excluded only from paired/repeated-measures analyses, and keeps them for aggregate analyses.
- Teaching note shown in aggregate mode when the user compares time points: why paired tests are impossible without linking, plus the caveat that overlapping respondents violate strict independence, and how to mention this as a limitation.

### 5.5 Missing data
Use all available data per analysis (pairwise). A respondent who answered 8 of 10 items contributes those 8. Show a missing-data summary per variable after import. Missing-value codes (e.g., -99) can be defined per variable. Paired/repeated analyses use complete cases on the variables involved, with counts reported.

## 6. Variable Interview (guided setup wizard)
After import, a friendly step-by-step interview, one question at a time, with a "Why does this matter?" expander at each step:
1. For each non-metadata column, show the question text and a sample of values. Ask what it is: Identifier, Group/cohort (e.g., control/intervention, gender, program), Time point, Test question, Test total score, Survey (Likert) item, Demographic, Open-ended text, or Ignore.
2. Measurement level (nominal, ordinal, continuous), explained with examples. Pre-fill a best guess; the user confirms.
3. Value labels and ordering for categorical/Likert variables (drag to reorder).
4. Test items: if answers are raw choices, let the user enter an answer key to score correct/incorrect; or accept existing scores. Compute totals.
5. Scale building: group Likert items that measure the same idea (drag items into named scales; suggest groupings from matrix questions). Ask per item whether it is negatively worded; explain and apply reverse-scoring.
6. Scale scoring: mean of answered items by default (explained), with an optional minimum-items-answered threshold. Sum scores optional.
7. Summary screen of all decisions, all editable later.

The Variables screen afterward is a clean editable table: name, label, question text, role, level, value labels, reverse-coded, scale membership, missing codes. Undo/redo for all edits. Computed variables (e.g., gain score, normalized gain) via a simple guided builder, not a formula language.

## 7. Test Advisor and guided analysis
### 7.1 Decision engine
A data-driven decision tree stored in /content/decision_tree.yaml (not hard-coded), so content can be reviewed and edited. The user answers plain-language questions:
- What do you want to know? (Did scores change or differ between groups? Are two things related? Can one thing predict another? Do my survey questions hang together? Do my questions measure what I think?)
- What is your outcome? (auto-filled from the variable roles)
- How many groups? How many time points? Are the same students linked across time? Anything to control for (e.g., pretest, GPA)?
Output: the recommended test, its nonparametric alternative, the assumptions to check, the effect size to report, and follow-up (post hoc) tests, each with a "Why this test?" explanation.

### 7.2 Guided assumption checking
Before running a parametric test, walk the user through each assumption: what it is, why it matters (with an everyday analogy), which check Statly is running (e.g., Shapiro-Wilk), the result in plain language, supporting visuals (histogram, Q-Q plot, box plot), and what it means for the decision. Teach the nuance that normality tests become oversensitive with large samples and that plots matter too, and which data the check applies to (each group, or the differences for paired tests). Then explain why a parametric test is OK or why a nonparametric test is needed. The user makes the final choice; Statly confirms or gently explains a concern.

### 7.3 Likert teaching
Explain the ordinal-data issue: single Likert items are ordinal (nonparametric tests recommended); multi-item scale scores are commonly treated as continuous. Recommend accordingly and explain why.

## 8. Statistical coverage
All tests report exact statistics, df, p, effect sizes with 95% CIs, and descriptives per group/time.

Descriptives: n, mean, SD, SE, median, IQR, min/max, skewness, kurtosis, frequencies and percentages.

Assumption checks: Shapiro-Wilk (primary), Kolmogorov-Smirnov with Lilliefors correction, Q-Q plots, Levene's test (Brown-Forsythe variant), Mauchly's sphericity with Greenhouse-Geisser and Huynh-Feldt corrections, Box's M, homogeneity of regression slopes (ANCOVA), linearity, multicollinearity (VIF), outliers (z-scores, IQR rule, Mahalanobis distance).

Comparing groups/time:
- One-sample t; independent-samples t (Student and Welch, explaining why Welch is a safe default); paired t.
- Mann-Whitney U; Wilcoxon signed-rank; sign test.
- One-way ANOVA; Welch's ANOVA; Kruskal-Wallis.
- Repeated-measures ANOVA; Friedman test.
- Two-way (factorial) ANOVA; mixed ANOVA (between × within, e.g., group × time) with simple-effects follow-ups for interactions; aligned rank transform ANOVA as the nonparametric factorial option (validate against R ARTool).
- ANCOVA (e.g., post-test adjusted for pre-test) with estimated marginal means; Quade's rank ANCOVA as the nonparametric option.
- MANOVA and MANCOVA (report Pillai's trace by default, with follow-up univariate tests).
- Post hoc: Tukey HSD, Games-Howell (unequal variances), Bonferroni/Holm pairwise, Dunn's test (after Kruskal-Wallis), Conover or Nemenyi (after Friedman).
- Education-specific: gain scores and Hake's normalized gain.

Categorical: chi-square test of independence and goodness of fit, Fisher's exact test, McNemar (linked yes/no pre/post), Cochran's Q.

Relationships: Pearson, Spearman, Kendall's tau-b, point-biserial, partial correlation, correlation matrices with adjustable corrections.

Prediction: simple and multiple linear regression, hierarchical regression (R² change), binary logistic regression, ordinal logistic regression; dummy coding explained visually.

Reliability: Cronbach's alpha with alpha-if-item-deleted and corrected item-total correlations, McDonald's omega, split-half with Spearman-Brown, KR-20 for right/wrong test items, test item analysis (difficulty and discrimination), ICC, Cohen's kappa, Fleiss' kappa, Kendall's W.

Validity: exploratory factor analysis (KMO, Bartlett's test, parallel analysis, scree plot, oblimin/varimax/promax rotations, loadings table with suppression threshold); confirmatory factor analysis (CFI, TLI, RMSEA with CI, SRMR, standardized loadings; path diagram). Sample-size warnings (e.g., EFA/CFA with fewer than ~100 respondents) explained in plain language.

Effect sizes: Cohen's d, Hedges' g, Glass's delta, d_z and d_av for paired designs, r and rank-biserial for nonparametric tests, eta², partial eta², omega², Cohen's f, epsilon² (Kruskal-Wallis), Kendall's W (Friedman), Cramér's V, phi, odds ratios, R², f². Show conventional benchmarks with a caveat that education effects are often judged against field-specific norms.

Power analysis: a priori sample size and sensitivity analysis for t-tests, ANOVA (including repeated measures and mixed where feasible, documenting approximations), correlation, chi-square, and regression. Validate against G*Power and R pwr.

## 9. Multiple comparisons and the Test Log
- Every analysis run is recorded in a session Test Log (inputs, results, timestamp) saved in the project.
- Statly never applies corrections automatically. It explains the false-positive problem with a concrete example, detects when several related tests have been run (e.g., the same outcome across many items), and suggests grouping them into a "family."
- The user chooses the family and method: Bonferroni, Holm, or Benjamini-Hochberg (FDR), each explained. Adjusted p-values display next to originals, and exports reflect the user's choice.
- Post hoc tests after ANOVA-type tests use their built-in corrections, explained separately.

## 10. Results, charts, and exports
### 10.1 Results screen
For each analysis: a plain-language summary first ("Scores went up from pre to post, and the improvement was large"), then an APA 7 table, an APA-style results sentence with a copy button, assumption results, effect size interpretation, and "How to report this" guidance. APA formatting rules: italic statistical symbols, no leading zero for values that cannot exceed 1 (p, r, alpha), p to three decimals, "p < .001" floor, horizontal rules only, numbered tables with italic titles and notes.

### 10.2 Chart builder
- Chart types: bar with error bars (SE/SD/95% CI selectable), grouped bar, line (means across time with error bars), interaction plot, box plot, violin, histogram, density, Q-Q, scatter with fit line, correlation heatmap, diverging stacked bar for Likert items, stacked/percent bar, scree plot, CFA path diagram.
- Shelf-style builder: drag variables onto X, Y, Color/Group, Facet. A friendly "What do you want to show?" helper suggests chart types.
- Customization: titles, axis labels and ranges, colors (colorblind-safe palettes by default), fonts, legend position, data labels, gridlines, dimensions, APA figure style preset, light/dark preview.

### 10.3 Exports
- Copy APA tables to the clipboard as rich HTML so they paste into Word with formatting intact.
- Full report as DOCX (python-docx) and PDF (reportlab): selected analyses, tables, figures, APA text.
- Charts: PNG (1x/2x/4x, up to 600 DPI), SVG, PDF.
- Data: cleaned and scored dataset as XLSX or CSV, plus a codebook (variable names, labels, coding, reverse-scoring, scale composition).
- Test Log export.

## 11. Additional modules
### 11.1 Qualitative (open-ended responses)
Clean reader for text responses with filters by group, time, and other variables, plus keyword search with highlighting. Users create a codebook of tags (name, color, definition) and apply one or more tags per response. Summaries show counts and percentages per tag, overall and by group/time, with charts. Tags can become yes/no variables for chi-square comparisons. Export coded responses and the codebook to XLSX/DOCX.

### 11.2 Study Planner
Before data collection, a student describes their study through the same plain-language design interview. Output is an exportable plan (DOCX) covering: design summary; data collection recommendations (e.g., include a unique self-generated identifier question in every survey if paired analyses are wanted, keep identical wording and response scales across pre/post, Qualtrics setup tips such as checking recode values); planned analyses with rationale; assumptions to check later; and a power analysis with the recommended sample size. The plan can seed a later analysis project.

### 11.3 Learn library
- For every test, assumption, and effect size, a Markdown page in /content/learn: what it is, when to use it, an everyday analogy, a worked education example with small numbers the reader can follow, how to read the output, how to report it in APA, and common mistakes.
- Hover glossary for every technical term throughout the UI.
- Target reading level: roughly grades 8–10. All content is flagged for review by the project owner before release.

### 11.4 Tutorials and practice datasets
- Practice datasets in /fixtures/practice: one-group pre/post Likert survey; control vs. two interventions with pre/post/follow-up tests; a messy Qualtrics export (preview rows, PII, text choices, matrix items, multi-select, reverse-worded items, open-ended responses); a linked-ID pre/post dataset.
- In-app guided tutorials using these datasets, with step-by-step annotated screenshots and "why this test" explanations.
- Screenshots are auto-captured with Playwright driving the built app, so they can be regenerated when the UI changes. Also write a narration script (Markdown) for each tutorial to support video production.

## 12. Quality and testing
- Engine: pytest. For every analysis, fixtures are generated once in R and compared in CI with a tolerance of 1e-6 (1e-4 for iterative methods like CFA, EFA rotations, and logistic models). Include edge cases: ties, small n, unequal groups, missing values, constant variables, a single group, perfect separation.
- Decision tree: unit tests covering every path from design answers to recommended test.
- APA formatting: snapshot tests for tables and sentences.
- Qualtrics parsing: test files covering 2- vs 3-header-row exports, text vs numeric, matrix, multi-select, _TEXT, UTF-16.
- Frontend: Vitest for components; Playwright end-to-end tests of the full workflow on the practice datasets, run on both macOS and Windows in CI.
- Performance target: 5,000 rows × 300 columns imports in under 5 seconds and the grid scrolls smoothly; typical analyses return in under 1 second after warm-up.
- Accessibility: keyboard navigation, visible focus, ARIA via Radix, WCAG AA contrast in both themes, colorblind-safe palettes, reduced-motion support.

## 13. Build phases
Phase 0 — Scaffolding and packaging (de-risk first). Tauri + React app, Python sidecar with JSON-RPC ping, theme switching (light/dark/system), CI producing .dmg and .exe that launch and talk to the sidecar on clean machines. Acceptance: installers run on macOS (Apple Silicon and Intel) and Windows 10/11 with no dev tools installed.

Phase 1 — Data layer. Contracts (Section 4), CSV/XLSX import, Qualtrics mode, multi-file stacking, linked mode, missing-data summary, data grid, project file save/load. Project file: a .statly zip containing project.json (versioned schema), the dataset (Parquet), original imported files, variable metadata, test log, chart specs, tags, and study plan. Autosave with crash recovery. Acceptance: the messy Qualtrics practice file imports correctly and round-trips through save/load unchanged.

Phase 2 — Variable Interview. Wizard, Variables screen, reverse-scoring, scales, answer-key scoring, computed variables, undo/redo.

Phase 3 — Core engine. Descriptives, assumption checks, t-tests, nonparametric two-group tests, one-way/Welch ANOVA, Kruskal-Wallis, RM ANOVA, Friedman, correlations, chi-square/Fisher, Cronbach's alpha/omega/KR-20, effect sizes, post hoc tests, all passing R fixtures.

Phase 4 — Test Advisor and results. Decision tree, guided assumption flow, results screen with plain-language summaries and APA output, first batch of Learn pages for Phase 3 tests.

Phase 5 — Advanced engine. Factorial, mixed, ANCOVA, Quade, ART, MANOVA/MANCOVA, regression family, EFA/CFA, item analysis, power analysis, with Learn pages.

Phase 6 — Test Log and multiple-comparison workflow.

Phase 7 — Chart builder.

Phase 8 — Exports (clipboard tables, DOCX, PDF, images, data, codebook).

Phase 9 — Qualitative module.

Phase 10 — Study Planner.

Phase 11 — Tutorials, practice datasets, auto-captured screenshots, narration scripts, install guide.

Phase 12 — Polish and release: onboarding tour, empty states, error messages in plain language, accessibility audit, final cross-platform QA, versioned release builds.

Parallelization after Phase 1: Engine workstream (Phases 3, 5), Frontend workstream (Phases 2, 4, 6–10 UI), Content workstream (Learn pages, decision tree YAML, practice datasets), integrating through the contracts.

## 14. Distribution (unsigned to start)
- Mac: .dmg per architecture (or universal). Ad-hoc sign the app and the Python sidecar (required on Apple Silicon). Windows: NSIS setup .exe.
- Write /docs/INSTALL.md, a one-page, screenshot-illustrated install guide: on macOS 15+, open the app once, then go to System Settings → Privacy & Security → "Open Anyway" (Control-click → Open no longer bypasses Gatekeeper on recent macOS); if macOS reports the app is "damaged," document the Terminal fallback `xattr -dr com.apple.quarantine /Applications/Statly.app`. On Windows, SmartScreen → "More info" → "Run anyway."
- Recommend sharing via Google Drive or flash drive; many email systems block .exe attachments.
- Optional later upgrade: Apple Developer ID signing + notarization and a Windows code-signing certificate, wired into CI via secrets.

## 15. Open decisions for the project owner
1. Licensing: pingouin and factor_analyzer are GPL-licensed (verify all dependency licenses). Simplest path: release Statly as open source under GPL-3.0. Alternative: replace GPL libraries with in-house implementations validated against R. Orchestrator: flag this before Phase 3 and proceed with the owner's choice.
2. Name: "Statly" is used by a few unrelated small products; acceptable for free classroom distribution, reconsider (e.g., "Statly EDU") before wider publication.
3. Content review: the owner reviews all Learn pages and decision-tree logic before release.

## 16. Out of scope for v1
Cloud sync, accounts, AI-assisted text coding, languages other than English, multilevel/hierarchical linear models (candidate for v2: students nested in classrooms), auto-updates, code signing.
