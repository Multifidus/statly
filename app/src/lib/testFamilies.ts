/**
 * Test Log families (SPEC §9): which logged tests can be grouped, when Statly suggests a family,
 * and the plain-language explanation of each correction. Pure; the store is stores/testLog.ts.
 * Statly never corrects automatically: suggestions only open the grouping dialog.
 */
import type { CorrectionMethod, TestFamily, TestLogEntry } from "@/contracts";

export type ChosenMethod = Exclude<CorrectionMethod, "none">;

export const METHOD_ORDER: ChosenMethod[] = ["holm", "bonferroni", "fdr_bh"];

export interface MethodInfo {
  label: string;
  /** Prefix for the adjusted value: "Holm-adjusted p". */
  adjective: string;
  /** What it does, in one or two sentences. */
  what: string;
  /** When to choose it. */
  when: string;
}

// Wording follows content/learn/posthoc/multiple_comparisons.md.
export const METHOD_INFO: Record<ChosenMethod, MethodInfo> = {
  holm: {
    label: "Holm",
    adjective: "Holm-adjusted",
    what:
      "A step-down version of Bonferroni. It checks the smallest p-value against the strictest bar, then relaxes the bar a little for each next one. It keeps the same protection against any false positive as Bonferroni but finds more real effects.",
    when: "Usually the best default when you have a handful of related tests and want strong protection against even one false alarm.",
  },
  bonferroni: {
    label: "Bonferroni",
    adjective: "Bonferroni-adjusted",
    what:
      "Multiplies each p-value by the number of tests (the same as dividing alpha by it). The simplest and strictest correction.",
    when: "Fine for two or three tests or when a reviewer expects it. With many tests it becomes so strict that you will likely miss real effects.",
  },
  fdr_bh: {
    label: "Benjamini-Hochberg (FDR)",
    adjective: "FDR-adjusted",
    what:
      "Controls the false discovery rate: the expected share of false positives among the results you call significant, rather than the chance of any false positive at all.",
    when:
      "Better when you have many tests, like every item on a long survey, and can accept a few false positives in exchange for finding more real effects.",
  },
};

/** Chance of at least one false positive across k independent tests when nothing is going on. */
export function familywiseErrorRate(k: number, alpha = 0.05): number {
  return 1 - Math.pow(1 - alpha, Math.max(0, k));
}

export type Eligibility = { ok: true } | { ok: false; reason: string };

/** Post hoc tests keep their built-in corrections; tests with no single p-value can't be adjusted. */
export function eligibility(entry: TestLogEntry): Eligibility {
  if (entry.request.analysis_id.startsWith("posthoc.")) {
    return {
      ok: false,
      reason: "Post hoc comparisons already correct for the pairs they compare, so they aren't added to a family.",
    };
  }
  if (entry.result_summary.p === null) {
    return { ok: false, reason: "This analysis has no single p-value to adjust." };
  }
  return { ok: true };
}

export interface FamilySuggestion {
  /** Stable for the same member set; dismissing a key hides it until the set changes. */
  key: string;
  reason: "outcome" | "analysis";
  /** e.g. "3 tests look at Q3_1." */
  message: string;
  suggestedName: string;
  memberIds: string[];
}

const snapshotOf = (e: TestLogEntry) => `${e.request.dataset_id ?? ""}@${e.request.snapshot_id ?? ""}`;

/**
 * Suggest a family when 2+ logged tests that are not yet in a family share an outcome variable, or
 * use the same analysis, on the same dataset snapshot. Identical member sets are suggested once
 * (outcome reason first). Dismissed keys are skipped.
 */
export function suggestFamilies(log: TestLogEntry[], dismissed: readonly string[] = []): FamilySuggestion[] {
  const free = log.filter((e) => e.family_id === null && eligibility(e).ok);
  const groups = new Map<string, { reason: FamilySuggestion["reason"]; name: string; ids: string[] }>();
  const add = (k: string, reason: FamilySuggestion["reason"], name: string, id: string) => {
    const g = groups.get(k) ?? { reason, name, ids: [] };
    if (!g.ids.includes(id)) g.ids.push(id);
    groups.set(k, g);
  };
  for (const e of free) {
    for (const v of e.result_summary.outcome_variables) add(`o|${snapshotOf(e)}|${v}`, "outcome", v, e.id);
    add(`a|${snapshotOf(e)}|${e.request.analysis_id}`, "analysis", e.result_summary.analysis_label, e.id);
  }
  const out: FamilySuggestion[] = [];
  const seen = new Set<string>();
  const ordered = [...groups.values()].sort((a, b) => (a.reason === b.reason ? 0 : a.reason === "outcome" ? -1 : 1));
  for (const g of ordered) {
    if (g.ids.length < 2) continue;
    const ids = log.filter((e) => g.ids.includes(e.id)).map((e) => e.id); // log order
    const key = `${g.reason}:${[...ids].sort().join(",")}`;
    const setKey = [...ids].sort().join(",");
    if (seen.has(setKey) || dismissed.includes(key)) continue;
    seen.add(setKey);
    out.push({
      key,
      reason: g.reason,
      memberIds: ids,
      message:
        g.reason === "outcome"
          ? `${ids.length} tests look at the same outcome, ${g.name}.`
          : `${ids.length} ${g.name} tests were run on the same data.`,
      suggestedName: g.reason === "outcome" ? `Tests of ${g.name}` : `${g.name} tests`,
    });
  }
  return out;
}

export function familyMembers(log: TestLogEntry[], familyId: string): TestLogEntry[] {
  return log.filter((e) => e.family_id === familyId);
}

export function familyMethod(log: TestLogEntry[], familyId: string): CorrectionMethod {
  return familyMembers(log, familyId)[0]?.correction_method ?? "none";
}

export function newFamilyId(existing: TestFamily[]): string {
  const taken = new Set(existing.map((f) => f.id));
  for (let i = existing.length + 1; ; i++) if (!taken.has(`fam_${i}`)) return `fam_${i}`;
}

/** "Holm-adjusted" for a family's method; null when not corrected. */
export function adjustedLabel(method: CorrectionMethod): string | null {
  return method === "none" ? null : METHOD_INFO[method].adjective;
}
