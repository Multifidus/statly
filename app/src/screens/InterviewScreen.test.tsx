import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useFreshMock } from "@/test/mockTransport";
import { InterviewScreen } from "@/screens/InterviewScreen";
import { useNav } from "@/stores/nav";

beforeEach(() => {
  useFreshMock();
  useNav.setState({ view: "interview", prev: null });
});

describe("InterviewScreen: empty state", () => {
  it("shows a friendly empty state and sends the person to Import when there's no dataset", async () => {
    const user = userEvent.setup();
    render(<InterviewScreen />);
    expect(screen.getByTestId("interview-empty-state")).toHaveTextContent(/no dataset yet/i);
    await user.click(screen.getByRole("button", { name: /import a file/i }));
    expect(useNav.getState().view).toBe("import");
  });
});
