/**
 * Study Planner (SPEC §11.2), before any data exist:
 *   describe -> design interview (advisor.* with no dataset_context, so every question is asked)
 *   -> power (dataset-free power.* via analysis.run with null ids) -> plan (StudyPlan)
 * The plan can be saved into the open project (ProjectFile.study_plan), exported as DOCX
 * (export.plan), or used to start a new analysis project that pre-fills the Test Advisor.
 */
import { create } from "zustand";
import type { AnalysisRequest, AnalysisResult, PowerInputs, StudyPlan, Tails } from "@/contracts";
import type { AdvisorQuestion, AdvisorRecommendation, AdvisorStep, AnswerValue } from "@/lib/analysisRpc";
import { labelFor } from "@/lib/content/labels";
import { resetAnalysisSession } from "@/lib/analysisSession";
import { exportPlanRpc, pickPlanDocxPath } from "@/lib/planner/planIo";
import { buildPlan, statValue, treeAnswers, type InterviewAnswer, type PowerSettings } from "@/lib/planner/planText";
import { allowsOneSided, BENCHMARKS, powerPlanFor, type PowerPlan } from "@/lib/planner/powerMapping";
import { resolveUnsaved, saveProject } from "@/lib/projectActions";
import { describeRpcError, RpcErrorCode, rpc } from "@/lib/rpc";
import { catalogLabels, useAnalysisFlow } from "@/stores/analysisFlow";
import { useImportFlow } from "@/stores/importFlow";
import { useNav } from "@/stores/nav";
import { useProjectStore } from "@/stores/project";

export type PlannerStep = "describe" | "interview" | "power" | "plan";
export type Status = "idle" | "loading" | "ready" | "error";

export const DEFAULT_SETTINGS: PowerSettings = { effect: 0.5, alpha: 0.05, power: 0.8, tails: "two_sided", options: {}, dropoutPct: 10 };

interface PlannerState {
  step: PlannerStep;
  planId: string;
  createdAt: string;
  title: string;
  researchQuestion: string;

  // Design interview
  status: Status;
  error: string | null;
  answers: Record<string, AnswerValue>;
  advisorStep: AdvisorStep | null;
  questions: Record<string, AdvisorQuestion>;

  // Power
  powerPlan: PowerPlan | null;
  settings: PowerSettings;
  apriori: AnalysisResult | null;
  sensitivity: AnalysisResult | null;
  sensitivityN: number | null;
  powerStatus: Status;
  powerError: string | null;

  /** The plan on screen (built from the steps, or reopened from the project). */
  plan: StudyPlan | null;
  /** Plan reopened from a project (its power results are kept until recalculated). */
  loaded: StudyPlan | null;
  busy: boolean;

  setTitle: (t: string) => void;
  setResearchQuestion: (q: string) => void;
  goTo: (step: PlannerStep) => void;
  beginInterview: () => Promise<void>;
  answer: (questionId: string, value: AnswerValue) => Promise<void>;
  back: () => Promise<void>;
  toPower: () => void;
  setSettings: (patch: Partial<PowerSettings>) => void;
  setOption: (key: string, value: string | number) => void;
  runPower: () => Promise<boolean>;
  setSensitivityN: (n: number | null) => void;
  runSensitivity: () => Promise<boolean>;
  toPlan: () => void;
  savePlanToProject: () => Promise<boolean>;
  exportDocx: () => Promise<string | null>;
  startProjectFromPlan: () => Promise<boolean>;
  /** Show a saved plan (e.g. `ProjectFile.study_plan`) and rebuild the interview behind it. */
  loadPlan: (plan: StudyPlan) => Promise<void>;
  reset: () => void;
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? `plan_${crypto.randomUUID()}` : `plan_${Math.random().toString(36).slice(2)}${Date.now()}`;

function initial() {
  return {
    step: "describe" as PlannerStep,
    planId: newId(),
    createdAt: new Date().toISOString(),
    title: "",
    researchQuestion: "",
    status: "idle" as Status,
    error: null,
    answers: {},
    advisorStep: null,
    questions: {},
    powerPlan: null,
    settings: { ...DEFAULT_SETTINGS },
    apriori: null,
    sensitivity: null,
    sensitivityN: null,
    powerStatus: "idle" as Status,
    powerError: null,
    plan: null,
    loaded: null,
    busy: false,
  };
}

/** Engine InvalidParams messages from power.* are plain language; show them as is. */
function powerError(e: unknown): string {
  if (e && typeof e === "object" && "kind" in e && (e as { kind: string }).kind === "rpc") {
    const err = e as unknown as { code: number; message: string };
    if (err.code === RpcErrorCode.InvalidParams && err.message && !/validation|contract/i.test(err.message)) return err.message;
  }
  return describeRpcError(e);
}

export function powerRequest(plan: PowerPlan, s: PowerSettings, mode: "a_priori" | "sensitivity", n?: number): AnalysisRequest {
  const tails: Tails = allowsOneSided(plan.powerId) ? s.tails : "two_sided";
  const options: Record<string, unknown> = { ...s.options, mode, power: s.power };
  if (mode === "a_priori") options.effect_size = s.effect;
  else options.n = n;
  return {
    schema_version: 1,
    request_id: `plan-${mode}-${Date.now().toString(36)}`,
    analysis_id: plan.powerId,
    dataset_id: null,
    snapshot_id: null,
    variables: {},
    subset: [],
    options,
    corrections: [],
    alpha: s.alpha,
    tails,
    ci_level: 0.95,
  };
}

/** What the sensitivity `n` counts for this power analysis. */
export function nMeaning(plan: PowerPlan, options: Record<string, string | number>): "per group" | "pairs" | "people" | "in total" {
  if (plan.powerId === "power.t_test") return options.design === "independent" ? "per group" : options.design === "paired" ? "pairs" : "people";
  if (plan.powerId === "power.anova") return options.design === "one_way" ? "per group" : "in total";
  return "in total";
}

/** Default sensitivity n from an a priori result (the planned n in the same units). */
function defaultSensitivityN(result: AnalysisResult | null): number | null {
  return statValue(result, "n_required");
}

/** Design options stored in a saved plan's PowerInputs, back in power.* option names. */
function optionsFromInputs(plan: PowerPlan, i: PowerInputs | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!i) return out;
  const put = (k: string, v: number | null | undefined) => {
    if (v !== null && v !== undefined) out[k] = v;
  };
  if (plan.powerId === "power.t_test") put("allocation_ratio", i.allocation_ratio);
  if (plan.powerId === "power.anova") {
    put("groups", i.n_groups);
    put("measurements", i.n_measurements);
    put("correlation", i.correlation_among_measures);
    put("epsilon", i.nonsphericity_epsilon);
  }
  if (plan.powerId === "power.regression") put("predictors", i.n_predictors);
  return out;
}

let seq = 0;

export const usePlanner = create<PlannerState>((set, get) => {
  /** Evaluate the interview and fill in texts of every question on the path. */
  async function evaluate(answers: Record<string, AnswerValue>) {
    const token = ++seq;
    set({ status: "loading", error: null, answers });
    try {
      const step = Object.keys(answers).length ? await rpc.advisorAnswer({ answers }) : await rpc.advisorStart({});
      if (token !== seq) return;
      const questions = { ...get().questions };
      if (step.next_question) questions[step.next_question.id] = step.next_question;
      const before: Record<string, AnswerValue> = {};
      for (const p of step.path) {
        if (!questions[p.question]) {
          const view = await rpc.advisorAnswer({ answers: { ...before } });
          if (token !== seq) return;
          if (view.next_question?.id === p.question) questions[p.question] = view.next_question;
        }
        before[p.question] = p.value;
      }
      set({ advisorStep: step, questions, status: "ready" });
    } catch (e) {
      if (token === seq) set({ status: "error", error: describeRpcError(e) });
    }
  }

  function labels(): Record<string, string> {
    return catalogLabels(useAnalysisFlow.getState().catalog);
  }

  function interviewAnswers(): InterviewAnswer[] {
    const { advisorStep, questions } = get();
    return (advisorStep?.path ?? []).map((p) => {
      const q = questions[p.question];
      return { question: p.question, value: p.value, text: q?.text ?? p.question, label: q?.options.find((o) => o.value === p.value)?.label ?? String(p.value) };
    });
  }

  function recommendation(): AdvisorRecommendation | null {
    return get().advisorStep?.recommendation ?? null;
  }

  function currentPlan(): StudyPlan {
    const s = get();
    const plan = buildPlan({
      id: s.planId,
      title: s.title,
      researchQuestion: s.researchQuestion,
      createdAt: s.createdAt,
      now: new Date().toISOString(),
      interview: interviewAnswers(),
      advice: recommendation(),
      labels: labels(),
      power: s.powerPlan ? { plan: s.powerPlan, settings: s.settings, apriori: s.apriori, sensitivity: s.sensitivity } : null,
      keptPower: s.loaded?.power_analyses,
      keptDropoutPct: s.settings.dropoutPct,
    });
    // A reopened plan whose interview couldn't be rebuilt keeps its stored design and analyses.
    if (s.loaded && !recommendation()) {
      return { ...plan, design: s.loaded.design, planned_analyses: s.loaded.planned_analyses, recommendations: s.loaded.recommendations };
    }
    return plan;
  }

  /** Display labels for every id the plan mentions (sent with export.plan). */
  function exportLabels(plan: StudyPlan): Record<string, string> {
    const cat = labels();
    const out: Record<string, string> = {};
    for (const a of plan.planned_analyses) {
      for (const id of [a.analysis_id, a.nonparametric_alternative, a.effect_size, ...a.assumptions_to_check, ...a.follow_ups]) {
        if (id) out[id] = labelFor(id, cat);
      }
    }
    for (const p of plan.power_analyses) out[p.analysis_id] = labelFor(p.analysis_id, cat);
    return out;
  }

  return {
    ...initial(),

    setTitle: (title) => set({ title }),
    setResearchQuestion: (researchQuestion) => set({ researchQuestion }),
    goTo: (step) => {
      if (step === "plan") get().toPlan();
      else set({ step });
    },

    beginInterview: async () => {
      set({ step: "interview" });
      if (!get().advisorStep) await evaluate(get().answers);
    },

    answer: async (questionId, value) => {
      const kept: Record<string, AnswerValue> = {};
      for (const p of get().advisorStep?.path ?? []) {
        if (p.question === questionId) break;
        kept[p.question] = p.value;
      }
      kept[questionId] = value;
      await evaluate(kept);
    },

    back: async () => {
      const path = get().advisorStep?.path ?? [];
      if (!path.length) return;
      const kept: Record<string, AnswerValue> = {};
      for (const p of path.slice(0, -1)) kept[p.question] = p.value;
      await evaluate(kept);
    },

    toPower: () => {
      const rec = recommendation();
      if (!rec) return;
      const next = powerPlanFor(rec.primary_test, get().answers);
      const prev = get().powerPlan;
      const same = prev && prev.powerId === next.powerId && JSON.stringify(prev.options) === JSON.stringify(next.options);
      if (same) {
        set({ step: "power" });
        return;
      }
      const s = get().settings;
      const effect = prev?.metric === next.metric ? s.effect : BENCHMARKS[next.metric].medium;
      set({
        step: "power",
        powerPlan: next,
        settings: { ...s, effect, tails: allowsOneSided(next.powerId) ? s.tails : "two_sided", options: { ...next.options } },
        apriori: null,
        sensitivity: null,
        sensitivityN: null,
        powerStatus: "idle",
        powerError: null,
      });
    },

    setSettings: (patch) => set({ settings: { ...get().settings, ...patch } }),
    setOption: (key, value) => set({ settings: { ...get().settings, options: { ...get().settings.options, [key]: value } } }),

    runPower: async () => {
      const { powerPlan, settings } = get();
      if (!powerPlan) return false;
      set({ powerStatus: "loading", powerError: null });
      try {
        const res = await rpc.analysisRun(powerRequest(powerPlan, settings, "a_priori"));
        set({ apriori: res, sensitivity: null, powerStatus: "ready", sensitivityN: get().sensitivityN ?? defaultSensitivityN(res) });
        return true;
      } catch (e) {
        set({ powerStatus: "error", powerError: powerError(e) });
        return false;
      }
    },

    setSensitivityN: (sensitivityN) => set({ sensitivityN }),

    runSensitivity: async () => {
      const { powerPlan, settings, sensitivityN } = get();
      if (!powerPlan || !sensitivityN) return false;
      set({ powerStatus: "loading", powerError: null });
      try {
        const res = await rpc.analysisRun(powerRequest(powerPlan, settings, "sensitivity", sensitivityN));
        set({ sensitivity: res, powerStatus: "ready" });
        return true;
      } catch (e) {
        set({ powerStatus: "error", powerError: powerError(e) });
        return false;
      }
    },

    toPlan: () => set({ step: "plan", plan: currentPlan() }),

    savePlanToProject: async () => {
      const plan = get().plan ?? currentPlan();
      set({ plan, busy: true });
      try {
        const ps = useProjectStore.getState();
        if (!ps.project) ps.newProject(plan.title);
        useProjectStore.getState().updateProject((p) => ({ ...p, study_plan: plan }));
        return await saveProject();
      } finally {
        set({ busy: false });
      }
    },

    exportDocx: async () => {
      const plan = get().plan ?? currentPlan();
      set({ plan });
      const path = await pickPlanDocxPath(plan.title);
      if (!path) return null;
      set({ busy: true });
      try {
        const interview = interviewAnswers().map((a) => ({ question: a.text, answer: a.label }));
        const res = await exportPlanRpc({ plan, labels: exportLabels(plan), interview, format: "docx", path, overwrite: true });
        return res.path;
      } finally {
        set({ busy: false });
      }
    },

    startProjectFromPlan: async () => {
      const plan = get().plan ?? currentPlan();
      if (!(await resolveUnsaved("Start a new project from this plan"))) return false;
      useImportFlow.getState().reset();
      resetAnalysisSession();
      useProjectStore.getState().newProject(plan.title);
      useProjectStore.getState().updateProject((p) => ({ ...p, study_plan: plan }));
      useNav.getState().go("import");
      return true;
    },

    loadPlan: async (plan) => {
      seq++;
      const answers = treeAnswers(plan.design.answers);
      const rq = plan.design.answers.planner_research_question;
      const pa = plan.power_analyses.find((p) => p.mode === "a_priori") ?? plan.power_analyses[0];
      set({
        ...initial(),
        step: "plan",
        planId: plan.id,
        createdAt: plan.created_at,
        title: plan.title,
        researchQuestion: typeof rq === "string" ? rq : "",
        plan,
        loaded: plan,
        settings: pa
          ? { ...DEFAULT_SETTINGS, alpha: pa.inputs.alpha, power: pa.inputs.power ?? DEFAULT_SETTINGS.power, tails: pa.inputs.tails, effect: pa.inputs.effect_size ?? DEFAULT_SETTINGS.effect }
          : { ...DEFAULT_SETTINGS },
      });
      if (Object.keys(answers).length) {
        await evaluate(answers);
        const rec = recommendation();
        if (rec) {
          const pp = powerPlanFor(rec.primary_test, answers);
          set({ powerPlan: pp, settings: { ...get().settings, options: { ...pp.options, ...optionsFromInputs(pp, pa?.inputs) } } });
        }
      }
    },

    reset: () => {
      seq++;
      set({ ...initial() });
    },
  };
});

/** Plan in the open project, if any. */
export function projectPlan(): StudyPlan | null {
  return useProjectStore.getState().project?.study_plan ?? null;
}
