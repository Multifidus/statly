import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MockEngine } from "@/mocks/engine";
import { useFreshMock } from "@/test/mockTransport";
import { AdvisorScreen, contextSummary } from "@/screens/AdvisorScreen";
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

describe("contextSummary", () => {
  it("always shows the response count", () => {
    expect(contextSummary({ n_complete: 300 })).toContain("300 responses");
  });

  it("shows the distinct-values/ties clause for a continuous outcome", () => {
    const text = contextSummary({ outcome_level: "continuous", outcome_distinct: 2, n_complete: 300 });
    expect(text).toContain("2 distinct values, so ties are common");
  });

  it("shows the distinct-values/ties clause for an ordinal outcome", () => {
    const text = contextSummary({ outcome_level: "ordinal", outcome_distinct: 5, n_complete: 300 });
    expect(text).toContain("5 distinct values, so ties are common");
  });

  it("omits the distinct-values/ties clause for a yes/no (nominal, 2-level) outcome", () => {
    const text = contextSummary({ outcome_level: "nominal", outcome_distinct: 2, n_complete: 300 });
    expect(text).toContain("300 responses");
    expect(text).not.toContain("distinct value");
    expect(text).not.toContain("ties");
  });

  it("omits the distinct-values/ties clause for a category (nominal) outcome", () => {
    const text = contextSummary({ outcome_level: "nominal", outcome_distinct: 4, n_complete: 300 });
    expect(text).not.toContain("distinct value");
  });
});

describe("AdvisorScreen: QuestionForm inline hint and option descriptions", () => {
  it("shows the question hint and each option's description inline, not only behind Why does this matter?", async () => {
    render(<AdvisorScreen />);
    const question = await screen.findByTestId("advisor-question");
    expect(question).toHaveTextContent("Different questions call for different statistical tests");
    expect(question).toHaveTextContent("For example, comparing test scores before and after a workshop");
    expect(question).toHaveTextContent("For example, whether hours studied is related to exam score");
  });
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
