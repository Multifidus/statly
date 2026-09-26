import { describe, expect, it } from "vitest";
import type { TestLogEntry } from "@/contracts";
import example from "../../../contracts/examples/TestLogEntry.json";
import { adjustedLabel, eligibility, familywiseErrorRate, newFamilyId, suggestFamilies } from "@/lib/testFamilies";
import { pAdjust } from "@/mocks/corrections";

function entry(id: string, o: { analysis?: string; outcome?: string[]; p?: number | null; snap?: string; family?: string | null } = {}): TestLogEntry {
  const e = structuredClone(example as unknown as TestLogEntry);
  e.id = id;
  e.request = { ...e.request, request_id: id, analysis_id: o.analysis ?? "t_test.independent", snapshot_id: o.snap ?? "snap1" };
  e.result_summary = { ...e.result_summary, outcome_variables: o.outcome ?? [`item_${id}`], p: o.p === undefined ? 0.03 : o.p };
  e.family_id = o.family ?? null;
  e.correction_method = o.family ? "holm" : "none";
  e.adjusted_p = null;
  return e;
}

describe("family suggestions", () => {
  it("suggests a family for 2+ tests of the same analysis on the same snapshot", () => {
    const s = suggestFamilies([entry("a"), entry("b"), entry("c")]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ reason: "analysis", memberIds: ["a", "b", "c"] });
    expect(s[0].suggestedName).toMatch(/tests$/);
  });

  it("suggests by shared outcome across different analyses, first", () => {
    const log = [entry("a", { outcome: ["score"] }), entry("b", { analysis: "mann_whitney", outcome: ["score"] })];
    const s = suggestFamilies(log);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ reason: "outcome", memberIds: ["a", "b"], suggestedName: "Tests of score" });
    expect(s[0].message).toContain("score");
  });

  it("dedupes identical member sets and keeps outcome over analysis", () => {
    const log = [entry("a", { outcome: ["score"] }), entry("b", { outcome: ["score"] })];
    const s = suggestFamilies(log);
    expect(s.map((x) => x.reason)).toEqual(["outcome"]);
  });

  it("ignores other snapshots, grouped tests, post hoc tests and tests without p", () => {
    const log = [
      entry("a"),
      entry("b", { snap: "snap2" }),
      entry("c", { family: "fam_1" }),
      entry("d", { analysis: "posthoc.tukey" }),
      entry("e", { p: null }),
    ];
    expect(suggestFamilies(log)).toEqual([]);
    expect(suggestFamilies([entry("a"), entry("f")])).toHaveLength(1);
  });

  it("hides dismissed suggestions until the member set changes", () => {
    const log = [entry("a"), entry("b")];
    const [s] = suggestFamilies(log);
    expect(suggestFamilies(log, [s.key])).toEqual([]);
    expect(suggestFamilies([...log, entry("c")], [s.key])).toHaveLength(1);
  });

  it("explains why post hoc tests and p-less tests are excluded", () => {
    expect(eligibility(entry("a"))).toEqual({ ok: true });
    const ph = eligibility(entry("d", { analysis: "posthoc.games_howell" }));
    expect(ph.ok).toBe(false);
    expect(!ph.ok && ph.reason).toMatch(/already correct/);
    expect(eligibility(entry("e", { p: null })).ok).toBe(false);
  });
});

describe("helpers", () => {
  it("family-wise error rate matches the SPEC §9 example", () => {
    expect(familywiseErrorRate(10)).toBeCloseTo(0.401, 3);
    expect(familywiseErrorRate(1)).toBeCloseTo(0.05, 10);
  });

  it("labels and ids", () => {
    expect(adjustedLabel("holm")).toBe("Holm-adjusted");
    expect(adjustedLabel("none")).toBeNull();
    expect(newFamilyId([{ id: "fam_1", name: "x" }, { id: "fam_2", name: "y" }])).toBe("fam_3");
  });

  it("mock p.adjust agrees with every R p.adjust fixture (fixtures/expected/corrections)", () => {
    const fixtures = import.meta.glob("../../../fixtures/expected/corrections/*.json", { eager: true, import: "default" }) as Record<
      string,
      { request: { p_values: (number | null)[] }; expected: Record<"bonferroni" | "holm" | "fdr_bh", (number | null)[]> }
    >;
    expect(Object.keys(fixtures).length).toBeGreaterThanOrEqual(7);
    for (const fx of Object.values(fixtures)) {
      for (const m of ["bonferroni", "holm", "fdr_bh"] as const) {
        const got = pAdjust(fx.request.p_values, m);
        fx.expected[m].forEach((w, i) => (w === null ? expect(got[i]).toBeNull() : expect(got[i]).toBeCloseTo(w, 12)));
      }
    }
  });
});
