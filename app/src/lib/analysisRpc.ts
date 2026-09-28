/**
 * Types for the Test Advisor (docs/PROTOCOL.md "Test Advisor methods") and analysis RPCs
 * (`analysis.run`, `analysis.list`; contracts/README.md "Phase 3/4 RPC methods"). The advisor
 * shapes are plain JSON not yet in contracts/Rpc.json; `analysis.run` uses the generated
 * AnalysisRequest/AnalysisResult contracts.
 */

export type OutcomeLevel = "nominal" | "ordinal" | "continuous";

export interface DatasetContext {
  outcome_level?: OutcomeLevel;
  num_groups?: number;
  num_time_points?: number;
  linked_mode?: boolean;
  covariates_present?: boolean;
  /** Rows with the outcome present (non-missing). */
  n_complete?: number;
  /** Distinct non-missing values of the outcome. */
  outcome_distinct?: number;
  /** Distinct non-missing values of a correlation's second variable, when known; otherwise the outcome's. */
  second_distinct?: number;
}

export type AnswerValue = string | number | boolean;

export interface AdvisorOption {
  value: AnswerValue;
  label: string;
  /** One plain-language sentence with a concrete example, shown inline under the label. */
  description?: string | null;
}

export interface AdvisorQuestion {
  id: string;
  text: string;
  why: string;
  /** One or two plain-language sentences shown inline under the question text. */
  hint?: string | null;
  options: AdvisorOption[];
  auto_answer: AnswerValue | null;
}

export interface AdvisorRecommendation {
  id: string;
  primary_test: string;
  nonparametric_alternative: string | null;
  assumptions: string[];
  effect_size: string[];
  post_hoc: string[];
  why_this_test: string;
  likert_note: string | null;
  caveats: string[];
}

export interface AdvisorPathStep {
  question: string;
  value: AnswerValue;
  source: "user" | "auto";
}

export interface AdvisorStep {
  next_question: AdvisorQuestion | null;
  recommendation: AdvisorRecommendation | null;
  path: AdvisorPathStep[];
}

export interface AdvisorPath {
  answers: { question: string; value: AnswerValue; label: string }[];
  recommendation: AdvisorRecommendation;
}

export interface AdvisorStartParams {
  dataset_context?: DatasetContext;
}

export interface AdvisorAnswerParams {
  answers: Record<string, AnswerValue>;
  dataset_context?: DatasetContext;
}

/** One role of an analysis layout; `max: null` = unbounded. */
export interface AnalysisRole {
  role: string;
  min: number;
  max: number | null;
  description: string;
}

export interface AnalysisLayout {
  name: string;
  roles: AnalysisRole[];
}

export interface AnalysisInfo {
  analysis_id: string;
  label: string;
  layouts: AnalysisLayout[];
  /** option name -> description */
  options: Record<string, string>;
}

export interface AnalysisListResult {
  analyses: AnalysisInfo[];
}
