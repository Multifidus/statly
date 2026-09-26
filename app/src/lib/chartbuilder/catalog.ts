/**
 * What each chart type needs (SPEC §10.2) and the "What do you want to show?" helper.
 * Requirements mirror the engine's checks in engine/statly_engine/charts so the builder can explain
 * what is missing before asking the engine.
 */
import type { ChartSpec, ChartType, VariableSchema } from "@/contracts";
import type { ShelfName } from "@/lib/chartbuilder/types";

export type VarKind = "number" | "category";

export interface ShelfRule {
  /** Shown on the shelf when it is empty. */
  hint: string;
  accepts: VarKind | "any";
  max: number;
}

export interface ChartTypeInfo {
  type: ChartType;
  label: string;
  description: string;
  source: "dataset" | "analysis";
  errorBars: boolean;
  shelves: Partial<Record<ShelfName, ShelfRule>>;
}

const group = (hint: string, max = 1): ShelfRule => ({ hint, accepts: "category", max });
const score = (hint: string, max = 1): ShelfRule => ({ hint, accepts: "number", max });
const COLOR = group("Optional: split into colored groups");
const FACET = group("Optional: one small chart per group", 2);

export const CHART_TYPES: ChartTypeInfo[] = [
  { type: "bar", label: "Bar chart with error bars", description: "Average score for each group, with SE, SD or 95% CI bars.", source: "dataset", errorBars: true,
    shelves: { x: group("A grouping (e.g. condition)"), y: score("The score to average", 20), color: COLOR, facet: FACET } },
  { type: "grouped_bar", label: "Grouped bar chart", description: "Averages for two groupings side by side (e.g. condition x time).", source: "dataset", errorBars: true,
    shelves: { x: group("First grouping"), y: score("The score to average"), color: group("Second grouping"), facet: FACET } },
  { type: "line", label: "Line chart over time", description: "Average score at each time point, with error bars.", source: "dataset", errorBars: true,
    shelves: { x: group("Time (e.g. Pre/Post)"), y: score("The score to average", 20), color: COLOR, facet: FACET } },
  { type: "interaction", label: "Interaction plot", description: "Do the lines run parallel? Shows how one factor's effect depends on another.", source: "dataset", errorBars: true,
    shelves: { x: group("First factor"), y: score("The score to average"), color: group("Second factor (one line each)"), facet: FACET } },
  { type: "box", label: "Box plot", description: "Median, middle 50% and unusual scores for each group.", source: "dataset", errorBars: false,
    shelves: { x: group("Optional: a grouping"), y: score("The score"), color: COLOR, facet: FACET } },
  { type: "violin", label: "Violin plot", description: "The shape of each group's scores, with a box plot inside.", source: "dataset", errorBars: false,
    shelves: { x: group("Optional: a grouping"), y: score("The score"), color: COLOR, facet: group("Optional: one row per group") } },
  { type: "histogram", label: "Histogram", description: "How often each range of scores occurs.", source: "dataset", errorBars: false,
    shelves: { x: score("The score"), color: COLOR, facet: FACET } },
  { type: "density", label: "Density plot", description: "A smooth outline of the distribution; good for comparing groups.", source: "dataset", errorBars: false,
    shelves: { x: score("The score"), color: COLOR, facet: FACET } },
  { type: "qq", label: "Q-Q plot", description: "Checks whether scores follow a normal curve: points near the line = roughly normal.", source: "dataset", errorBars: false,
    shelves: { x: score("The score"), color: COLOR, facet: FACET } },
  { type: "scatter", label: "Scatter plot with fit line", description: "How two scores move together, with a straight (or smooth) trend line.", source: "dataset", errorBars: false,
    shelves: { x: score("First score"), y: score("Second score"), color: COLOR, facet: FACET } },
  { type: "correlation_heatmap", label: "Correlation heatmap", description: "Correlations between many scores or items at once.", source: "dataset", errorBars: false,
    shelves: { x: { hint: "Two or more scores or items", accepts: "number", max: 60 } } },
  { type: "likert_diverging", label: "Likert diverging bars", description: "Agree vs disagree for each survey item, centred on neutral.", source: "dataset", errorBars: false,
    shelves: { y: { hint: "One or more Likert items", accepts: "any", max: 60 }, facet: FACET } },
  { type: "stacked_bar", label: "Stacked bar chart", description: "Counts in each category, stacked. Or several items on Y.", source: "dataset", errorBars: false,
    shelves: { x: group("A grouping (or leave empty and put items on Y)"), y: { hint: "Optional: several survey items", accepts: "any", max: 60 }, color: group("The category to stack"), facet: FACET } },
  { type: "percent_bar", label: "Percent (100%) bar chart", description: "The share of each category within each group.", source: "dataset", errorBars: false,
    shelves: { x: group("A grouping (or leave empty and put items on Y)"), y: { hint: "Optional: several survey items", accepts: "any", max: 60 }, color: group("The category to stack"), facet: FACET } },
  { type: "scree", label: "Scree plot", description: "Eigenvalues from a factor analysis, with the parallel-analysis cut-off.", source: "analysis", errorBars: false, shelves: {} },
  { type: "cfa_path", label: "CFA path diagram", description: "The factors, their items and standardized loadings.", source: "analysis", errorBars: false, shelves: {} },
];

export const CHART_INFO: Record<ChartType, ChartTypeInfo> = Object.fromEntries(CHART_TYPES.map((c) => [c.type, c])) as Record<ChartType, ChartTypeInfo>;

export type Goal = "compare_groups" | "change_over_time" | "distribution" | "relationship" | "survey_items" | "reliability";

export const GOALS: { goal: Goal; label: string; question: string; types: ChartType[] }[] = [
  { goal: "compare_groups", label: "Compare groups", question: "Do groups differ on a score?", types: ["bar", "grouped_bar", "box", "violin"] },
  { goal: "change_over_time", label: "Change over time", question: "Did scores go up or down between time points?", types: ["line", "interaction", "grouped_bar"] },
  { goal: "distribution", label: "Distribution", question: "What do the scores look like? Are they normal?", types: ["histogram", "density", "box", "qq"] },
  { goal: "relationship", label: "Relationship", question: "Do two scores go together?", types: ["scatter", "correlation_heatmap"] },
  { goal: "survey_items", label: "Survey items", question: "How did people answer each item?", types: ["likert_diverging", "percent_bar", "stacked_bar"] },
  { goal: "reliability", label: "Reliability / validity", question: "Do the items hang together as a scale?", types: ["correlation_heatmap", "scree", "cfa_path"] },
];

export function varKind(v: VariableSchema): VarKind {
  const numeric = v.dtype === "integer" || v.dtype === "float" || v.dtype === "boolean";
  if (!numeric) return "category";
  return v.level === "continuous" || v.value_labels.length === 0 || v.role === "likert_item" ? "number" : "category";
}

/** Whether `v` may go on `shelf` for this chart type (Likert items count as both). */
export function accepts(rule: ShelfRule | undefined, v: VariableSchema): boolean {
  if (!rule) return false;
  if (rule.accepts === "any") return true;
  const numeric = v.dtype === "integer" || v.dtype === "float" || v.dtype === "boolean";
  if (rule.accepts === "number") return numeric;
  return v.level !== "continuous" || v.role === "likert_item" || v.value_labels.length > 0 || !numeric;
}

/** A plain-language reason the chart can't be drawn yet, or null when it is ready. */
export function missingPiece(spec: ChartSpec): string | null {
  const s = spec.shelves;
  const t = spec.chart_type;
  if (CHART_INFO[t].source === "analysis") return spec.source.test_log_entry_id ? null : "Choose a saved factor analysis from the Test Log.";
  switch (t) {
    case "bar":
    case "line":
      return s.y.length ? (t === "line" && !s.x.length && s.y.length < 2 ? "Drag the time variable to X." : null) : "Drag a score to Y.";
    case "grouped_bar":
    case "interaction":
      if (!s.y.length) return "Drag a score to Y.";
      return s.x.length && s.color.length ? null : "Drag one grouping to X and another to Color/Group.";
    case "box":
    case "violin":
      return s.y.length || s.x.length ? null : "Drag a score to Y.";
    case "histogram":
    case "density":
    case "qq":
      return s.x.length || s.y.length ? null : "Drag a score to X.";
    case "scatter":
      return s.x.length && s.y.length ? null : "Drag one score to X and another to Y.";
    case "correlation_heatmap":
      return s.x.length + s.y.length >= 2 ? null : "Drag two or more scores or items to X.";
    case "likert_diverging":
      return s.y.length || s.x.length ? null : "Drag one or more Likert items to Y.";
    case "stacked_bar":
    case "percent_bar":
      return s.y.length || s.x.length ? null : "Drag a grouping to X (and a category to Color), or items to Y.";
    default:
      return null;
  }
}

const byRole = (vars: VariableSchema[], ...roles: string[]) => vars.filter((v) => roles.includes(v.role) && !v.is_metadata);
const field = (v: VariableSchema, aggregate: "none" | "mean" = "none") => ({ variable: v.name, aggregate });

/** Sensible starting shelves for a chart type from the variables' roles (the helper's "Try it"). */
export function suggestShelves(type: ChartType, vars: VariableSchema[]): ChartSpec["shelves"] {
  const time = byRole(vars, "time")[0];
  const groups = byRole(vars, "group");
  const scores = byRole(vars, "scale_score", "test_total");
  const numbers = scores.length ? scores : vars.filter((v) => !v.is_metadata && varKind(v) === "number" && v.role !== "identifier");
  const items = byRole(vars, "likert_item");
  const g1 = groups[0] ?? time;
  const g2 = groups[0] && time ? time : groups[1];
  const shelves: ChartSpec["shelves"] = { x: [], y: [], color: [], facet: [] };
  const sc = numbers[0];
  switch (type) {
    case "bar":
    case "box":
    case "violin":
      if (g1) shelves.x = [field(g1)];
      if (sc) shelves.y = [field(sc, type === "bar" ? "mean" : "none")];
      break;
    case "grouped_bar":
    case "interaction":
    case "line": {
      const x = type === "line" ? (time ?? g1) : g1;
      const other = type === "line" ? (groups[0] && groups[0] !== x ? groups[0] : undefined) : x === g1 ? g2 : g1;
      if (x) shelves.x = [field(x)];
      if (other && other !== x) shelves.color = [field(other)];
      if (sc) shelves.y = [field(sc, "mean")];
      break;
    }
    case "histogram":
    case "density":
    case "qq":
      if (sc) shelves.x = [field(sc)];
      break;
    case "scatter":
      if (numbers[0]) shelves.x = [field(numbers[0])];
      if (numbers[1]) shelves.y = [field(numbers[1])];
      break;
    case "correlation_heatmap":
      shelves.x = (items.length >= 2 ? items : numbers).slice(0, 12).map((v) => field(v));
      break;
    case "likert_diverging":
      shelves.y = items.slice(0, 20).map((v) => field(v));
      if (time) shelves.facet = [field(time)];
      break;
    case "stacked_bar":
    case "percent_bar":
      if (items.length) shelves.y = items.slice(0, 20).map((v) => field(v));
      else if (g1 && g2) {
        shelves.x = [field(g1)];
        shelves.color = [field(g2)];
      }
      break;
  }
  return shelves;
}
