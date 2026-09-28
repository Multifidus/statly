import type { ImportIssue, WarningSeverity } from "@/contracts";

/** One line to render in StepDetect: either a single ImportIssue passed through, or several
 * ImportIssues that differed only by column name, collapsed into one line naming all of them. */
export interface DisplayIssue {
  severity: WarningSeverity;
  message: string;
  columns: string[];
}

/** Codes whose message is exactly `'<column>' <singular verb> <rest>`, where <rest> is identical
 * across columns when the issues describe the same underlying fact (e.g. the same missing-value
 * code). Grouping is explicit per code rather than generic grammar guessing: an unlisted code, or
 * one whose message doesn't start with the expected `'<column>' <verb>` prefix, is left ungrouped. */
const GROUPABLE_CODES: Record<string, { singular: string; plural: string }> = {
  missing_code_suggested: { singular: "contains", plural: "contain" },
  noncontiguous_codes: { singular: "uses", plural: "use" },
  choice_text_detected: { singular: "contains", plural: "contain" },
  multiselect_detected: { singular: "looks like", plural: "look like" },
};

function stripColumnQuoted(message: string, column: string, verb: string): string | null {
  const prefix = `'${column}' ${verb} `;
  return message.startsWith(prefix) ? message.slice(prefix.length) : null;
}

/** A name's trailing run of digits, split from its prefix (e.g. "Q5_1" -> {prefix: "Q5_", num: 1}). */
function trailingNumber(name: string): { prefix: string; num: number } | null {
  const m = /^(.*?)(\d+)$/.exec(name);
  if (!m) return null;
  return { prefix: m[1], num: parseInt(m[2], 10) };
}

/** Collapses consecutive numbered runs ("Q5_1".."Q5_6") into "Q5_1 to Q5_6"; names that don't
 * continue a run (like a lone "Q6") are kept as-is. */
function collapseRuns(columns: string[]): string[] {
  const out: string[] = [];
  let runStart = 0;
  for (let i = 1; i <= columns.length; i++) {
    const prev = trailingNumber(columns[i - 1]);
    const cur = i < columns.length ? trailingNumber(columns[i]) : null;
    const continues = !!(prev && cur && cur.prefix === prev.prefix && cur.num === prev.num + 1);
    if (!continues) {
      out.push(i - runStart >= 2 ? `${columns[runStart]} to ${columns[i - 1]}` : columns[runStart]);
      runStart = i;
    }
  }
  return out;
}

/** "A", "A and B", or "A, B, and C" (Oxford comma) after collapsing numbered runs. */
export function formatColumns(columns: string[]): string {
  const items = collapseRuns(columns);
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** Groups ImportIssue entries that differ only by column name into one DisplayIssue per group,
 * in first-occurrence order. A group needs 2+ members to be rendered as one line; a lone issue
 * (or one whose code isn't in GROUPABLE_CODES, or has no column) passes through unchanged. */
export function groupImportIssues(issues: ImportIssue[]): DisplayIssue[] {
  const indexByKey = new Map<string, number>();
  type Pending =
    | { kind: "single"; severity: WarningSeverity; message: string; columns: string[] }
    | { kind: "group"; severity: WarningSeverity; rest: string; plural: string; columns: string[]; firstMessage: string };
  const pending: Pending[] = [];

  for (const issue of issues) {
    const spec = issue.column ? GROUPABLE_CODES[issue.code] : undefined;
    const rest = spec && issue.column ? stripColumnQuoted(issue.message, issue.column, spec.singular) : null;
    if (spec && issue.column && rest !== null) {
      const key = `${issue.code}::${issue.severity}::${rest}`;
      const idx = indexByKey.get(key);
      if (idx !== undefined) {
        (pending[idx] as { kind: "group"; columns: string[] }).columns.push(issue.column);
      } else {
        indexByKey.set(key, pending.length);
        pending.push({ kind: "group", severity: issue.severity, rest, plural: spec.plural, columns: [issue.column], firstMessage: issue.message });
      }
    } else {
      pending.push({ kind: "single", severity: issue.severity, message: issue.message, columns: issue.column ? [issue.column] : [] });
    }
  }

  return pending.map((p) => {
    if (p.kind === "single") return { severity: p.severity, message: p.message, columns: p.columns };
    if (p.columns.length < 2) return { severity: p.severity, message: p.firstMessage, columns: p.columns };
    return { severity: p.severity, message: `${formatColumns(p.columns)} ${p.plural} ${p.rest}`, columns: p.columns };
  });
}
