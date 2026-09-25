/**
 * Guided analysis (SPEC §7.2): assign variables to the recommended analysis' roles, run it once
 * to get its assumption checks and chart data, walk each assumption one screen at a time, then
 * let the user choose the recommended test or its nonparametric alternative. The chosen run is
 * logged to the Test Log (SPEC §9) and shown on the Results screen.
 */
import { create } from "zustand";
import type { AnalysisRequest, AnalysisResult } from "@/contracts";
import type { AdvisorRecommendation, AnalysisInfo } from "@/lib/analysisRpc";
import { prefillRoles, roleProblem } from "@/lib/datasetContext";
import { labelFor } from "@/lib/content/labels";
import { makeTestLogEntry, newRequestId } from "@/lib/resultSummary";
import { describeRpcError, rpc, RpcErrorCode } from "@/lib/rpc";
import { useDatasetStore } from "@/stores/dataset";
import { useProjectStore } from "@/stores/project";
import { useResults } from "@/stores/results";

export type FlowStage = "roles" | "assumptions" | "decision" | "done";
export type Choice = "recommended" | "alternative";

interface FlowState {
  catalog: AnalysisInfo[] | null;
  recommendation: AdvisorRecommendation | null;
  outcome: string | null;
  /** Analysis being set up (normally recommendation.primary_test). */
  analysisId: string | null;
  layout: string | null;
  roles: Record<string, string[]>;
  stage: FlowStage;
  busy: boolean;
  error: string | null;
  /** First run of `analysisId`: its assumptions drive the walk-through. */
  check: { request: AnalysisRequest; result: AnalysisResult } | null;
  assumptionIndex: number;
  choice: Choice | null;
  /** Test Log entry id of the chosen, logged run. */
  entryId: string | null;

  loadCatalog: () => Promise<AnalysisInfo[]>;
  setup: (rec: AdvisorRecommendation, outcome: string | null) => Promise<void>;
  selectAnalysis: (analysisId: string) => void;
  setLayout: (layout: string) => void;
  setRole: (role: string, names: string[]) => void;
  runCheck: () => Promise<boolean>;
  goAssumption: (index: number) => void;
  choose: (choice: Choice) => Promise<boolean>;
  reset: () => void;
}

const INITIAL = {
  recommendation: null,
  outcome: null,
  analysisId: null,
  layout: null,
  roles: {},
  stage: "roles" as FlowStage,
  busy: false,
  error: null,
  check: null,
  assumptionIndex: 0,
  choice: null,
  entryId: null,
};

export function catalogLabels(catalog: AnalysisInfo[] | null): Record<string, string> {
  return Object.fromEntries((catalog ?? []).map((a) => [a.analysis_id, a.label]));
}

function runError(e: unknown): string {
  if (e && typeof e === "object" && "kind" in e && (e as { kind: string }).kind === "rpc") {
    const err = e as unknown as { code: number; message: string };
    // Plain-language engine messages (e.g. "needs exactly two groups") are shown as is.
    if (err.code === RpcErrorCode.InvalidParams && err.message && !/validation/i.test(err.message)) return err.message;
    if (err.code === RpcErrorCode.StaleOrUnknown) return "Your data changed since this analysis was set up. Please run it again.";
  }
  return describeRpcError(e);
}

export const useAnalysisFlow = create<FlowState>((set, get) => {
  function buildRequest(analysisId: string): AnalysisRequest {
    const meta = useDatasetStore.getState().meta;
    if (!meta) throw new Error("No dataset is loaded.");
    const { roles } = get();
    const variables = Object.fromEntries(Object.entries(roles).filter(([, v]) => v.length));
    return {
      schema_version: 1,
      request_id: newRequestId(),
      analysis_id: analysisId,
      dataset_id: meta.dataset_id,
      snapshot_id: meta.snapshot_id,
      variables,
      subset: [],
      options: {},
      corrections: [],
      alpha: 0.05,
      tails: "two_sided",
      ci_level: 0.95,
    };
  }

  function log(request: AnalysisRequest, result: AnalysisResult): string {
    const label = labelFor(result.analysis_id, catalogLabels(get().catalog));
    const entry = makeTestLogEntry(request, result, label);
    useProjectStore.getState().appendTestLog(entry);
    useResults.getState().put(entry.id, result);
    useResults.getState().show(entry.id);
    return entry.id;
  }

  function prefill(analysisId: string) {
    const meta = useDatasetStore.getState().meta;
    const info = get().catalog?.find((a) => a.analysis_id === analysisId);
    if (!meta || !info) return { layout: null, roles: {} };
    return prefillRoles(info, meta, get().outcome);
  }

  return {
    catalog: null,
    ...INITIAL,

    loadCatalog: async () => {
      const cached = get().catalog;
      if (cached) return cached;
      const res = await rpc.analysisList();
      set({ catalog: res.analyses });
      return res.analyses;
    },

    setup: async (rec, outcome) => {
      set({ ...INITIAL, recommendation: rec, outcome, busy: true });
      try {
        const catalog = await get().loadCatalog();
        const available = (id: string | null) => !!id && catalog.some((a) => a.analysis_id === id);
        const analysisId = available(rec.primary_test)
          ? rec.primary_test
          : available(rec.nonparametric_alternative)
            ? rec.nonparametric_alternative
            : rec.primary_test;
        set({ analysisId, ...prefill(analysisId!), busy: false });
      } catch (e) {
        set({ busy: false, error: describeRpcError(e) });
      }
    },

    selectAnalysis: (analysisId) => set({ analysisId, ...prefill(analysisId), error: null, check: null, stage: "roles" }),

    setLayout: (layout) => {
      const info = get().catalog?.find((a) => a.analysis_id === get().analysisId);
      const l = info?.layouts.find((x) => x.name === layout);
      const roles: Record<string, string[]> = {};
      for (const r of l?.roles ?? []) roles[r.role] = get().roles[r.role] ?? [];
      set({ layout, roles, error: null });
    },

    setRole: (role, names) => set({ roles: { ...get().roles, [role]: names }, error: null }),

    runCheck: async () => {
      const { analysisId, catalog, layout, roles } = get();
      const info = catalog?.find((a) => a.analysis_id === analysisId);
      if (!analysisId || !info) {
        set({ error: "Statly can't run this analysis yet." });
        return false;
      }
      const problem = roleProblem(info.layouts.find((l) => l.name === layout), roles);
      if (problem) {
        set({ error: problem });
        return false;
      }
      set({ busy: true, error: null });
      try {
        const request = buildRequest(analysisId);
        const result = await rpc.analysisRun(request);
        if (result.assumptions.length === 0) {
          // Nothing to check (e.g. a nonparametric test): this run is the chosen one.
          const entryId = log(request, result);
          set({ busy: false, check: { request, result }, choice: "recommended", entryId, stage: "done" });
        } else {
          set({ busy: false, check: { request, result }, assumptionIndex: 0, stage: "assumptions" });
        }
        return true;
      } catch (e) {
        set({ busy: false, error: runError(e) });
        return false;
      }
    },

    goAssumption: (index) => {
      const n = get().check?.result.assumptions.length ?? 0;
      if (index >= n) set({ stage: "decision" });
      else set({ assumptionIndex: Math.max(0, index), stage: "assumptions" });
    },

    choose: async (choice) => {
      const { check, recommendation, catalog, analysisId } = get();
      if (!check) return false;
      if (choice === "recommended") {
        const entryId = log(check.request, check.result);
        set({ choice, entryId, stage: "done" });
        return true;
      }
      const alt = alternativeFor(analysisId, recommendation);
      const info = catalog?.find((a) => a.analysis_id === alt);
      if (!alt || !info) {
        set({ error: "Statly can't run the nonparametric alternative yet." });
        return false;
      }
      // Keep the same variables for the roles the alternative shares (outcome/group, measures...).
      const layout = info.layouts.find((l) => l.roles.every((r) => r.min === 0 || (get().roles[r.role]?.length ?? 0) >= r.min)) ?? info.layouts[0];
      set({ busy: true, error: null });
      try {
        const roles = Object.fromEntries(layout.roles.map((r) => [r.role, get().roles[r.role] ?? []]));
        set({ roles, layout: layout.name });
        const request = buildRequest(alt);
        const result = await rpc.analysisRun(request);
        const entryId = log(request, result);
        set({ busy: false, choice, entryId, stage: "done" });
        return true;
      } catch (e) {
        set({ busy: false, error: runError(e) });
        return false;
      }
    },

    reset: () => set({ ...INITIAL }),
  };
});

/** The nonparametric alternative to offer for the analysis being run. */
export function alternativeFor(analysisId: string | null, rec: AdvisorRecommendation | null): string | null {
  if (!rec || !analysisId) return null;
  return analysisId === rec.primary_test ? rec.nonparametric_alternative : null;
}

/** Statly's gentle recommendation after the assumption walk-through. */
export function suggestedChoice(result: AnalysisResult, hasAlternative: boolean): { choice: Choice; reason: string } {
  const failed = result.assumptions.filter((a) => a.verdict === "failed");
  const caution = result.assumptions.filter((a) => a.verdict === "caution");
  if (!hasAlternative) {
    return { choice: "recommended", reason: failed.length ? "There is no rank-based alternative for this test, so run it and mention the concern when you report it." : "The checks look fine for this test." };
  }
  if (failed.some((a) => a.assumption.startsWith("normality") || a.assumption === "symmetry_of_differences" || a.assumption === "outliers")) {
    const smallest = Math.min(...failed.map((a) => a.applies_to.n ?? Infinity));
    return {
      choice: "alternative",
      reason:
        smallest < 30
          ? "At least one normality check failed and the sample is small, so the rank-based (nonparametric) test is the safer choice."
          : "At least one normality check failed. Look at the plots: if they show clear skew or outliers, the rank-based (nonparametric) test is the safer choice.",
    };
  }
  if (failed.length) {
    const welch = result.analysis_id === "t_test.independent" && failed.every((a) => a.assumption === "homogeneity_of_variance");
    return welch
      ? { choice: "recommended", reason: "The groups' spreads differ, but Statly reports Welch's t, which does not assume equal spread. The recommended test is still a good fit." }
      : { choice: "alternative", reason: "At least one check failed. The rank-based (nonparametric) test makes fewer assumptions, so it is the safer choice here." };
  }
  if (caution.length) {
    return { choice: "recommended", reason: "The checks raised only mild cautions, which are common with larger samples. The recommended test is usually fine here." };
  }
  return { choice: "recommended", reason: "Every check looks reasonable, so the recommended test is a good fit." };
}
