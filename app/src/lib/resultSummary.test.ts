import { describe, expect, it } from "vitest";
import type { AnalysisResult, EffectSize } from "@/contracts";
import exampleResult from "../../../contracts/examples/AnalysisResult.json";
import { primaryEffect } from "@/lib/resultSummary";

function withEffects(effects: EffectSize[], analysis_id = "t_test.paired"): AnalysisResult {
  return { ...(structuredClone(exampleResult) as unknown as AnalysisResult), analysis_id, effect_sizes: effects };
}

const dz: EffectSize = { key: "d_z", label: "Cohen's d_z", symbol: "d_z", value: -0.69, ci: null, term: null, interpretation: null };
const dav: EffectSize = { key: "d_av", label: "Cohen's d_av", symbol: "d_av", value: -0.29, ci: null, term: null, interpretation: null, headline: true };

describe("primaryEffect", () => {
  it("picks the engine-flagged headline effect size over the family preference order (owner bug: chip showed d_z, summary named d_av)", () => {
    // HEADLINES["t_test.paired"] prefers d_z first, but the engine flagged d_av as headline for
    // this result; the flag must win.
    const result = withEffects([dz, dav]);
    expect(primaryEffect(result)?.key).toBe("d_av");
  });

  it("falls back to the family preference order when nothing is flagged", () => {
    const result = withEffects([{ ...dz }, { ...dav, headline: false }]);
    expect(primaryEffect(result)?.key).toBe("d_z");
  });

  it("falls back to the first effect size for an unknown family with nothing flagged", () => {
    const result = withEffects([{ ...dz }, { ...dav, headline: false }], "some_future_analysis");
    expect(primaryEffect(result)?.key).toBe("d_z");
  });

  it("ignores a flagged effect size with a null value", () => {
    const result = withEffects([dz, { ...dav, value: null }]);
    expect(primaryEffect(result)?.key).toBe("d_z");
  });
});
