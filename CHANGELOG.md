# Changelog

All notable changes to Statly are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Trimmed the PyInstaller sidecar bundle (`engine/statly-engine.spec`): excluded
  GUI/notebook/dev-tooling modules the engine never imports and the bundled
  test suites of numpy/pandas/scipy/statsmodels.

### Added

- `scripts/bump-version.py` to bump the app/Tauri/engine/Cargo.lock version
  fields together ahead of a release.
- GitHub Release automation on `v*` tags (`.github/workflows/build.yml`),
  attaching the macOS `.dmg` and Windows NSIS installers.

## [0.1.0] - 2026-09-26

Initial feature-complete build of Statly, developed across twelve phases:

- **Phase 0** — Repo scaffold: Tauri 2 desktop shell, Python JSON-RPC sidecar
  over stdio, theme switching, cross-platform CI build matrix.
- **Phase 1** — Shared JSON Schema contracts (TS/pydantic codegen); engine
  data layer (CSV/Excel/Qualtrics import, file stacking/linking, missing-data
  handling, Parquet-backed store, `.statly` project I/O); frontend data layer
  (import wizard, data grid, project I/O, mock engine, e2e harness).
- **Phase 2** — Variable Interview, Variables screen, scale construction,
  reverse-scoring, answer-key scoring, computed variables, snapshot-based
  undo/redo.
- **Phase 3** — Core stats framework (result builder, effect-size CIs, APA
  formatting, assumption checks, analysis registry); t-test, ANOVA
  (one-way/Welch/repeated-measures), nonparametric, correlation, categorical,
  and reliability analysis families; Test Advisor decision tree and Learn
  content library (91 pages, glossary).
- **Phase 4** — Test Advisor flow end to end, guided assumption checks with
  plots, generic results screen with APA copy, Test Log, Learn library UI.
- **Phase 5** — ANCOVA/Quade rank ANCOVA/MANOVA/MANCOVA; agreement measures
  (ICC, Cohen/Fleiss kappa, Kendall's W, gain scores); regression family
  (linear, hierarchical, logistic, ordinal, with diagnostics); factorial and
  mixed ANOVA (pooled sphericity, Box's M, aligned rank transform, simple
  effects); in-house EFA and CFA; power analysis (t, ANOVA, correlation,
  chi-square, regression) — all validated against R fixtures.
- **Phase 6** — Test Log analysis families and multiple-comparison
  corrections, with results persisted in `.statly` project files.
- **Phases 7-11** — Chart Builder with saveable figures; export UI (APA HTML
  tables, DOCX/PDF reports, data export, codebook, test log); qualitative
  coding/tagging module; Study Planner with advisor integration; onboarding
  tour and empty states; tutorials, screenshots, and `docs/INSTALL.md`.

[Unreleased]: https://github.com/Multifidus/statly/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Multifidus/statly/releases/tag/v0.1.0
