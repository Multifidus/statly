import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useFreshMock } from "@/test/mockTransport";
import { DataScreen } from "@/screens/DataScreen";
import { useImportFlow } from "@/stores/importFlow";
import { useNav } from "@/stores/nav";

beforeEach(() => {
  useFreshMock();
  useNav.setState({ view: "data", prev: null });
});

describe("DataScreen: empty state", () => {
  it("shows a friendly empty state and sends the person to Import when there's no dataset", async () => {
    const user = userEvent.setup();
    render(<DataScreen />);
    expect(screen.getByTestId("data-empty-state")).toHaveTextContent(/no data yet/i);
    await user.click(screen.getByRole("button", { name: /import a file/i }));
    expect(useNav.getState().view).toBe("import");
    expect(useImportFlow.getState().step).toBe("files");
  });
});
