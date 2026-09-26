import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockEngine } from "@/mocks/engine";
import { useFreshMock } from "@/test/mockTransport";
import { useAdvisor } from "@/stores/advisor";
import { useNav } from "@/stores/nav";
import { usePlanner } from "@/stores/planner";
import { useProjectStore } from "@/stores/project";

vi.mock("@/lib/planner/planIo", async (orig) => ({
  ...(await orig<typeof import("@/lib/planner/planIo")>()),
  pickPlanDocxPath: vi.fn(async () => "/mock/plans/plan.docx"),
}));

let engine: MockEngine;

async function interview(answers: [string, string][]) {
  const p = usePlanner.getState();
  p.setTitle("Reading study");
  p.setResearchQuestion("Does the reading program help?");
  await usePlanner.getState().beginInterview();
  for (const [q, v] of answers) {
    expect(usePlanner.getState().advisorStep?.next_question?.id).toBe(q);
    await usePlanner.getState().answer(q, v);
  }
}

const TO_T_INDEPENDENT: [string, string][] = [
  ["q_intent", "compare"],
  ["q_compare_outcome_level", "continuous"],
  ["q_compare_design", "independent_groups"],
  ["q_compare_between_groups_count", "two"],
];

beforeEach(() => {
  engine = useFreshMock();
  usePlanner.getState().reset();
  useAdvisor.getState().reset();
  useNav.setState({ view: "planner", prev: null });
});

describe("planner store", () => {
  it("asks every question with no dataset and ends on a recommendation", async () => {
    await interview(TO_T_INDEPENDENT);
    const s = usePlanner.getState();
    expect(s.advisorStep?.recommendation?.primary_test).toBe("t_test.independent");
    expect(s.advisorStep?.path.every((p) => p.source === "user")).toBe(true);
    expect(Object.keys(s.questions)).toEqual(expect.arrayContaining(TO_T_INDEPENDENT.map(([q]) => q)));
  });

  it("back undoes the last answer", async () => {
    await interview(TO_T_INDEPENDENT.slice(0, 2));
    await usePlanner.getState().back();
    expect(usePlanner.getState().advisorStep?.next_question?.id).toBe("q_compare_outcome_level");
  });

  it("maps to power.t_test, runs a priori and sensitivity with null dataset ids", async () => {
    await interview(TO_T_INDEPENDENT);
    usePlanner.getState().toPower();
    expect(usePlanner.getState().powerPlan?.powerId).toBe("power.t_test");
    const spy = vi.spyOn(engine, "call");
    expect(await usePlanner.getState().runPower()).toBe(true);
    const req = spy.mock.calls.find(([m]) => m === "analysis.run")![1] as Record<string, unknown>;
    expect(req).toMatchObject({ analysis_id: "power.t_test", dataset_id: null, snapshot_id: null, options: { mode: "a_priori", effect_size: 0.5, design: "independent" } });
    const s = usePlanner.getState();
    expect(s.sensitivityN).toBeGreaterThan(50);
    usePlanner.getState().setSensitivityN(30);
    expect(await usePlanner.getState().runSensitivity()).toBe(true);
    expect(usePlanner.getState().sensitivity?.statistics.find((x) => x.key === "detectable_effect")?.value).toBeGreaterThan(0.6);
  });

  it("shows engine messages for invalid power settings", async () => {
    await interview(TO_T_INDEPENDENT);
    usePlanner.getState().toPower();
    usePlanner.getState().setSettings({ effect: 0 });
    expect(await usePlanner.getState().runPower()).toBe(false);
    expect(usePlanner.getState().powerError).toMatch(/effect size/i);
  });

  it("builds the plan, saves it in the project, exports DOCX and seeds a new project + the advisor", async () => {
    await interview(TO_T_INDEPENDENT);
    usePlanner.getState().toPower();
    await usePlanner.getState().runPower();
    usePlanner.getState().toPlan();
    const plan = usePlanner.getState().plan!;
    expect(plan.planned_analyses[0].analysis_id).toBe("t_test.independent");
    expect(plan.power_analyses[0].outputs?.n_total).toBeGreaterThan(100);

    // Save into an already-named project (no dialog).
    useProjectStore.getState().newProject("Existing");
    useProjectStore.setState({ path: "/mock/projects/Existing.statly" });
    expect(await usePlanner.getState().savePlanToProject()).toBe(true);
    expect(useProjectStore.getState().project?.study_plan?.id).toBe(plan.id);
    expect(useProjectStore.getState().dirty).toBe(false);

    // Export
    const spy = vi.spyOn(engine, "call");
    expect(await usePlanner.getState().exportDocx()).toBe("/mock/plans/plan.docx");
    const params = spy.mock.calls.find(([m]) => m === "export.plan")![1] as { plan: { id: string }; labels: Record<string, string>; interview: unknown[] };
    expect(params.plan.id).toBe(plan.id);
    expect(params.interview).toHaveLength(4);
    expect(params.labels["t_test.independent"]).toBeTruthy();

    // Start a new project from the plan -> import screen, advisor pre-filled.
    expect(await usePlanner.getState().startProjectFromPlan()).toBe(true);
    const proj = useProjectStore.getState().project!;
    expect(proj.name).toBe("Reading study");
    expect(proj.study_plan?.id).toBe(plan.id);
    expect(useNav.getState().view).toBe("import");
    await useAdvisor.getState().start(null);
    expect(useAdvisor.getState().step?.recommendation?.primary_test).toBe("t_test.independent");
    // "Start over" is clean.
    await useAdvisor.getState().start(null);
    expect(useAdvisor.getState().step?.next_question?.id).toBe("q_intent");
  });

  it("loadPlan reopens a saved plan and rebuilds the interview", async () => {
    await interview(TO_T_INDEPENDENT);
    usePlanner.getState().toPower();
    usePlanner.getState().setOption("allocation_ratio", 2);
    await usePlanner.getState().runPower();
    usePlanner.getState().toPlan();
    const saved = structuredClone(usePlanner.getState().plan!);
    usePlanner.getState().reset();
    await usePlanner.getState().loadPlan(saved);
    const s = usePlanner.getState();
    expect(s.step).toBe("plan");
    expect(s.title).toBe("Reading study");
    expect(s.researchQuestion).toBe("Does the reading program help?");
    expect(s.advisorStep?.recommendation?.primary_test).toBe("t_test.independent");
    expect(s.settings.options.allocation_ratio).toBe(2);
    usePlanner.getState().toPlan();
    expect(usePlanner.getState().plan?.power_analyses).toEqual(saved.power_analyses);
  });
});
