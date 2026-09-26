import { describe, expect, it } from "vitest";
import type { ValueLabel } from "@/contracts";
import { applyChoicePreset, CHOICE_PRESETS, labelsAreJustCodes, presetsForCount } from "@/lib/choicePresets";

function vl(value: number, label = String(value)): ValueLabel {
  return { value, label };
}

describe("CHOICE_PRESETS", () => {
  it("has the required scales", () => {
    const ids = CHOICE_PRESETS.map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "agreement",
        "frequency",
        "satisfaction",
        "likelihood",
        "importance",
        "quality",
        "yes_no",
        "true_false",
        "keep_numbers",
      ]),
    );
  });

  it("every variant's option list matches the length it's keyed under", () => {
    for (const preset of CHOICE_PRESETS) {
      for (const [len, options] of Object.entries(preset.lengths)) {
        expect(options).toHaveLength(Number(len));
      }
    }
  });

  it("only offers standard lengths (3, 4, 5, 7) plus 2 for the binary scales", () => {
    for (const preset of CHOICE_PRESETS) {
      for (const len of Object.keys(preset.lengths).map(Number)) {
        expect([2, 3, 4, 5, 7]).toContain(len);
      }
    }
  });
});

describe("presetsForCount", () => {
  it("only returns presets with a variant for that many choices, plus 'keep the numbers'", () => {
    const five = presetsForCount(5).map((p) => p.id);
    expect(five).toContain("agreement");
    expect(five).toContain("keep_numbers");
    expect(five).not.toContain("yes_no");

    const two = presetsForCount(2).map((p) => p.id);
    expect(two).toContain("yes_no");
    expect(two).toContain("true_false");
    expect(two).not.toContain("agreement");
  });
});

describe("applyChoicePreset", () => {
  it("fills labels for ascending codes without touching value or order", () => {
    const labels = [1, 2, 3, 4, 5].map((n) => vl(n, String(n)));
    const agreement = CHOICE_PRESETS.find((p) => p.id === "agreement")!;
    const next = applyChoicePreset(labels, agreement);
    expect(next.map((l) => l.value)).toEqual([1, 2, 3, 4, 5]);
    expect(next.map((l) => l.label)).toEqual([
      "Strongly disagree",
      "Disagree",
      "Neither agree nor disagree",
      "Agree",
      "Strongly agree",
    ]);
  });

  it("keeps codes attached to their rows when the observed order is descending", () => {
    const labels = [5, 4, 3, 2, 1].map((n) => vl(n, String(n)));
    const agreement = CHOICE_PRESETS.find((p) => p.id === "agreement")!;
    const next = applyChoicePreset(labels, agreement);
    expect(next.map((l) => l.value)).toEqual([5, 4, 3, 2, 1]);
    // row for code 5 (still first) gets "Strongly agree", not "Strongly disagree"
    expect(next[0].label).toBe("Strongly agree");
    expect(next[4].label).toBe("Strongly disagree");
  });

  it("'keep the numbers' resets every label back to its code", () => {
    const labels = [vl(1, "Strongly disagree"), vl(2, "Disagree")];
    const keep = CHOICE_PRESETS.find((p) => p.id === "keep_numbers")!;
    const next = applyChoicePreset(labels, keep);
    expect(next.map((l) => l.label)).toEqual(["1", "2"]);
  });

  it("leaves labels unchanged when the preset has no variant for that length", () => {
    const labels = [1, 2, 3].map((n) => vl(n));
    const importance = CHOICE_PRESETS.find((p) => p.id === "importance")!; // no 3-point variant
    const next = applyChoicePreset(labels, importance);
    expect(next).toEqual(labels);
  });
});

describe("labelsAreJustCodes", () => {
  it("is true when every label is just the code restated", () => {
    expect(labelsAreJustCodes([vl(1, "1"), vl(2, "2")])).toBe(true);
  });

  it("is false once any label has real text", () => {
    expect(labelsAreJustCodes([vl(1, "Strongly disagree"), vl(2, "2")])).toBe(false);
  });

  it("is false for an empty list", () => {
    expect(labelsAreJustCodes([])).toBe(false);
  });
});
