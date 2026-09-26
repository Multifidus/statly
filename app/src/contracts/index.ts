/* eslint-disable */
// Generated from contracts/*.json by scripts/gen-contracts.sh. DO NOT EDIT.

export type SubsetOp = "in" | "not_in";
/**
 * This interface was referenced by `AnalysisRequest`'s JSON-Schema
 * via the `definition` "CorrectionMethod".
 */
export type CorrectionMethod = "none" | "bonferroni" | "holm" | "fdr_bh";
/**
 * two_sided is the default (SPEC §3). greater/less are one-tailed alternatives.
 *
 * This interface was referenced by `AnalysisRequest`'s JSON-Schema
 * via the `definition` "Tails".
 */
export type Tails = "two_sided" | "greater" | "less";
export type EffectMagnitude = "negligible" | "small" | "medium" | "large";
export type AssumptionVerdict = "passed" | "caution" | "failed";
export type AssumptionScopeKind = "group" | "differences" | "residuals" | "overall";
/**
 * This interface was referenced by `ChartSpec`'s JSON-Schema
 * via the `definition` "ChartType".
 */
export type ChartType =
  | "bar"
  | "grouped_bar"
  | "line"
  | "interaction"
  | "box"
  | "violin"
  | "histogram"
  | "density"
  | "qq"
  | "scatter"
  | "correlation_heatmap"
  | "likert_diverging"
  | "stacked_bar"
  | "percent_bar"
  | "scree"
  | "cfa_path";
/**
 * Minimal styled text for APA output (italic statistical symbols, sub/superscripts). Concatenate run.text for plain text.
 *
 * This interface was referenced by `AnalysisResult`'s JSON-Schema
 * via the `definition` "RichText".
 */
export type RichText = TextRun[];
export type ColumnAlign = "left" | "center" | "right" | "decimal";
/**
 * This interface was referenced by `AnalysisResult`'s JSON-Schema
 * via the `definition` "TableCell".
 */
export type TableCell = NumberCell | PValueCell | IntervalCell | TextCell | EmptyCell;
export type ApaRowKind = "data" | "section_header" | "total";
export type WarningSeverity = "info" | "caution" | "serious";
export type ChartSourceKind = "dataset" | "analysis";
export type ShelfAggregate = "none" | "mean" | "median" | "count" | "percent" | "sum";
/**
 * This interface was referenced by `ChartSpec`'s JSON-Schema
 * via the `definition` "ErrorBarKind".
 */
export type ErrorBarKind = "none" | "se" | "sd" | "ci95";
export type LegendPosition = "top" | "bottom" | "left" | "right" | "none";
export type FitLine = "none" | "linear" | "loess";
/**
 * Light/dark is a preview concern, not stored.
 */
export type ChartThemePreset = "statly" | "apa";
/**
 * SPEC §6 step 1 roles, plus 'unassigned' (before the interview) and 'scale_score' (computed scale totals/means).
 *
 * This interface was referenced by `VariableSchema`'s JSON-Schema
 * via the `definition` "VariableRole".
 */
export type VariableRole =
  | "unassigned"
  | "identifier"
  | "group"
  | "time"
  | "test_item"
  | "test_total"
  | "likert_item"
  | "scale_score"
  | "demographic"
  | "open_text"
  | "ignore";
/**
 * This interface was referenced by `VariableSchema`'s JSON-Schema
 * via the `definition` "MeasurementLevel".
 */
export type MeasurementLevel = "nominal" | "ordinal" | "continuous";
/**
 * Logical storage type of the Parquet column.
 *
 * This interface was referenced by `VariableSchema`'s JSON-Schema
 * via the `definition` "StorageDtype".
 */
export type StorageDtype = "integer" | "float" | "string" | "boolean" | "datetime";
export type PiiKind =
  "ip_address" | "name" | "email" | "location" | "external_reference" | "value_pattern" | "user_flagged";
/**
 * Guided-builder operations only (no formula language). SPEC §6.
 *
 * This interface was referenced by `VariableSchema`'s JSON-Schema
 * via the `definition` "ComputedDefinition".
 */
export type ComputedDefinition = ComputedDifference | ComputedNormalizedGain | ComputedScaleScore | ComputedRecode;
export type ScaleScoreOp = "scale_mean" | "scale_sum";
/**
 * What happens to values no rule matches.
 */
export type RecodeUnmatched = "keep" | "missing";
export type ScaleScoringMethod = "mean" | "sum";
/**
 * matrix_suggestion = proposed from a Qualtrics matrix question (Q5_1, Q5_2, ...).
 */
export type ScaleOrigin = "user" | "matrix_suggestion";
/**
 * This interface was referenced by `DatasetMeta`'s JSON-Schema
 * via the `definition` "FileFormat".
 */
export type FileFormat = "csv" | "xlsx";
/**
 * This interface was referenced by `DatasetMeta`'s JSON-Schema
 * via the `definition` "RowFilterKind".
 */
export type RowFilterKind = "exclude_values" | "exclude_unfinished" | "progress_below";
export type DropReason = "pii" | "user";
export type LinkMode = "aggregate" | "linked";
/**
 * a_priori: effect -> required n. sensitivity: n -> detectable effect.
 */
export type PowerMode = "a_priori" | "sensitivity";
export type RecommendationCategory = "design" | "data_collection" | "qualtrics_setup" | "analysis";
export type CellValue = string | number | boolean | null;
export type QualtricsMode = "auto" | "on" | "off";
export type ColumnMatchStatus = "matched" | "unmatched" | "possibly_renamed";

/**
 * Input to a pure engine analysis: (snapshot_id, AnalysisRequest) -> AnalysisResult. SPEC §4, §7, §8.
 */
export interface AnalysisRequest {
  schema_version: 1;
  /**
   * Client-generated id (UUID); becomes the TestLogEntry id.
   */
  request_id: string;
  /**
   * Open enum of analysis identifiers, dotted snake_case (family.variant). The engine's registry is authoritative.
   */
  analysis_id: string;
  /**
   * null for dataset-free analyses (e.g. power.*; analysis.list reports needs_data=false).
   */
  dataset_id: string | null;
  /**
   * DatasetMeta.snapshot_id the request was built against; the engine rejects a stale snapshot. null for dataset-free analyses.
   */
  snapshot_id: string | null;
  /**
   * Analysis role -> variable names. Role keys are analysis-specific snake_case (outcome, group, time, subject_id, covariates, predictors, items, x, y, ...). Always arrays for uniform typing.
   */
  variables: {
    [k: string]: string[];
  };
  /**
   * Row conditions ANDed together (e.g. Time in ['Post']). Empty = all rows.
   */
  subset: SubsetCondition[];
  /**
   * Analysis-specific options (e.g. {"welch": true, "posthoc": "games_howell", "test_value": 3}). Per-analysis subschemas may be added later under $defs.
   */
  options: {
    [k: string]: unknown;
  };
  /**
   * Within-analysis p-value adjustments requested (e.g. pairwise comparisons, correlation matrices). Cross-analysis family corrections live in the Test Log, never here.
   */
  corrections: RequestedCorrection[];
  alpha: number;
  tails: Tails;
  ci_level: number;
}
/**
 * This interface was referenced by `AnalysisRequest`'s JSON-Schema
 * via the `definition` "SubsetCondition".
 */
export interface SubsetCondition {
  variable: string;
  op: SubsetOp;
  /**
   * @minItems 1
   */
  values: [string | number | boolean, ...(string | number | boolean)[]];
}
/**
 * This interface was referenced by `AnalysisRequest`'s JSON-Schema
 * via the `definition` "RequestedCorrection".
 */
export interface RequestedCorrection {
  /**
   * Which set of p-values within this analysis, e.g. 'pairwise', 'matrix', 'simple_effects'.
   */
  scope: string;
  method: CorrectionMethod;
}
/**
 * Output of a pure engine analysis. Field list is fixed by SPEC §4. The engine is the single APA formatter: every numeric table cell carries an engine-formatted display string.
 */
export interface AnalysisResult {
  schema_version: 1;
  /**
   * Echo of AnalysisRequest.analysis_id (the engine may resolve an alias to the concrete test run).
   */
  analysis_id: string;
  statistics: Statistic[];
  effect_sizes: EffectSize[];
  assumptions: AssumptionResult[];
  descriptives: Descriptives;
  plain_language_summary: string;
  apa_sentence: RichText;
  /**
   * Primary APA 7 table (null only if the analysis has no tabular output).
   */
  apa_table: ApaTable | null;
  /**
   * Secondary tables (e.g. post hoc comparisons, item statistics, loadings).
   */
  additional_tables: ApaTable[];
  warnings: ResultWarning[];
  /**
   * Data for supporting charts (Q-Q, histograms, scree...), keyed by ChartRef.data_key. Each value is a list of flat records.
   */
  chart_data: {
    [k: string]: {
      [k: string]: number | string | boolean | null;
    }[];
  };
  inputs: ResultInputs;
  engine_version: string;
  timestamp: string;
}
/**
 * One test statistic. Multi-term analyses (ANOVA) emit one per term.
 *
 * This interface was referenced by `AnalysisResult`'s JSON-Schema
 * via the `definition` "Statistic".
 */
export interface Statistic {
  /**
   * Machine key: t, F, chi2, U, W, H, r, z, ...
   */
  key: string;
  /**
   * e.g. 'Welch's t'.
   */
  label: string;
  /**
   * APA symbol, italicized when rendered: t, F, χ², U.
   */
  symbol: string;
  value: number | null;
  /**
   * [] none, [df] t/χ², [df1, df2] F. Non-integer allowed (Welch, GG).
   *
   * @maxItems 2
   */
  df: [] | [number] | [number, number];
  p: number | null;
  /**
   * Model term / comparison this row belongs to (e.g. 'Group', 'Group × Time', 'Control vs A'); null for single-statistic tests.
   */
  term: string | null;
}
/**
 * This interface was referenced by `AnalysisResult`'s JSON-Schema
 * via the `definition` "EffectSize".
 */
export interface EffectSize {
  /**
   * cohens_d, hedges_g, glass_delta, d_z, d_av, r, rank_biserial, eta_sq, partial_eta_sq, omega_sq, cohens_f, epsilon_sq, kendall_w, cramers_v, phi, odds_ratio, r_sq, f_sq, ...
   */
  key: string;
  label: string;
  symbol: string;
  value: number | null;
  /**
   * 95% CI by default (AnalysisRequest.ci_level); null only where no CI method exists.
   */
  ci: ConfidenceInterval | null;
  term: string | null;
  interpretation: EffectSizeInterpretation | null;
}
/**
 * This interface was referenced by `AnalysisResult`'s JSON-Schema
 * via the `definition` "ConfidenceInterval".
 */
export interface ConfidenceInterval {
  level: number;
  lower: number | null;
  upper: number | null;
}
/**
 * This interface was referenced by `AnalysisResult`'s JSON-Schema
 * via the `definition` "EffectSizeInterpretation".
 */
export interface EffectSizeInterpretation {
  magnitude: EffectMagnitude;
  /**
   * Source of the benchmark, e.g. 'Cohen (1988)'.
   */
  benchmark: string;
  /**
   * Plain-language interpretation incl. the field-norms caveat.
   */
  text: string;
}
/**
 * Outcome of one assumption check for one subset of data (one group, the differences, the residuals, ...). SPEC §7.2.
 */
export interface AssumptionResult {
  schema_version: 1;
  /**
   * Assumption key (open enum), e.g. normality, homogeneity_of_variance, sphericity, independence, linearity, multicollinearity, outliers, homogeneity_of_regression_slopes, equal_covariance_matrices.
   */
  assumption: string;
  /**
   * Display name, e.g. 'Normality'.
   */
  label: string;
  /**
   * null for visual-only or design-based checks (e.g. independence).
   */
  test_used: AssumptionTest | null;
  statistic: AssumptionStatistic | null;
  p: number | null;
  verdict: AssumptionVerdict;
  /**
   * Plain-language meaning of the result for the user's decision (grade 8-10 reading level).
   */
  explanation: string;
  applies_to: AssumptionScope;
  chart_refs: ChartRef[];
}
/**
 * This interface was referenced by `AssumptionResult`'s JSON-Schema
 * via the `definition` "AssumptionTest".
 */
export interface AssumptionTest {
  /**
   * e.g. shapiro_wilk, ks_lilliefors, levene_brown_forsythe, mauchly, box_m, vif.
   */
  key: string;
  /**
   * e.g. 'Shapiro-Wilk'.
   */
  label: string;
}
/**
 * This interface was referenced by `AssumptionResult`'s JSON-Schema
 * via the `definition` "AssumptionStatistic".
 */
export interface AssumptionStatistic {
  /**
   * APA symbol, e.g. 'W', 'F', 'χ²'.
   */
  symbol: string;
  value: number;
  /**
   * @maxItems 2
   */
  df: [] | [number] | [number, number];
}
/**
 * This interface was referenced by `AssumptionResult`'s JSON-Schema
 * via the `definition` "AssumptionScope".
 */
export interface AssumptionScope {
  kind: AssumptionScopeKind;
  /**
   * e.g. 'Control group', 'Post - Pre differences'.
   */
  label: string;
  /**
   * For kind=group: grouping variable -> level value.
   */
  group: {
    [k: string]: string | number | boolean;
  } | null;
  n: number | null;
}
/**
 * A supporting visual. Its data lives in AnalysisResult.chart_data[data_key].
 *
 * This interface was referenced by `AssumptionResult`'s JSON-Schema
 * via the `definition` "ChartRef".
 */
export interface ChartRef {
  chart_type: ChartType;
  title: string;
  data_key: string;
}
/**
 * This interface was referenced by `AnalysisResult`'s JSON-Schema
 * via the `definition` "Descriptives".
 */
export interface Descriptives {
  continuous: GroupDescriptives[];
  frequencies: FrequencyTable[];
}
/**
 * Continuous-variable summary for one variable within one cell (group/time). All numbers nullable (undefined for n < 2 etc.).
 *
 * This interface was referenced by `AnalysisResult`'s JSON-Schema
 * via the `definition` "GroupDescriptives".
 */
export interface GroupDescriptives {
  variable: string;
  /**
   * Grouping variable -> level for this cell; {} for the whole sample.
   */
  group: {
    [k: string]: string | number | boolean;
  };
  label: string;
  n: number;
  n_missing: number;
  mean: number | null;
  sd: number | null;
  se: number | null;
  /**
   * CI of the mean.
   */
  ci: ConfidenceInterval | null;
  median: number | null;
  q1: number | null;
  q3: number | null;
  iqr: number | null;
  min: number | null;
  max: number | null;
  skewness: number | null;
  /**
   * Excess kurtosis.
   */
  kurtosis: number | null;
}
/**
 * This interface was referenced by `AnalysisResult`'s JSON-Schema
 * via the `definition` "FrequencyTable".
 */
export interface FrequencyTable {
  variable: string;
  group: {
    [k: string]: string | number | boolean;
  };
  levels: FrequencyLevel[];
}
/**
 * This interface was referenced by `AnalysisResult`'s JSON-Schema
 * via the `definition` "FrequencyLevel".
 */
export interface FrequencyLevel {
  /**
   * null = the missing row.
   */
  value: string | number | boolean | null;
  label: string;
  count: number;
  percent: number;
  valid_percent: number | null;
}
/**
 * This interface was referenced by `AnalysisResult`'s JSON-Schema
 * via the `definition` "TextRun".
 */
export interface TextRun {
  text: string;
  italic?: boolean;
  subscript?: boolean;
  superscript?: boolean;
}
/**
 * Structured APA 7 table, renderable to HTML (clipboard) and DOCX/PDF. Table number is assigned at render/export time when null.
 *
 * This interface was referenced by `AnalysisResult`'s JSON-Schema
 * via the `definition` "ApaTable".
 */
export interface ApaTable {
  number: number | null;
  /**
   * Rendered in italic title case.
   */
  title: string;
  /**
   * @minItems 1
   */
  columns: [ApaColumn, ...ApaColumn[]];
  column_groups: ApaColumnGroup[];
  rows: ApaRow[];
  notes: ApaNotes;
}
/**
 * This interface was referenced by `AnalysisResult`'s JSON-Schema
 * via the `definition` "ApaColumn".
 */
export interface ApaColumn {
  key: string;
  header: RichText;
  align: ColumnAlign;
}
/**
 * Spanning header above consecutive columns.
 *
 * This interface was referenced by `AnalysisResult`'s JSON-Schema
 * via the `definition` "ApaColumnGroup".
 */
export interface ApaColumnGroup {
  label: RichText;
  first_column: number;
  span: number;
}
/**
 * This interface was referenced by `AnalysisResult`'s JSON-Schema
 * via the `definition` "ApaRow".
 */
export interface ApaRow {
  /**
   * One cell per column, in column order.
   */
  cells: TableCell[];
  indent: number;
  kind: ApaRowKind;
}
/**
 * This interface was referenced by `AnalysisResult`'s JSON-Schema
 * via the `definition` "NumberCell".
 */
export interface NumberCell {
  type: "number";
  value: number | null;
  /**
   * Engine-formatted APA text (decimals, no leading zero where applicable).
   */
  display: string;
}
/**
 * This interface was referenced by `AnalysisResult`'s JSON-Schema
 * via the `definition` "PValueCell".
 */
export interface PValueCell {
  type: "p_value";
  value: number | null;
  /**
   * e.g. '.034', '< .001'.
   */
  display: string;
}
/**
 * This interface was referenced by `AnalysisResult`'s JSON-Schema
 * via the `definition` "IntervalCell".
 */
export interface IntervalCell {
  type: "interval";
  lower: number | null;
  upper: number | null;
  /**
   * e.g. '[0.12, 0.88]'.
   */
  display: string;
}
/**
 * This interface was referenced by `AnalysisResult`'s JSON-Schema
 * via the `definition` "TextCell".
 */
export interface TextCell {
  type: "text";
  text: RichText;
}
/**
 * This interface was referenced by `AnalysisResult`'s JSON-Schema
 * via the `definition` "EmptyCell".
 */
export interface EmptyCell {
  type: "empty";
}
/**
 * This interface was referenced by `AnalysisResult`'s JSON-Schema
 * via the `definition` "ApaNotes".
 */
export interface ApaNotes {
  general: RichText | null;
  specific: RichText[];
  probability: RichText[];
}
/**
 * This interface was referenced by `AnalysisResult`'s JSON-Schema
 * via the `definition` "ResultWarning".
 */
export interface ResultWarning {
  /**
   * e.g. small_sample, ties_present, unequal_groups, constant_variable, perfect_separation, pairs_dropped.
   */
  code: string;
  severity: WarningSeverity;
  /**
   * Plain-language message.
   */
  message: string;
}
/**
 * Exact inputs used, for reproducibility and the Test Log.
 *
 * This interface was referenced by `AnalysisResult`'s JSON-Schema
 * via the `definition` "ResultInputs".
 */
export interface ResultInputs {
  request: AnalysisRequest;
  /**
   * null for dataset-free analyses (power.*).
   */
  dataset_id: string | null;
  snapshot_id: string | null;
  /**
   * Rows (or matched participants for paired designs) actually analysed.
   */
  n_used: number;
  /**
   * Rows in the subset excluded for missing data / unmatched IDs.
   */
  n_excluded: number;
  n_by_group: GroupCount[];
}
/**
 * This interface was referenced by `AnalysisResult`'s JSON-Schema
 * via the `definition` "GroupCount".
 */
export interface GroupCount {
  group: {
    [k: string]: string | number | boolean;
  };
  n: number;
}
/**
 * A saved chart-builder chart. The compiled Vega-Lite spec is NOT stored; it is derived from this spec + data fetched from the engine. SPEC §10.2.
 */
export interface ChartSpec {
  schema_version: 1;
  id: string;
  chart_type: ChartType;
  source: ChartSource;
  shelves: Shelves;
  /**
   * Row filter applied before plotting.
   */
  subset: SubsetCondition[];
  error_bars: ErrorBarKind;
  customization: ChartCustomization;
  theme_preset: ChartThemePreset;
  created_at: string;
  modified_at: string;
}
/**
 * Where the chart's data comes from: the dataset (aggregated by the engine) or a logged analysis result (scree plot, CFA path diagram, EMMs).
 *
 * This interface was referenced by `ChartSpec`'s JSON-Schema
 * via the `definition` "ChartSource".
 */
export interface ChartSource {
  kind: ChartSourceKind;
  test_log_entry_id: string | null;
}
/**
 * Arrays allow several variables on a shelf (e.g. several Likert items on Y, heatmap variables on X).
 *
 * This interface was referenced by `ChartSpec`'s JSON-Schema
 * via the `definition` "Shelves".
 */
export interface Shelves {
  x: ShelfField[];
  y: ShelfField[];
  /**
   * @maxItems 1
   */
  color: [] | [ShelfField];
  /**
   * @maxItems 2
   */
  facet: [] | [ShelfField] | [ShelfField, ShelfField];
}
/**
 * This interface was referenced by `ChartSpec`'s JSON-Schema
 * via the `definition` "ShelfField".
 */
export interface ShelfField {
  variable: string;
  aggregate: ShelfAggregate;
}
/**
 * All fields optional; absent = preset default. Open for additions.
 *
 * This interface was referenced by `ChartSpec`'s JSON-Schema
 * via the `definition` "ChartCustomization".
 */
export interface ChartCustomization {
  title?: string | null;
  subtitle?: string | null;
  x_axis?: AxisCustomization;
  y_axis?: AxisCustomization;
  /**
   * Named palette; default is colorblind-safe.
   */
  palette?: string;
  font_family?: string;
  font_size?: number;
  legend_position?: LegendPosition;
  data_labels?: boolean;
  gridlines?: boolean;
  fit_line?: FitLine;
  width?: number;
  height?: number;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `ChartSpec`'s JSON-Schema
 * via the `definition` "AxisCustomization".
 */
export interface AxisCustomization {
  label?: string | null;
  min?: number | null;
  max?: number | null;
}
/**
 * Everything about a dataset except the rows. The engine owns the data (Parquet); the frontend holds only this plus paged row slices (dataset.rows). SPEC §5.
 */
export interface DatasetMeta {
  schema_version: 1;
  /**
   * Stable id for the dataset for the life of the project.
   */
  dataset_id: string;
  /**
   * Content id of the current data + variable metadata. Changes on every mutation; analyses are pure functions of (snapshot_id, AnalysisRequest).
   */
  snapshot_id: string;
  n_rows: number;
  /**
   * Reserved int64 Parquet column holding a stable per-row id (survives sorting/filtering; referenced by TagCodebook applications). Not listed in variables.
   */
  row_id_column: "_statly_row_id";
  variables: VariableSchema[];
  scales: Scale[];
  import_log: ImportLog;
  /**
   * Present when several files were stacked into one long dataset.
   */
  stacking: StackingInfo | null;
  link: LinkConfig;
  missing_summary: VariableMissingSummary[];
}
/**
 * Metadata for one variable (column) of a dataset. Owned by the engine; the frontend edits it via RPC. SPEC §5, §6.
 */
export interface VariableSchema {
  schema_version: 1;
  /**
   * Unique variable name within the dataset (Qualtrics row-1 short ID, e.g. Q5_1). Also the Parquet column name.
   */
  name: string;
  /**
   * Short human-readable label.
   */
  label: string | null;
  /**
   * Full question text (Qualtrics row 2).
   */
  question_text: string | null;
  role: VariableRole;
  level: MeasurementLevel;
  dtype: StorageDtype;
  /**
   * Ordered code -> label pairs. Array order IS the category order (matters for ordinal/Likert variables).
   */
  value_labels: ValueLabel[];
  /**
   * If true, scoring uses (min + max) - x with min/max from response_range.
   */
  reverse_coded: boolean;
  /**
   * Theoretical min/max of the response scale (e.g. 1..5). Required for reverse-coding; defaults from value_labels codes.
   */
  response_range: ResponseRange | null;
  /**
   * Back-reference to DatasetMeta.scales[].id. DatasetMeta.scales[].items is authoritative; the engine keeps both in sync.
   */
  scale_id: string | null;
  /**
   * User-declared missing-value codes (e.g. -99). Treated as missing in every analysis.
   */
  missing_codes: (number | string)[];
  /**
   * Provenance: one entry per imported file this column came from (several when files were stacked). Empty for computed variables.
   */
  sources: VariableSource[];
  /**
   * Qualtrics metadata / timing column. Hidden by default, kept available.
   */
  is_metadata: boolean;
  /**
   * Flagged as personally identifying (FERPA/IRB).
   */
  is_pii: boolean;
  /**
   * Why the column was flagged; null when is_pii is false.
   */
  pii_reason: PiiReason | null;
  /**
   * Guided-builder definition when this is a computed variable; null for imported columns.
   */
  computed: ComputedDefinition | null;
  /**
   * Position in the Variables screen and data grid.
   */
  display_order: number;
}
/**
 * This interface was referenced by `VariableSchema`'s JSON-Schema
 * via the `definition` "ValueLabel".
 */
export interface ValueLabel {
  /**
   * Stored code (e.g. 1) or raw text value.
   */
  value: number | string;
  /**
   * Display label (e.g. 'Strongly agree').
   */
  label: string;
}
/**
 * This interface was referenced by `VariableSchema`'s JSON-Schema
 * via the `definition` "ResponseRange".
 */
export interface ResponseRange {
  min: number;
  max: number;
}
/**
 * This interface was referenced by `VariableSchema`'s JSON-Schema
 * via the `definition` "VariableSource".
 */
export interface VariableSource {
  /**
   * DatasetMeta.import_log.files[].file_id
   */
  file_id: string;
  original_column_name: string;
  /**
   * From header row 3, e.g. 'QID4' (null for 2-header-row or non-Qualtrics files).
   */
  qualtrics_import_id: string | null;
  /**
   * Raw text of each header row for this column, top to bottom (1 entry for plain CSV, 2-3 for Qualtrics).
   */
  header_texts: string[];
}
/**
 * This interface was referenced by `VariableSchema`'s JSON-Schema
 * via the `definition` "PiiReason".
 */
export interface PiiReason {
  kind: PiiKind;
  /**
   * Plain-language reason shown to the user.
   */
  explanation: string;
}
/**
 * Gain/difference score: minuend - subtrahend (e.g. post - pre).
 *
 * This interface was referenced by `VariableSchema`'s JSON-Schema
 * via the `definition` "ComputedDifference".
 */
export interface ComputedDifference {
  op: "difference";
  minuend: VariableOperand;
  subtrahend: VariableOperand;
}
/**
 * Reference to a variable, optionally at one time level (linked long datasets only: the value is taken from the same participant's row at that level).
 *
 * This interface was referenced by `VariableSchema`'s JSON-Schema
 * via the `definition` "VariableOperand".
 */
export interface VariableOperand {
  variable: string;
  time_level: string | null;
}
/**
 * Hake's normalized gain g = (post - pre) / (max_score - pre). Missing when pre == max_score.
 *
 * This interface was referenced by `VariableSchema`'s JSON-Schema
 * via the `definition` "ComputedNormalizedGain".
 */
export interface ComputedNormalizedGain {
  op: "normalized_gain";
  pre: VariableOperand;
  post: VariableOperand;
  max_score: number;
}
/**
 * Mean or sum of answered items (reverse-coded items reversed first). Missing when fewer than min_items are answered.
 *
 * This interface was referenced by `VariableSchema`'s JSON-Schema
 * via the `definition` "ComputedScaleScore".
 */
export interface ComputedScaleScore {
  op: ScaleScoreOp;
  /**
   * @minItems 1
   */
  items: [string, ...string[]];
  /**
   * Minimum answered items; null = all items must be answered for scale_sum, at least one for scale_mean.
   */
  min_items: number | null;
  /**
   * Scale this score belongs to, if any.
   */
  scale_id: string | null;
}
/**
 * This interface was referenced by `VariableSchema`'s JSON-Schema
 * via the `definition` "ComputedRecode".
 */
export interface ComputedRecode {
  op: "recode";
  source: string;
  /**
   * @minItems 1
   */
  rules: [RecodeRule, ...RecodeRule[]];
  unmatched: RecodeUnmatched;
}
/**
 * This interface was referenced by `VariableSchema`'s JSON-Schema
 * via the `definition` "RecodeRule".
 */
export interface RecodeRule {
  /**
   * Exact source values mapped by this rule (null when from_range is used).
   */
  from_values: (number | string)[] | null;
  /**
   * Inclusive numeric range mapped by this rule (null when from_values is used).
   */
  from_range: ResponseRange | null;
  /**
   * New value; null = set missing.
   */
  to: number | string | null;
}
/**
 * This interface was referenced by `DatasetMeta`'s JSON-Schema
 * via the `definition` "Scale".
 */
export interface Scale {
  id: string;
  name: string;
  /**
   * Item variable names (authoritative scale membership).
   */
  items: string[];
  scoring_method: ScaleScoringMethod;
  /**
   * Minimum answered items for a score; null = no threshold beyond at least one (mean) / all (sum).
   */
  min_items: number | null;
  /**
   * Name of the computed variable (op scale_mean/scale_sum) holding the score, once created.
   */
  score_variable: string | null;
  origin: ScaleOrigin;
}
/**
 * This interface was referenced by `DatasetMeta`'s JSON-Schema
 * via the `definition` "ImportLog".
 */
export interface ImportLog {
  files: ImportedFile[];
  row_filters: RowFilter[];
  dropped_columns: DroppedColumn[];
}
/**
 * This interface was referenced by `DatasetMeta`'s JSON-Schema
 * via the `definition` "ImportedFile".
 */
export interface ImportedFile {
  file_id: string;
  /**
   * Original file name (no directory).
   */
  name: string;
  sha256: string;
  size_bytes: number;
  format: FileFormat;
  /**
   * Detected/confirmed text encoding for CSV (e.g. utf-8, utf-8-sig, utf-16-le, cp1252); null for XLSX.
   */
  encoding: string | null;
  /**
   * Detected/confirmed CSV delimiter; null for XLSX.
   */
  delimiter: string | null;
  /**
   * Chosen XLSX sheet; null for CSV.
   */
  sheet_name: string | null;
  qualtrics: QualtricsDetection;
  /**
   * User-editable time label when stacked (e.g. 'Pre').
   */
  time_label: string | null;
  /**
   * Data rows read, after header rows.
   */
  n_rows_read: number;
  /**
   * Rows kept after row filters.
   */
  n_rows_kept: number;
  /**
   * Path of the untouched original inside the .statly zip, e.g. 'originals/<file_id>/<name>'.
   */
  stored_path: string;
  imported_at: string;
}
/**
 * This interface was referenced by `DatasetMeta`'s JSON-Schema
 * via the `definition` "QualtricsDetection".
 */
export interface QualtricsDetection {
  detected: boolean;
  /**
   * User accepted (or forced) Qualtrics mode.
   */
  confirmed: boolean;
  /**
   * Header rows consumed: 1 (plain), 2 (older Qualtrics) or 3 (with ImportId row).
   */
  header_rows: number;
}
/**
 * A row exclusion applied at import, with its plain-language explanation and effect.
 *
 * This interface was referenced by `DatasetMeta`'s JSON-Schema
 * via the `definition` "RowFilter".
 */
export interface RowFilter {
  id: string;
  kind: RowFilterKind;
  /**
   * File the filter applied to; null = all files.
   */
  file_id: string | null;
  /**
   * Column tested (e.g. Status, Finished, Progress).
   */
  variable: string | null;
  /**
   * exclude_values: values that exclude a row (e.g. ['Survey Preview', 'Spam'] or Qualtrics codes 1, 8).
   */
  values: (string | number)[] | null;
  /**
   * progress_below: rows with Progress < threshold are removed.
   */
  threshold: number | null;
  explanation: string;
  rows_removed: number;
}
/**
 * This interface was referenced by `DatasetMeta`'s JSON-Schema
 * via the `definition` "DroppedColumn".
 */
export interface DroppedColumn {
  file_id: string;
  column: string;
  reason: DropReason;
}
/**
 * This interface was referenced by `DatasetMeta`'s JSON-Schema
 * via the `definition` "StackingInfo".
 */
export interface StackingInfo {
  /**
   * Name of the created Time variable (role 'time').
   */
  time_variable: string;
  /**
   * Time levels in order (this order is the Time variable's value order).
   */
  levels: StackLevel[];
}
/**
 * This interface was referenced by `DatasetMeta`'s JSON-Schema
 * via the `definition` "StackLevel".
 */
export interface StackLevel {
  file_id: string;
  label: string;
}
/**
 * Aggregate (default) or linked mode. In linked mode id_variable, normalization and counts are non-null.
 *
 * This interface was referenced by `DatasetMeta`'s JSON-Schema
 * via the `definition` "LinkConfig".
 */
export interface LinkConfig {
  mode: LinkMode;
  id_variable: string | null;
  normalization: IdNormalization | null;
  counts: LinkCounts | null;
}
/**
 * This interface was referenced by `DatasetMeta`'s JSON-Schema
 * via the `definition` "IdNormalization".
 */
export interface IdNormalization {
  trim_whitespace: boolean;
  case_insensitive: boolean;
}
/**
 * Participant-level counts after normalization.
 *
 * This interface was referenced by `DatasetMeta`'s JSON-Schema
 * via the `definition` "LinkCounts".
 */
export interface LinkCounts {
  /**
   * IDs present at every time level.
   */
  matched: number;
  /**
   * IDs missing from at least one time level (excluded only from paired/repeated analyses).
   */
  unmatched: number;
  /**
   * IDs appearing more than once within a single time level.
   */
  duplicate: number;
}
/**
 * This interface was referenced by `DatasetMeta`'s JSON-Schema
 * via the `definition` "VariableMissingSummary".
 */
export interface VariableMissingSummary {
  variable: string;
  n_total: number;
  n_valid: number;
  /**
   * Empty / NA cells.
   */
  n_missing_blank: number;
  /**
   * Cells equal to a declared missing code.
   */
  n_missing_coded: number;
  pct_missing: number;
}
/**
 * Root document stored as project.json inside a .statly zip (layout in contracts/README.md). SPEC §13 Phase 1.
 */
export interface ProjectFile {
  schema_version: 1;
  /**
   * Stable UUID; keys autosave files.
   */
  project_id: string;
  name: string;
  app_version: string;
  /**
   * Engine version that last wrote the file.
   */
  engine_version: string;
  created_at: string;
  modified_at: string;
  /**
   * null for a planner-only project with no data yet.
   */
  dataset_meta: DatasetMeta | null;
  /**
   * Parquet path inside the zip ('data/dataset.parquet'); null iff dataset_meta is null.
   */
  data_path: string | null;
  test_log: TestLogEntry[];
  test_families: TestFamily[];
  chart_specs: ChartSpec[];
  tag_codebook: TagCodebook | null;
  study_plan: StudyPlan | null;
  ui_state: UiState;
}
/**
 * One analysis run, recorded in the project's Test Log. Corrections are never automatic: family_id, correction_method (identical across a family; 'none' when not in one) and adjusted_p are set only by the user's choice. SPEC §9.
 */
export interface TestLogEntry {
  schema_version: 1;
  /**
   * Equals request.request_id.
   */
  id: string;
  timestamp: string;
  request: AnalysisRequest;
  result_summary: ResultSummary;
  /**
   * Full AnalysisResult JSON inside the .statly zip, e.g. 'results/<id>.json'.
   */
  result_path: string | null;
  /**
   * ProjectFile.test_families[].id this test belongs to; null = not in a family.
   */
  family_id: string | null;
  correction_method: CorrectionMethod;
  /**
   * Adjusted version of result_summary.p within the family; null when correction_method is 'none'.
   */
  adjusted_p: number | null;
}
/**
 * This interface was referenced by `TestLogEntry`'s JSON-Schema
 * via the `definition` "ResultSummary".
 */
export interface ResultSummary {
  /**
   * e.g. 'Independent-samples t test (Welch)'.
   */
  analysis_label: string;
  /**
   * Used to detect related tests (same outcome across items) and suggest families.
   */
  outcome_variables: string[];
  primary_statistic: Statistic | null;
  /**
   * The p-value subject to family correction.
   */
  p: number | null;
  primary_effect_size: EffectSize | null;
  n_used: number;
  apa_sentence: RichText;
  plain_language_summary: string;
  engine_version: string;
}
/**
 * User-named group of related tests for multiple-comparison correction. Membership and method live on TestLogEntry.
 *
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "TestFamily".
 */
export interface TestFamily {
  id: string;
  name: string;
}
/**
 * Qualitative coding of open-ended responses. SPEC §11.1.
 */
export interface TagCodebook {
  schema_version: 1;
  tags: Tag[];
  /**
   * At most one entry per (row_id, variable).
   */
  applications: TagApplication[];
}
/**
 * This interface was referenced by `TagCodebook`'s JSON-Schema
 * via the `definition` "Tag".
 */
export interface Tag {
  id: string;
  name: string;
  color: string;
  definition: string;
}
/**
 * This interface was referenced by `TagCodebook`'s JSON-Schema
 * via the `definition` "TagApplication".
 */
export interface TagApplication {
  /**
   * Value of the reserved _statly_row_id column (DatasetMeta.row_id_column).
   */
  row_id: number;
  /**
   * Open-text variable the response belongs to.
   */
  variable: string;
  tag_ids: string[];
}
/**
 * Output of the Study Planner (pre-data-collection). Can seed a later analysis project. SPEC §11.2.
 */
export interface StudyPlan {
  schema_version: 1;
  id: string;
  title: string;
  created_at: string;
  modified_at: string;
  design: DesignAnswers;
  planned_analyses: PlannedAnalysis[];
  power_analyses: PowerAnalysis[];
  recommendations: Recommendation[];
}
/**
 * Answers to the plain-language design interview. Keys are node ids of content/decision_tree.yaml (the tree is data-driven), so answers are stored generically with the tree version.
 *
 * This interface was referenced by `StudyPlan`'s JSON-Schema
 * via the `definition` "DesignAnswers".
 */
export interface DesignAnswers {
  decision_tree_version: string;
  answers: {
    [k: string]: string | number | boolean | string[];
  };
  /**
   * Plain-language design summary for the exported plan.
   */
  summary: string;
}
/**
 * This interface was referenced by `StudyPlan`'s JSON-Schema
 * via the `definition` "PlannedAnalysis".
 */
export interface PlannedAnalysis {
  /**
   * Same id space as AnalysisRequest.analysis_id.
   */
  analysis_id: string;
  label: string;
  rationale: string;
  /**
   * analysis_id of the fallback test.
   */
  nonparametric_alternative: string | null;
  /**
   * AssumptionResult.assumption keys.
   */
  assumptions_to_check: string[];
  /**
   * EffectSize.key to report.
   */
  effect_size: string | null;
  /**
   * Post hoc / follow-up analysis ids.
   */
  follow_ups: string[];
}
/**
 * This interface was referenced by `StudyPlan`'s JSON-Schema
 * via the `definition` "PowerAnalysis".
 */
export interface PowerAnalysis {
  /**
   * Test family the calculation is for, e.g. t_test.independent, anova.one_way, correlation.pearson, chi_square.independence, regression.linear.
   */
  analysis_id: string;
  mode: PowerMode;
  inputs: PowerInputs;
  /**
   * null until computed.
   */
  outputs: PowerOutputs | null;
}
/**
 * This interface was referenced by `StudyPlan`'s JSON-Schema
 * via the `definition` "PowerInputs".
 */
export interface PowerInputs {
  alpha: number;
  power: number | null;
  tails: Tails;
  /**
   * d, f, r, w, f_sq, ...
   */
  effect_size_metric: string;
  /**
   * Required for a_priori.
   */
  effect_size: number | null;
  /**
   * Required for sensitivity.
   */
  n_total: number | null;
  n_groups?: number | null;
  n_measurements?: number | null;
  correlation_among_measures?: number | null;
  nonsphericity_epsilon?: number | null;
  n_predictors?: number | null;
  /**
   * Chi-square degrees of freedom.
   */
  df?: number | null;
  /**
   * n2 / n1 for two-group designs.
   */
  allocation_ratio?: number | null;
}
/**
 * This interface was referenced by `StudyPlan`'s JSON-Schema
 * via the `definition` "PowerOutputs".
 */
export interface PowerOutputs {
  n_total: number | null;
  n_per_group: number[] | null;
  detectable_effect: number | null;
  achieved_power: number | null;
  /**
   * Method and any approximation used (documented per SPEC §8).
   */
  method_note: string;
}
/**
 * This interface was referenced by `StudyPlan`'s JSON-Schema
 * via the `definition` "Recommendation".
 */
export interface Recommendation {
  category: RecommendationCategory;
  text: string;
  why: string;
}
/**
 * Minimal, non-essential UI restore hints. Safe to discard.
 *
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "UiState".
 */
export interface UiState {
  /**
   * e.g. 'data', 'variables', 'analyze', 'results', 'charts', 'qualitative', 'planner'.
   */
  active_view: string | null;
  active_chart_id?: string | null;
  active_test_log_entry_id?: string | null;
}
/**
 * autosave.json, present ONLY in autosave copies of a .statly zip.
 *
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "AutosaveMarker".
 */
export interface AutosaveMarker {
  schema_version: 1;
  project_id: string;
  /**
   * Path of the real .statly file; null if never saved.
   */
  original_path: string | null;
  saved_at: string;
}
export interface ImportFileInput {
  /**
   * Absolute path chosen via the OS file dialog.
   */
  path: string;
  /**
   * XLSX sheet; null = first sheet / ask.
   */
  sheet_name: string | null;
}
export interface DatasetImportPreviewParams {
  /**
   * @minItems 1
   */
  files: [ImportFileInput, ...ImportFileInput[]];
  qualtrics_mode: QualtricsMode;
  /**
   * Set when previewing files to append to an existing dataset (dataset.stack).
   */
  stack_onto_dataset_id: string | null;
}
export interface ImportIssue {
  code: string;
  severity: WarningSeverity;
  message: string;
  file_id: string | null;
  column: string | null;
}
export interface FilePreview {
  file_id: string;
  path: string;
  name: string;
  sha256: string;
  size_bytes: number;
  format: FileFormat;
  sheets: string[];
  sheet_name: string | null;
  encoding: string | null;
  delimiter: string | null;
  qualtrics: QualtricsDetection;
  n_rows: number;
  /**
   * Engine's best guess per column (role, level, labels, metadata/PII flags) for user confirmation.
   */
  proposed_variables: VariableSchema[];
  /**
   * First rows, cells in proposed_variables order.
   *
   * @maxItems 50
   */
  sample_rows: CellValue[][];
  /**
   * rows_removed = rows that WOULD be removed.
   */
  suggested_row_filters: RowFilter[];
  /**
   * Matrix-question groupings (origin matrix_suggestion).
   */
  suggested_scales: Scale[];
  /**
   * Columns holding comma-separated multi-select answers (split offered in Phase 2).
   */
  multiselect_candidates: string[];
  issues: ImportIssue[];
}
export interface ColumnRef {
  file_id: string;
  column: string;
}
export interface ColumnMatch {
  /**
   * Resulting variable name in the stacked dataset.
   */
  variable: string;
  status: ColumnMatchStatus;
  /**
   * Fuzzy question-text similarity for possibly_renamed.
   */
  similarity: number | null;
  /**
   * One column per file that contributes; files missing here get NA.
   */
  columns: ColumnRef[];
}
export interface DatasetImportPreviewResult {
  /**
   * Handle to the engine's staged parse; valid until the next import_preview or engine restart.
   */
  preview_id: string;
  files: FilePreview[];
  /**
   * Column matching across files (or against stack_onto_dataset_id); null for a single new file.
   */
  stack_proposal: ColumnMatch[] | null;
}
export interface ImportFileDecision {
  file_id: string;
  sheet_name: string | null;
  encoding: string | null;
  delimiter: string | null;
  qualtrics_header_rows: number;
  time_label: string | null;
  /**
   * Columns dropped at import (e.g. PII); recorded in import_log.dropped_columns.
   */
  drop_columns: string[];
}
export interface StackConfig {
  time_variable: string;
  levels: StackLevel[];
  /**
   * User-confirmed matching.
   */
  column_matches: ColumnMatch[];
}
export interface DatasetImportParams {
  preview_id: string;
  /**
   * @minItems 1
   */
  files: [ImportFileDecision, ...ImportFileDecision[]];
  /**
   * Filters to apply; rows_removed on input is ignored and recomputed.
   */
  row_filters: RowFilter[];
  /**
   * User-confirmed variable metadata (from proposed_variables); empty = accept proposals.
   */
  variables: VariableSchema[];
  /**
   * Required when importing 2+ files at once.
   */
  stack: StackConfig | null;
}
export interface DatasetResult {
  dataset_meta: DatasetMeta;
}
/**
 * Append newly previewed files (e.g. a later Follow-up export) to an existing dataset.
 */
export interface DatasetStackParams {
  dataset_id: string;
  preview_id: string;
  /**
   * @minItems 1
   */
  files: [ImportFileDecision, ...ImportFileDecision[]];
  /**
   * Filters to apply; rows_removed on input is ignored and recomputed.
   */
  row_filters: RowFilter[];
  /**
   * User-confirmed variable metadata (from proposed_variables); empty = accept proposals.
   */
  variables: VariableSchema[];
  stack: StackConfig;
}
export interface DatasetLinkParams {
  dataset_id: string;
  mode: LinkMode;
  id_variable: string | null;
  normalization: IdNormalization | null;
}
export interface LinkReport {
  counts: LinkCounts;
  /**
   * Normalized IDs (sample, max 200).
   *
   * @maxItems 200
   */
  unmatched_ids: string[];
  /**
   * @maxItems 200
   */
  duplicate_ids: string[];
  explanation: string;
}
export interface DatasetLinkResult {
  dataset_meta: DatasetMeta;
  report: LinkReport | null;
}
export interface RowSort {
  variable: string;
  descending: boolean;
}
export interface DatasetRowsParams {
  dataset_id: string;
  /**
   * If set and stale, the engine returns error -32002.
   */
  snapshot_id: string | null;
  offset: number;
  limit: number;
  /**
   * null = all variables in display order.
   */
  columns: string[] | null;
  sort: RowSort | null;
}
export interface DatasetRowsResult {
  snapshot_id: string;
  offset: number;
  total_rows: number;
  columns: string[];
  /**
   * _statly_row_id per returned row.
   */
  row_ids: number[];
  /**
   * Row-major; missing-coded values are returned as stored (not nulled).
   */
  rows: CellValue[][];
}
export interface DatasetIdParams {
  dataset_id: string;
}
export interface DatasetMissingSummaryResult {
  snapshot_id: string;
  missing_summary: VariableMissingSummary[];
}
/**
 *  Frontend-held parts; the engine substitutes its authoritative dataset_meta and data.
 */
export interface ProjectSaveParams {
  /**
   * Destination .statly path. Written atomically (temp file + rename); deletes this project's autosave on success.
   */
  path: string;
  project: ProjectFile;
}
export interface ProjectSaveResult {
  path: string;
  saved_at: string;
  size_bytes: number;
  project: ProjectFile;
}
export interface ProjectLoadParams {
  path: string;
}
export interface ProjectLoadResult {
  project: ProjectFile;
  is_autosave: boolean;
  autosave_marker: AutosaveMarker | null;
}
export interface ProjectAutosaveParams {
  /**
   * App data dir supplied by the shell (Tauri appDataDir/autosave).
   */
  autosave_dir: string;
  original_path: string | null;
  project: ProjectFile;
}
export interface ProjectAutosaveResult {
  autosave_path: string;
  saved_at: string;
}
export interface ProjectRecoverableParams {
  autosave_dir: string;
}
export interface RecoverableAutosave {
  autosave_path: string;
  marker: AutosaveMarker;
}
export interface ProjectRecoverableResult {
  autosaves: RecoverableAutosave[];
}
export interface ProjectDiscardAutosaveParams {
  autosave_path: string;
}
export interface OkResult {
  ok: true;
}
