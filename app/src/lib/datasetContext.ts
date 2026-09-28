/**
 * Derive the Test Advisor's `dataset_context` (docs/PROTOCOL.md) from variable roles, levels,
 * stacking and link mode, plus sensible variable pre-fills for an analysis' roles.
 */
import type { DatasetMeta, MeasurementLevel, VariableSchema } from "@/contracts";
import type { AnalysisInfo, AnalysisLayout, DatasetContext, OutcomeLevel } from "@/lib/analysisRpc";
import { rpc } from "@/lib/rpc";

const OUTCOME_ROLES = ["scale_score", "test_total", "likert_item", "test_item"] as const;
// open_text: free-form answers (the engine already tags high-cardinality text this way on
// import, qualtrics.py looks_open_text) are never a usable outcome. identifier/group/time/ignore
// are structural roles, never the thing being analysed.
const NEVER_OUTCOME = new Set(["identifier", "group", "time", "open_text", "ignore"]);

const byOrder = (a: VariableSchema, b: VariableSchema) => a.display_order - b.display_order;

/** Outcome dropdown group, in display order. */
export type OutcomeGroup = "scores" | "ratings" | "categories" | "other";

export function outcomeGroupOf(v: VariableSchema): OutcomeGroup {
  if (v.role === "scale_score" || v.role === "test_total") return "scores";
  if (v.role === "likert_item" || (v.role === "test_item" && v.level === "ordinal") || v.level === "ordinal") return "ratings";
  if (v.level === "nominal") return "categories";
  return "other";
}

export const OUTCOME_GROUP_LABELS: Record<OutcomeGroup, string> = {
  scores: "Scores",
  ratings: "Ratings and Likert items",
  categories: "Yes/no and categories",
  other: "Other",
};

const OUTCOME_GROUP_ORDER: OutcomeGroup[] = ["scores", "ratings", "categories", "other"];

/**
 * Variables a student might compare/relate as their outcome: every non-system variable except
 * free text and structural/ID roles (NEVER_OUTCOME above) and metadata columns. Includes
 * categorical (yes/no, pass/fail, nominal) variables so chi-square/Fisher/McNemar/Cochran's Q
 * paths get a proper outcome, not just scores and rating items.
 */
export function outcomeCandidates(meta: DatasetMeta): VariableSchema[] {
  const rank = (v: VariableSchema) => {
    const i = (OUTCOME_ROLES as readonly string[]).indexOf(v.role);
    return i >= 0 ? i : OUTCOME_ROLES.length;
  };
  return meta.variables
    .filter((v) => !v.is_metadata && !NEVER_OUTCOME.has(v.role) && v.dtype !== "datetime")
    .sort((a, b) => rank(a) - rank(b) || byOrder(a, b));
}

/** Group outcome candidates into the dropdown's optgroups, in display order, omitting empty groups. */
export function groupedOutcomeCandidates(meta: DatasetMeta): { group: OutcomeGroup; label: string; variables: VariableSchema[] }[] {
  const candidates = outcomeCandidates(meta);
  return OUTCOME_GROUP_ORDER.map((group) => ({
    group,
    label: OUTCOME_GROUP_LABELS[group],
    variables: candidates.filter((v) => outcomeGroupOf(v) === group),
  })).filter((g) => g.variables.length > 0);
}

/**
 * Candidates for the correlation branch's "Which other variable?" picker: the same grouped list
 * as the outcome dropdown, minus the outcome itself (SPEC/QA-38 #39).
 */
export function groupedSecondVariableCandidates(meta: DatasetMeta, outcome: string | null): { group: OutcomeGroup; label: string; variables: VariableSchema[] }[] {
  return groupedOutcomeCandidates(meta)
    .map((g) => ({ ...g, variables: g.variables.filter((v) => v.name !== outcome) }))
    .filter((g) => g.variables.length > 0);
}

export function outcomeLevelOf(v: VariableSchema): OutcomeLevel {
  if (v.role === "scale_score" || v.role === "test_total") return "continuous";
  const lvl: MeasurementLevel = v.level;
  return lvl;
}

/**
 * "What kind of variables are you relating?" (content/decision_tree.yaml q_relate_variable_types)
 * answered from both variables' levels, once known (QA-38 #39). Only "both continuous" and
 * "either ordinal" are safe to guess this way: a nominal variable (categorical/binary) always
 * needs the person to say so explicitly, so this returns null rather than a wrong guess.
 */
export function relateLevelGuess(outcomeLevel: OutcomeLevel | undefined, secondLevel: OutcomeLevel | undefined): "continuous_continuous" | "ordinal_involved" | null {
  if (!outcomeLevel || !secondLevel) return null;
  if (outcomeLevel === "ordinal" || secondLevel === "ordinal") return "ordinal_involved";
  if (outcomeLevel === "continuous" && secondLevel === "continuous") return "continuous_continuous";
  return null;
}

export function timeVariable(meta: DatasetMeta): string | null {
  return meta.stacking?.time_variable ?? meta.variables.find((v) => v.role === "time")?.name ?? null;
}

export function groupVariables(meta: DatasetMeta): VariableSchema[] {
  return meta.variables.filter((v) => v.role === "group").sort(byOrder);
}

export function subjectIdVariable(meta: DatasetMeta): string | null {
  return meta.link.id_variable ?? meta.variables.find((v) => v.role === "identifier" && !v.is_metadata)?.name ?? null;
}

/** Number of distinct non-missing values; value labels when declared, else read the column. */
export async function countLevels(meta: DatasetMeta, name: string): Promise<number> {
  const v = meta.variables.find((x) => x.name === name);
  if (!v) return 0;
  if (v.value_labels.length) return v.value_labels.length;
  if (name === meta.stacking?.time_variable) return meta.stacking.levels.length;
  const seen = new Set<string>();
  for (let offset = 0; offset < meta.n_rows; offset += 2000) {
    const page = await rpc.rows({ dataset_id: meta.dataset_id, snapshot_id: meta.snapshot_id, offset, limit: 2000, columns: [name], sort: null });
    for (const r of page.rows) if (r[0] !== null && r[0] !== "") seen.add(String(r[0]));
  }
  return seen.size;
}

/**
 * @param second The correlation branch's second variable (QA-38 #39), once the "Which other
 * variable?" picker has one. Without it, `second_distinct` falls back to the outcome's own
 * distinct count (the old behavior, still right for every non-correlation branch) and
 * `second_level` is left unset.
 */
export async function deriveDatasetContext(meta: DatasetMeta, outcome: string | null, second?: string | null): Promise<DatasetContext> {
  const ctx: DatasetContext = {};
  const out = outcome ? meta.variables.find((v) => v.name === outcome) : undefined;
  if (out) ctx.outcome_level = outcomeLevelOf(out);
  const groups = groupVariables(meta);
  ctx.num_groups = groups.length ? await countLevels(meta, groups[0].name) : 1;
  const time = timeVariable(meta);
  ctx.num_time_points = meta.stacking ? meta.stacking.levels.length : time ? await countLevels(meta, time) : 1;
  if (meta.stacking || time) ctx.linked_mode = meta.link.mode === "linked";
  if (out) {
    // Small samples and few-distinct-value (single rating item) outcomes both make ties
    // common, which the correlation branch's "small sample or tied ranks?" question uses
    // to auto-answer itself (content/decision_tree.yaml: q_relate_ordinal_detail).
    ctx.n_complete = meta.missing_summary.find((m) => m.variable === outcome)?.n_valid ?? undefined;
    ctx.outcome_distinct = await countLevels(meta, out.name);
    const sec = second ? meta.variables.find((v) => v.name === second) : undefined;
    if (sec) {
      ctx.second_distinct = await countLevels(meta, sec.name);
      ctx.second_level = outcomeLevelOf(sec);
    } else {
      // The correlation branch's second variable isn't known yet, so fall back to the
      // outcome's own distinct count.
      ctx.second_distinct = ctx.outcome_distinct;
    }
  }
  return ctx;
}

export interface RolePrefill {
  layout: string;
  roles: Record<string, string[]>;
}

/** Pick the layout whose required roles we can fill best, and fill them from the variable roles. */
export function prefillRoles(info: AnalysisInfo, meta: DatasetMeta, outcome: string | null, second?: string | null): RolePrefill {
  const time = timeVariable(meta);
  const group = groupVariables(meta)[0]?.name ?? null;
  const subject = subjectIdVariable(meta);
  const out = outcome ? meta.variables.find((v) => v.name === outcome) : undefined;
  const scale = out?.scale_id ? meta.scales.find((s) => s.id === out.scale_id) : undefined;
  const scaleOfScore = meta.scales.find((s) => s.score_variable === outcome);
  const items = (scaleOfScore ?? scale)?.items ?? [];

  const guess = (role: string): string[] => {
    switch (role) {
      case "outcome":
      case "variable":
      case "row":
      case "x":
        // Correlation's first variable (roles x/y, engine/statly_engine/stats/correlation.py) is
        // the outcome chosen up front; the second variable is its own role, below.
        return outcome ? [outcome] : [];
      case "y":
        return second ? [second] : [];
      case "column":
        // Chi-square/Fisher's exact (roles row/column, engine/statly_engine/stats/categorical.py):
        // the outcome is the row, the dataset's group variable is the column.
        return group ? [group] : [];
      case "group":
      case "binary":
        // Aggregate pre/post: time points are compared as independent groups (SPEC §5.4).
        return group ? [group] : time && meta.link.mode !== "linked" ? [time] : [];
      case "between":
        // Mixed ANOVA's between-subjects factor is always a real grouping variable, never the
        // within-subjects time factor (unlike "group"/"binary" above).
        return group ? [group] : [];
      case "time":
        return time ? [time] : [];
      case "subject_id":
        return subject ? [subject] : [];
      case "items":
      case "variables":
        return items.length ? [...items] : outcome ? [outcome] : [];
      default:
        return [];
    }
  };

  const score = (l: AnalysisLayout) => l.roles.filter((r) => r.min > 0 && guess(r.role).length >= r.min).length - l.roles.filter((r) => r.min > 0).length;
  const layout = [...info.layouts].sort((a, b) => score(b) - score(a))[0] ?? info.layouts[0];
  const roles: Record<string, string[]> = {};
  for (const r of layout?.roles ?? []) {
    const g = guess(r.role);
    roles[r.role] = r.max === null ? g : g.slice(0, r.max);
  }
  return { layout: layout?.name ?? "default", roles };
}

/** Plain-language problem with a role assignment, or null when it fits the layout. */
export function roleProblem(layout: AnalysisLayout | undefined, roles: Record<string, string[]>): string | null {
  if (!layout) return "Choose how your data is laid out.";
  for (const r of layout.roles) {
    const n = roles[r.role]?.length ?? 0;
    if (n < r.min) return r.min === 1 ? `Choose a variable for "${roleLabel(r.role)}".` : `Choose at least ${r.min} variables for "${roleLabel(r.role)}".`;
    if (r.max !== null && n > r.max) return `Choose at most ${r.max} variable(s) for "${roleLabel(r.role)}".`;
  }
  const used = layout.roles.flatMap((r) => roles[r.role] ?? []);
  if (new Set(used).size !== used.length) return "Use each variable in only one role.";
  return null;
}

const ROLE_LABELS: Record<string, string> = {
  outcome: "Outcome (scores)",
  group: "Groups to compare",
  time: "Time point",
  subject_id: "Participant ID",
  measures: "Measurements",
  items: "Items",
  variables: "Variables",
  covariates: "Control for",
  x: "First variable",
  y: "Second variable",
  row: "Rows",
  column: "Columns",
  binary: "Two-category variable",
  variable: "Variable",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role.replace(/_/g, " ");
}

/**
 * Suggested value to compare a one-sample test against: the midpoint of the outcome's response
 * scale (response_range, falling back to the span of its value_labels' codes), when derivable.
 * Used so a one-sample t test / Wilcoxon test never runs against a silent default of 0.
 */
export function suggestTestValue(meta: DatasetMeta, outcome: string | null): { value: number; note: string } | null {
  const v = outcome ? meta.variables.find((x) => x.name === outcome) : undefined;
  if (!v) return null;
  let lo: number | null = null;
  let hi: number | null = null;
  if (v.response_range) {
    lo = v.response_range.min;
    hi = v.response_range.max;
  } else {
    const codes = v.value_labels.map((l) => l.value).filter((x): x is number => typeof x === "number");
    if (codes.length >= 2) {
      lo = Math.min(...codes);
      hi = Math.max(...codes);
    }
  }
  if (lo === null || hi === null || lo >= hi) return null;
  const mid = (lo + hi) / 2;
  return { value: mid, note: `Suggested: ${mid}, the middle of a ${lo}–${hi} scale` };
}
