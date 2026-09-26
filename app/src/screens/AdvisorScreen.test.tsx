import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MockEngine } from "@/mocks/engine";
import { useFreshMock } from "@/test/mockTransport";
import { AdvisorScreen } from "@/screens/AdvisorScreen";
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

async function saveStudyPlan() {
  const p = usePlanner.getState();
  p.setTitle("Reading study");
  p.setResearchQuestion("Does the reading program help?");
  await usePlanner.getState().beginInterview();
  for (const [q, v] of TO_T_INDEPENDENT) await usePlanner.getState().answer(q, v);
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

describe("AdvisorScreen: plan pre-fill hint", () => {
  it("shows 'Filled in from your plan' for answers seeded from a saved study plan", async () => {
    await saveStudyPlan();
    render(<AdvisorScreen />);
    const item = await screen.findByTestId("path-q_intent");
    expect(item).toHaveTextContent("Filled in from your plan");
    expect(screen.queryByText("Filled in from your data")).not.toBeInTheDocument();
  });

  it("does not show the plan hint when there is no saved plan (answers are the person's own)", async () => {
    useProjectStore.getState().newProject("No plan here");
    render(<AdvisorScreen />);
    await screen.findByTestId("advisor-question");
    expect(screen.queryByTestId("advisor-path")).not.toBeInTheDocument();
    expect(screen.queryByText("Filled in from your plan")).not.toBeInTheDocument();
  });
});
