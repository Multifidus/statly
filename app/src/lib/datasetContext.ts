/**
 * Derive the Test Advisor's `dataset_context` (docs/PROTOCOL.md) from variable roles, levels,
 * stacking and link mode, plus sensible variable pre-fills for an analysis' roles.
 */
import type { DatasetMeta, MeasurementLevel, VariableSchema } from "@/contracts";
import type { AnalysisInfo, AnalysisLayout, DatasetContext, OutcomeLevel } from "@/lib/analysisRpc";
import { rpc } from "@/lib/rpc";

const OUTCOME_ROLES = ["scale_score", "test_total", "likert_item", "test_item"] as const;
const NEVER_OUTCOME = new Set(["identifier", "group", "time", "open_text", "ignore"]);

const byOrder = (a: VariableSchema, b: VariableSchema) => a.display_order - b.display_order;

/** Variables a student might compare/relate, most likely first (scale scores and totals). */
export function outcomeCandidates(meta: DatasetMeta): VariableSchema[] {
  const rank = (v: VariableSchema) => {
    const i = (OUTCOME_ROLES as readonly string[]).indexOf(v.role);
    return i >= 0 ? i : OUTCOME_ROLES.length;
  };
  return meta.variables
    .filter((v) => !v.is_metadata && !NEVER_OUTCOME.has(v.role) && v.dtype !== "datetime")
    .filter((v) => v.role !== "unassigned" || v.level === "continuous" || v.dtype !== "string")
    .sort((a, b) => rank(a) - rank(b) || byOrder(a, b));
}

export function outcomeLevelOf(v: VariableSchema): OutcomeLevel {
  if (v.role === "scale_score" || v.role === "test_total") return "continuous";
  const lvl: MeasurementLevel = v.level;
  return lvl;
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

export async function deriveDatasetContext(meta: DatasetMeta, outcome: string | null): Promise<DatasetContext> {
  const ctx: DatasetContext = {};
  const out = outcome ? meta.variables.find((v) => v.name === outcome) : undefined;
  if (out) ctx.outcome_level = outcomeLevelOf(out);
  const groups = groupVariables(meta);
  ctx.num_groups = groups.length ? await countLevels(meta, groups[0].name) : 1;
  const time = timeVariable(meta);
  ctx.num_time_points = meta.stacking ? meta.stacking.levels.length : time ? await countLevels(meta, time) : 1;
  if (meta.stacking || time) ctx.linked_mode = meta.link.mode === "linked";
  return ctx;
}

export interface RolePrefill {
  layout: string;
  roles: Record<string, string[]>;
}

/** Pick the layout whose required roles we can fill best, and fill them from the variable roles. */
export function prefillRoles(info: AnalysisInfo, meta: DatasetMeta, outcome: string | null): RolePrefill {
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
      case "y":
      case "variable":
        return outcome ? [outcome] : [];
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
