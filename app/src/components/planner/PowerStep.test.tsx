import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MockEngine } from "@/mocks/engine";
import { useFreshMock } from "@/test/mockTransport";
import { PowerStep } from "@/components/planner/PowerStep";
import { usePlanner } from "@/stores/planner";

let engine: MockEngine;

const TO_T_INDEPENDENT: [string, string][] = [
  ["q_intent", "compare"],
  ["q_compare_outcome_level", "continuous"],
  ["q_compare_design", "independent_groups"],
  ["q_compare_between_groups_count", "two"],
];

beforeEach(() => {
  engine = useFreshMock();
  usePlanner.getState().reset();
  void engine;
});

describe("PowerStep: effect-size explanation", () => {
  it("always shows the shout-vs-whisper explainer under the effect-size picker", async () => {
    usePlanner.getState().setTitle("Reading study");
    usePlanner.getState().setResearchQuestion("Does it help?");
    await usePlanner.getState().beginInterview();
    for (const [q, v] of TO_T_INDEPENDENT) await usePlanner.getState().answer(q, v);
    usePlanner.getState().toPower();

    render(<PowerStep />);

    const explainer = screen.getByTestId("effect-size-explainer");
    expect(explainer).toHaveTextContent("The bigger the effect you expect, the fewer people you need to detect it.");
    expect(explainer).toHaveTextContent("Think of a shout versus a whisper");
  });

  it("captions the other-effect-sizes table to explain why n rises as effect shrinks", async () => {
    usePlanner.getState().setTitle("Reading study");
    usePlanner.getState().setResearchQuestion("Does it help?");
    await usePlanner.getState().beginInterview();
    for (const [q, v] of TO_T_INDEPENDENT) await usePlanner.getState().answer(q, v);
    usePlanner.getState().toPower();
    await usePlanner.getState().runPower();

    render(<PowerStep />);

    await screen.findByTestId("power-benchmarks");
    expect(screen.getByText("Notice how the number rises as the effect gets smaller.")).toBeInTheDocument();
  });
});
