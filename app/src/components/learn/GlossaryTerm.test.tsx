import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Term } from "@/components/learn/GlossaryTerm";
import { Markdown } from "@/components/learn/Markdown";
import { GLOSSARY } from "@/lib/content/learn";

describe("hover glossary", () => {
  it("opens on keyboard focus and closes with Escape", async () => {
    render(
      <p>
        before <Term k="p_value">p</Term>
      </p>,
    );
    await userEvent.tab();
    const trigger = screen.getByRole("button", { name: /p: what does this mean/ });
    expect(trigger).toHaveFocus();
    const pop = await screen.findByTestId("glossary-p_value");
    expect(pop).toHaveTextContent(GLOSSARY.p_value.short);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("glossary-p_value")).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("renders {{term}} markers in Learn Markdown as glossary terms", () => {
    render(<Markdown>{"A small {{p_value}} is *surprising*."}</Markdown>);
    const t = screen.getByRole("button", { name: /p-value/ });
    expect(t).toHaveAttribute("data-glossary", "p_value");
    expect(screen.getByText("surprising").tagName).toBe("EM");
  });

  it("falls back to plain words for unknown keys", () => {
    render(<Term k="not_a_term" />);
    expect(screen.getByText("not a term")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
