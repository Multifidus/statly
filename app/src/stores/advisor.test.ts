import { beforeEach, describe, expect, it } from "vitest";
import type { MockEngine } from "@/mocks/engine";
import { useFreshMock } from "@/test/mockTransport";
import { useAdvisor } from "@/stores/advisor";
import { useNav } from "@/stores/nav";
import { usePlanner } from "@/stores/planner";
import { useProjectStore } from "@/stores/project";

let engine: MockEngine;

const TO_T_INDEPENDENT: [string, string][] = [
  ["q_intent", "compare"],
  ["q_compare_outcome_level", "continuous"],
  ["q_compare_design", "independent_groups"],
  ["q_compare_between_groups_count", "two"],
];

/** Build and save a study plan into a fresh project, via the same design interview. */
async function saveStudyPlan() {
  const p = usePlanner.getState();
  p.setTitle("Reading study");
  p.setResearchQuestion("Does the reading program help?");
  await usePlanner.getState().beginInterview();
  for (const [q, v] of TO_T_INDEPENDENT) {
    await usePlanner.getState().answer(q, v);
  }
  usePlanner.getState().toPower();
  await usePlanner.getState().runPower();
  usePlanner.getState().toPlan();
  useProjectStore.getState().newProject("Reading study");
  useProjectStore.setState({ path: "/mock/projects/Reading study.statly" });
  await usePlanner.getState().savePlanToProject();
}

beforeEach(() => {
  engine = useFreshMock();
  usePlanner.getState().reset();
  useAdvisor.getState().reset();
  useNav.setState({ view: "advisor", prev: null });
  void engine;
});

describe("advisor store: plan pre-fill hint", () => {
  it("marks answers seeded from a saved plan as planSeeded, and clears one once explicitly answered", async () => {
    await saveStudyPlan();

    await useAdvisor.getState().start(null);
    const s = useAdvisor.getState();
    expect(s.step?.path.length).toBeGreaterThan(0);
    // Every path entry came from the plan's answers, not the dataset (no dataset here).
    expect(s.step?.path.every((p) => p.source === "user")).toBe(true);
    for (const p of s.step!.path) expect(s.planSeeded[p.question]).toBe(true);

    // Explicitly re-answering one question clears its plan-seeded flag.
    const first = s.step!.path[0]!;
    await useAdvisor.getState().answer(first.question, first.value);
    expect(useAdvisor.getState().planSeeded[first.question]).toBeUndefined();
  });

  it("has no planSeeded answers when there is no saved plan in the project", async () => {
    useProjectStore.getState().newProject("No plan here");
    await useAdvisor.getState().start(null);
    expect(useAdvisor.getState().planSeeded).toEqual({});
  });

  it("Start over clears the plan seed (documented as a clean slate)", async () => {
    await saveStudyPlan();
    await useAdvisor.getState().start(null);
    expect(Object.keys(useAdvisor.getState().planSeeded).length).toBeGreaterThan(0);

    await useAdvisor.getState().start(null);
    expect(useAdvisor.getState().planSeeded).toEqual({});
    expect(useAdvisor.getState().step?.next_question?.id).toBe("q_intent");
  });
});
