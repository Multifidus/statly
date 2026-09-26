/**
 * Test Log families (SPEC §9): group related logged tests and apply the correction the user
 * chose. Adjusted p-values come from the engine (`corrections.adjust`, identical to R p.adjust)
 * and are stored on each member entry (family_id, correction_method, adjusted_p) with the family
 * in ProjectFile.test_families, so they are saved, autosaved and reopened with the project.
 * Nothing here runs automatically: every change starts from a user action.
 */
import { create } from "zustand";
import type { AnalysisRequest, AnalysisResult, CorrectionMethod, TestFamily, TestLogEntry } from "@/contracts";
import { makeTestLogEntry } from "@/lib/resultSummary";
import { describeRpcError, rpc } from "@/lib/rpc";
import { eligibility, newFamilyId } from "@/lib/testFamilies";
import { useProjectStore } from "@/stores/project";
import { useResults } from "@/stores/results";

/** Log one chosen analysis run: Test Log entry + full result (pushed to the engine for saving). */
export function logRun(request: AnalysisRequest, result: AnalysisResult, label: string): TestLogEntry {
  const entry = makeTestLogEntry(request, result, label);
  useProjectStore.getState().appendTestLog(entry);
  useResults.getState().put(entry.id, result, { persist: true });
  return entry;
}

export interface FamilyInput {
  name: string;
  memberIds: string[];
  method: CorrectionMethod;
}

interface TestLogState {
  /** Suggestion keys the user dismissed this session. */
  dismissed: string[];
  busy: boolean;
  error: string | null;
  /** Create a family (or replace one when `id` is given). Returns its id, or null on error. */
  saveFamily: (input: FamilyInput, id?: string) => Promise<string | null>;
  /** Change a family's method; re-adjusts its members at once. */
  setMethod: (familyId: string, method: CorrectionMethod) => Promise<boolean>;
  /** Remove the family; its tests go back to uncorrected. */
  ungroup: (familyId: string) => void;
  dismiss: (key: string) => void;
  reset: () => void;
}

/** Latest request per family; an older response that resolves late is dropped. */
const seq = new Map<string, number>();

function cleared(e: TestLogEntry): TestLogEntry {
  return { ...e, family_id: null, correction_method: "none", adjusted_p: null };
}

export const useTestLog = create<TestLogState>((set, get) => ({
  dismissed: [],
  busy: false,
  error: null,

  saveFamily: async ({ name, memberIds, method }, id) => {
    const project = useProjectStore.getState().project;
    if (!project) return null;
    const trimmed = name.trim();
    const members = project.test_log.filter((e) => memberIds.includes(e.id) && eligibility(e).ok);
    if (!trimmed) {
      set({ error: "Give the family a name." });
      return null;
    }
    if (members.length < 2) {
      set({ error: "A family needs at least two tests that each have a p-value." });
      return null;
    }
    const familyId = id ?? newFamilyId(project.test_families);
    const token = (seq.get(familyId) ?? 0) + 1;
    seq.set(familyId, token);
    set({ busy: true, error: null });
    let adjusted: (number | null)[];
    try {
      adjusted =
        method === "none"
          ? members.map(() => null)
          : (await rpc.correctionsAdjust({ p_values: members.map((e) => e.result_summary.p), method })).adjusted;
    } catch (e) {
      if (seq.get(familyId) === token) set({ busy: false, error: describeRpcError(e) });
      return null;
    }
    if (seq.get(familyId) !== token) return familyId; // superseded by a newer change
    const byId = new Map(members.map((e, i) => [e.id, adjusted[i]]));
    const family: TestFamily = { id: familyId, name: trimmed };
    useProjectStore.getState().updateProject((p) => ({
      ...p,
      test_families: p.test_families.some((f) => f.id === familyId)
        ? p.test_families.map((f) => (f.id === familyId ? family : f))
        : [...p.test_families, family],
      test_log: p.test_log.map((e) =>
        byId.has(e.id)
          ? { ...e, family_id: familyId, correction_method: method, adjusted_p: method === "none" ? null : (byId.get(e.id) ?? null) }
          : e.family_id === familyId
            ? cleared(e)
            : e,
      ),
    }));
    set({ busy: false });
    return familyId;
  },

  setMethod: async (familyId, method) => {
    const project = useProjectStore.getState().project;
    const family = project?.test_families.find((f) => f.id === familyId);
    if (!project || !family) return false;
    const memberIds = project.test_log.filter((e) => e.family_id === familyId).map((e) => e.id);
    return (await get().saveFamily({ name: family.name, memberIds, method }, familyId)) !== null;
  },

  ungroup: (familyId) => {
    seq.set(familyId, (seq.get(familyId) ?? 0) + 1);
    useProjectStore.getState().updateProject((p) => ({
      ...p,
      test_families: p.test_families.filter((f) => f.id !== familyId),
      test_log: p.test_log.map((e) => (e.family_id === familyId ? cleared(e) : e)),
    }));
  },

  dismiss: (key) => set({ dismissed: [...get().dismissed, key] }),
  reset: () => set({ dismissed: [], busy: false, error: null }),
}));
