import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LearnScreen } from "@/screens/LearnScreen";
import { useLearn } from "@/stores/learn";
import { useNav } from "@/stores/nav";

beforeEach(() => {
  useLearn.setState({ pageId: null });
  useNav.setState({ view: "learn", prev: null });
});

describe("LearnScreen: empty state", () => {
  it("shows a friendly empty state when a search matches no topics, and Clear search restores the list", async () => {
    const user = userEvent.setup();
    render(<LearnScreen />);
    await user.type(screen.getByPlaceholderText("Search topics"), "zzzznotarealtopiczzzz");
    expect(screen.getByText(/no matching topics/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /clear search/i }));
    expect(screen.queryByText(/no matching topics/i)).not.toBeInTheDocument();
  });
});
