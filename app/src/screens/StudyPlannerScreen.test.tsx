import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MockEngine } from "@/mocks/engine";
import { useFreshMock } from "@/test/mockTransport";
import { StudyPlannerScreen } from "@/screens/StudyPlannerScreen";
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

/** Build and save a plan into `title`'s own project (mock save path, no dialog needed). */
async function saveStudyPlan(title: string) {
  const p = usePlanner.getState();
  p.setTitle(title);
  p.setResearchQuestion("Does it help?");
  await usePlanner.getState().beginInterview();
  for (const [q, v] of TO_T_INDEPENDENT) await usePlanner.getState().answer(q, v);
  usePlanner.getState().toPower();
  await usePlanner.getState().runPower();
  usePlanner.getState().toPlan();
  useProjectStore.getState().newProject(title);
  useProjectStore.setState({ path: `/mock/projects/${title}.statly` });
  await usePlanner.getState().savePlanToProject();
  return usePlanner.getState().plan!;
}

beforeEach(() => {
  engine = useFreshMock();
  usePlanner.getState().reset();
  useNav.setState({ view: "planner", prev: null });
  void engine;
});

describe("StudyPlannerScreen: empty state", () => {
  it("shows the 'describe your study' onboarding form and a way to start when there's no plan", () => {
    render(<StudyPlannerScreen />);
    expect(screen.getByText(/plan your study before you collect data/i)).toBeInTheDocument();
    expect(screen.getByTestId("plan-title-input")).toHaveValue("");
    expect(screen.getByTestId("planner-begin")).toBeDisabled();
  });
});

describe("StudyPlannerScreen: guard against silently replacing an unsaved plan", () => {
  it("loads the project's saved plan straight away when the planner is blank", async () => {
    const saved = await saveStudyPlan("Project A");
    usePlanner.getState().reset(); // fresh planner, nothing unsaved
    render(<StudyPlannerScreen />);
    await screen.findByTestId("plan-view");
    expect(screen.getByTestId("plan-title")).toHaveTextContent(saved.title);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("asks before replacing an unsaved in-progress plan, and Cancel keeps it on screen", async () => {
    const saved = await saveStudyPlan("Project A");
    usePlanner.getState().reset();
    usePlanner.getState().setTitle("My other in-progress plan"); // unsaved, dirty

    const user = userEvent.setup();
    render(<StudyPlannerScreen />);

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/replace your in-progress plan/i);

    await user.click(screen.getByTestId("replace-plan-cancel"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("plan-title-input")).toHaveValue("My other in-progress plan");
    expect(usePlanner.getState().plan?.title).not.toBe(saved.title);
  });

  it("asks before replacing an unsaved in-progress plan, and confirming shows the saved plan", async () => {
    const saved = await saveStudyPlan("Project A");
    usePlanner.getState().reset();
    usePlanner.getState().setTitle("My other in-progress plan");

    const user = userEvent.setup();
    render(<StudyPlannerScreen />);

    await screen.findByRole("alertdialog");
    await user.click(screen.getByTestId("replace-plan-confirm"));

    await screen.findByTestId("plan-view");
    expect(screen.getByTestId("plan-title")).toHaveTextContent(saved.title);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
