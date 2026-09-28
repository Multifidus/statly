import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Highlighted } from "@/components/qualitative/Highlighted";
import { ResponseCard } from "@/components/qualitative/ResponseCard";
import { highlightSegments, textOn } from "@/lib/qualitative/highlight";
import { mockMatchSpans, searchTerms } from "@/lib/qualitative/mockTags";
import { summaryRows } from "@/lib/qualitative/chart";
import type { ResponseItem, Tag } from "@/lib/qualitative/types";

describe("highlightSegments", () => {
  it("splits text around spans, clamping bad spans", () => {
    expect(highlightSegments("I liked the pace", [[12, 16]])).toEqual([
      { text: "I liked the ", match: false },
      { text: "pace", match: true },
    ]);
    expect(highlightSegments("abc", [])).toEqual([{ text: "abc", match: false }]);
    expect(highlightSegments("abcdef", [[4, 99], [0, 2], [1, 3]])).toEqual([
      { text: "ab", match: true },
      { text: "c", match: true },
      { text: "d", match: false },
      { text: "ef", match: true },
    ]);
  });

  it("uses UTF-16 indices like the engine (emoji = 2 code units)", () => {
    const text = "😀 Pacing";
    expect(highlightSegments(text, [[3, 9]])[1]).toEqual({ text: "Pacing", match: true });
  });
});

describe("Highlighted", () => {
  it("renders matches as <mark> and keeps line breaks", () => {
    const { container } = render(<Highlighted text={"Fine.\nThe pace was quick"} spans={[[10, 14]]} />);
    const marks = container.querySelectorAll("mark");
    expect([...marks].map((m) => m.textContent)).toEqual(["pace"]);
    expect(screen.getByTestId("response-text").textContent).toBe("Fine.\nThe pace was quick");
  });
});

describe("ResponseCard tag menu", () => {
  const tags: Tag[] = [
    { id: "t1", name: "Pacing", color: "#0072B2", definition: "" },
    { id: "t2", name: "Fairness", color: "#F0E442", definition: "" },
  ];
  const item: ResponseItem = { row_id: 0, text: "It was fine.", matches: [], tag_ids: ["t1"], context: {} };

  it("closes on pick (single click tags once), keeps checkmark state on reopen, and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <ResponseCard index={0} item={item} tags={tags} focused label={() => ""} onToggle={onToggle} onFocus={() => {}} />,
    );

    const trigger = screen.getByTestId("tag-menu");
    await user.click(trigger);
    const fairnessItem = await screen.findByRole("menuitemcheckbox", { name: /Fairness/ });
    await user.click(fairnessItem);

    expect(onToggle).toHaveBeenCalledExactlyOnceWith("t2");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    // Focus returns to the card's trigger button so a subsequent number-key shortcut still targets this card.
    expect(trigger).toHaveFocus();

    // Reopening shows the still-applied tag's checkmark (the item's tag_ids didn't change in this test double,
    // so "Pacing" stays checked).
    await user.click(trigger);
    const pacingItem = await screen.findByRole("menuitemcheckbox", { name: /Pacing/ });
    expect(pacingItem).toHaveAttribute("aria-checked", "true");
  });
});

describe("helpers", () => {
  it("parses search terms with quoted phrases", () => {
    expect(searchTerms('Pace "extra practice"  fine')).toEqual(["pace", "extra practice", "fine"]);
    expect(mockMatchSpans("abcabc", ["abc", "bca"])).toEqual([[0, 6]]);
    expect(mockMatchSpans("abc", ["z"])).toBeNull();
  });

  it("picks readable chip text colors", () => {
    expect(textOn("#F0E442")).toBe("#000000");
    expect(textOn("#0072B2")).toBe("#ffffff");
  });

  it("builds chart rows per group", () => {
    const rows = summaryRows({
      snapshot_id: "s", variable: "Q10", n_responses: 4, n_coded: 1, n_uncoded: 3,
      tags: [{ id: "a", name: "A", color: "#0072B2", definition: "" }],
      overall: [{ tag_id: "a", count: 1, percent: 25 }], by: "G",
      groups: [{ value: 1, label: "One", n_responses: 2, counts: [{ tag_id: "a", count: 1, percent: 50 }] }],
      n_missing_group: 2,
    });
    expect(rows).toEqual([{ tag: "A", group: "One", percent: 50, count: 1, n: 2 }]);
  });
});
