import { describe, expect, it } from "vitest";
import { allowsOneSided, contractMetric, powerPlanFor, recruitTarget } from "@/lib/planner/powerMapping";

describe("recommended test -> power analysis mapping", () => {
  it.each([
    ["t_test.independent", "power.t_test", { design: "independent", allocation_ratio: 1 }, "direct", false],
    ["mann_whitney", "power.t_test", { design: "independent" }, "direct", true],
    ["t_test.paired", "power.t_test", { design: "paired" }, "direct", false],
    ["wilcoxon_signed_rank", "power.t_test", { design: "paired" }, "direct", true],
    ["t_test.one_sample", "power.t_test", { design: "one_sample" }, "direct", false],
    ["anova.one_way", "power.anova", { design: "one_way", groups: 3 }, "direct", false],
    ["kruskal_wallis", "power.anova", { design: "one_way" }, "direct", true],
    ["ancova", "power.anova", { design: "one_way", groups: 2 }, "approximate", false],
    ["anova.factorial", "power.anova", { design: "one_way", groups: 4 }, "approximate", false],
    ["anova.repeated_measures", "power.anova", { design: "rm_within", groups: 1, measurements: 3 }, "direct", false],
    ["friedman", "power.anova", { design: "rm_within" }, "direct", true],
    ["anova.mixed", "power.anova", { design: "mixed_interaction", groups: 2, measurements: 2 }, "direct", false],
    ["chi_square.independence", "power.chi_square", { rows: 2, columns: 2 }, "direct", false],
    ["chi_square.goodness_of_fit", "power.chi_square", { categories: 3 }, "direct", false],
    ["correlation.pearson", "power.correlation", {}, "direct", false],
    ["correlation.spearman", "power.correlation", {}, "approximate", true],
    ["regression.linear", "power.regression", { predictors: 3 }, "direct", false],
    ["regression.hierarchical", "power.regression", { predictors: 3, tested_predictors: 1 }, "direct", false],
  ])("%s -> %s", (test, id, options, match, rank) => {
    const p = powerPlanFor(test);
    expect(p.powerId).toBe(id);
    expect(p.options).toMatchObject(options);
    expect(p.match).toBe(match);
    expect(p.rankBased).toBe(rank);
    expect(p.note.length).toBeGreaterThan(20);
  });

  it.each(["mcnemar", "cochran_q", "regression.logistic", "reliability.cronbach_alpha", "validity.efa", "something.new"])(
    "%s falls back to power.t_test with an explanation",
    (test) => {
      const p = powerPlanFor(test);
      expect(p).toMatchObject({ powerId: "power.t_test", match: "fallback", options: { design: "independent" } });
      expect(p.note).toMatch(/stand-in/);
    },
  );

  it("uses the interview answers for group, time and predictor counts", () => {
    expect(powerPlanFor("ancova", { q_compare_between_groups_count: "three_plus" }).options.groups).toBe(3);
    expect(powerPlanFor("anova.mixed", { q_compare_time_points: "three_plus" }).options.measurements).toBe(3);
    expect(powerPlanFor("regression.linear", { q_predict_predictor_count: "one" }).options.predictors).toBe(1);
  });

  it("reports the contract metric and which tests can be one-sided", () => {
    expect(contractMetric(powerPlanFor("t_test.paired"))).toBe("d_z");
    expect(contractMetric(powerPlanFor("regression.linear"))).toBe("f_sq");
    expect(contractMetric(powerPlanFor("anova.one_way"))).toBe("f");
    expect(allowsOneSided("power.t_test")).toBe(true);
    expect(allowsOneSided("power.anova")).toBe(false);
  });

  it("recruitTarget adds drop-outs and the rank-test inflation", () => {
    expect(recruitTarget(128, 0, false)).toBe(128);
    expect(recruitTarget(128, 10, false)).toBe(143);
    expect(recruitTarget(100, 0, true)).toBe(115);
    expect(recruitTarget(100, 20, true)).toBe(144);
  });
});
