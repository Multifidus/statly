import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TOUR_STEPS } from "./steps";

async function freshImports() {
  return { Tour: (await import("./Tour")).Tour, useOnboarding: (await import("./store")).useOnboarding };
}

describe("onboarding tour", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("shows on first run (nothing in localStorage yet)", async () => {
    const { Tour } = await freshImports();
    render(<Tour />);
    expect(screen.getByTestId("onboarding-tour")).toBeInTheDocument();
    expect(screen.getByText(TOUR_STEPS[0].title)).toBeInTheDocument();
  });

  it("never shows again after being dismissed (persisted under statly.onboarding)", async () => {
    const { Tour, useOnboarding } = await freshImports();
    const { unmount } = render(<Tour />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("tour-skip"));
    expect(localStorage.getItem("statly.onboarding")).toBe("done");
    expect(useOnboarding.getState().open).toBe(false);
    unmount();

    // Simulate a fresh app load: re-import the store so it re-reads localStorage.
    vi.resetModules();
    localStorage.setItem("statly.onboarding", "done");
    const { Tour: Tour2 } = await freshImports();
    render(<Tour2 />);
    expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument();
  });

  it("advances through steps with Next and finishes by persisting dismissal", async () => {
    const { Tour, useOnboarding } = await freshImports();
    render(<Tour />);
    const user = userEvent.setup();
    for (let i = 0; i < TOUR_STEPS.length - 1; i++) {
      expect(screen.getByText(TOUR_STEPS[i].title)).toBeInTheDocument();
      await user.click(screen.getByTestId("tour-next"));
    }
    expect(screen.getByText(TOUR_STEPS[TOUR_STEPS.length - 1].title)).toBeInTheDocument();
    await user.click(screen.getByTestId("tour-next"));
    expect(useOnboarding.getState().open).toBe(false);
    expect(localStorage.getItem("statly.onboarding")).toBe("done");
  });

  it("can be re-launched via start() after being dismissed", async () => {
    const { Tour, useOnboarding } = await freshImports();
    render(<Tour />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("tour-skip"));
    expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument();

    act(() => useOnboarding.getState().start());
    expect(screen.getByTestId("onboarding-tour")).toBeInTheDocument();
    expect(screen.getByText(TOUR_STEPS[0].title)).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const { Tour, useOnboarding } = await freshImports();
    render(<Tour />);
    const user = userEvent.setup();
    await user.keyboard("{Escape}");
    expect(useOnboarding.getState().open).toBe(false);
  });
});
