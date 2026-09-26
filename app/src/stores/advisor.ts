/**
 * Test Advisor flow (SPEC §7.1): one question at a time from the engine's decision tree.
 * The engine is stateless, so this store holds the explicit answers and sends the full set on
 * every `advisor.answer`. Questions the dataset answered (`path[].source === "auto"`) are shown
 * pre-filled and can be overridden, which turns them into explicit answers.
 */
import { create } from "zustand";
import type { AdvisorQuestion, AdvisorStep, AnswerValue, DatasetContext } from "@/lib/analysisRpc";
import { deriveDatasetContext, outcomeCandidates } from "@/lib/datasetContext";
import { describeRpcError, rpc } from "@/lib/rpc";
import { useDatasetStore } from "@/stores/dataset";
import { useProjectStore } from "@/stores/project";
import { treeAnswers } from "@/lib/planner/planText";

export type AdvisorStatus = "idle" | "loading" | "ready" | "error";

interface AdvisorState {
  status: AdvisorStatus;
  error: string | null;
  /** Outcome variable the context was derived from (null = none chosen / no data). */
  outcome: string | null;
  context: DatasetContext;
  /** Explicit (user) answers, question id -> value. */
  answers: Record<string, AnswerValue>;
  step: AdvisorStep | null;
  /** Question text/options for every question seen, including auto-answered ones. */
  questions: Record<string, AdvisorQuestion>;

  start: (outcome?: string | null) => Promise<void>;
  setOutcome: (outcome: string | null) => Promise<void>;
  answer: (questionId: string, value: AnswerValue) => Promise<void>;
  /** Undo the most recent explicit answer. */
  back: () => Promise<void>;
  reset: () => void;
}

const INITIAL = {
  status: "idle" as AdvisorStatus,
  error: null,
  outcome: null,
  context: {},
  answers: {},
  step: null,
  questions: {},
};

let seq = 0;

/**
 * Study Planner seed (SPEC §11.2): the first advisor run in a project that carries a study plan
 * starts from the plan's interview answers (once per project + plan; "Start over" is clean).
 */
let seededFor: string | null = null;
function planSeed(): Record<string, AnswerValue> {
  const p = useProjectStore.getState().project;
  const plan = p?.study_plan;
  if (!p || !plan) return {};
  const k = `${p.project_id}:${plan.id}`;
  if (seededFor === k) return {};
  seededFor = k;
  return treeAnswers(plan.design.answers);
}

export const useAdvisor = create<AdvisorState>((set, get) => {
  /** Apply a step, then fetch the question view of any auto-answered question not seen yet. */
  async function apply(step: AdvisorStep, token: number) {
    if (token !== seq) return;
    const questions = { ...get().questions };
    if (step.next_question) questions[step.next_question.id] = step.next_question;
    const before: Record<string, AnswerValue> = {};
    for (const p of step.path) {
      if (p.source === "auto" && !questions[p.question]) {
        // Pure engine: with only the earlier answers and no context, this question is next.
        const view = await rpc.advisorAnswer({ answers: { ...before } });
        if (token !== seq) return;
        if (view.next_question?.id === p.question) questions[p.question] = view.next_question;
      }
      before[p.question] = p.value;
    }
    set({ step, questions, status: "ready", error: null });
  }

  async function evaluate(answers: Record<string, AnswerValue>) {
    const token = ++seq;
    set({ status: "loading", error: null, answers });
    try {
      const { context } = get();
      const step = Object.keys(answers).length
        ? await rpc.advisorAnswer({ answers, dataset_context: context })
        : await rpc.advisorStart({ dataset_context: context });
      await apply(step, token);
    } catch (e) {
      if (token === seq) set({ status: "error", error: describeRpcError(e) });
    }
  }

  return {
    ...INITIAL,

    start: async (outcome) => {
      const meta = useDatasetStore.getState().meta;
      const chosen = outcome !== undefined ? outcome : meta ? (outcomeCandidates(meta)[0]?.name ?? null) : null;
      set({ ...INITIAL, status: "loading", outcome: chosen });
      try {
        const context = meta ? await deriveDatasetContext(meta, chosen) : {};
        set({ context });
      } catch (e) {
        set({ status: "error", error: describeRpcError(e) });
        return;
      }
      await evaluate(planSeed());
    },

    setOutcome: async (outcome) => {
      const meta = useDatasetStore.getState().meta;
      const answers = get().answers;
      set({ outcome, status: "loading" });
      try {
        const context = meta ? await deriveDatasetContext(meta, outcome) : {};
        set({ context });
      } catch (e) {
        set({ status: "error", error: describeRpcError(e) });
        return;
      }
      await evaluate(answers);
    },

    answer: async (questionId, value) => {
      // Keep only answers given before this question on the current path; later ones may no
      // longer apply once this answer changes the branch.
      const path = get().step?.path ?? [];
      const kept: Record<string, AnswerValue> = {};
      for (const p of path) {
        if (p.question === questionId) break;
        if (p.source === "user") kept[p.question] = p.value;
      }
      kept[questionId] = value;
      await evaluate(kept);
    },

    back: async () => {
      const path = get().step?.path ?? [];
      const lastUser = [...path].reverse().find((p) => p.source === "user");
      if (!lastUser) return;
      const kept: Record<string, AnswerValue> = {};
      for (const p of path) {
        if (p.question === lastUser.question) break;
        if (p.source === "user") kept[p.question] = p.value;
      }
      await evaluate(kept);
    },

    reset: () => {
      seq++;
      set({ ...INITIAL });
    },
  };
});

/** Label of the option chosen for a path step (falls back to the raw value). */
export function answerLabel(q: AdvisorQuestion | undefined, value: AnswerValue): string {
  return q?.options.find((o) => o.value === value)?.label ?? String(value);
}
