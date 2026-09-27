import { describe, expect, it } from "vitest";
import decisionTreeRaw from "../../../content/decision_tree.yaml?raw";
import { TEST_BLURBS } from "@/lib/testBlurbs";

/** Every `primary_test:` / `nonparametric_alternative:` id in the decision tree, read straight from
 * the YAML text (a full YAML parser is overkill for two flat `key: value` lines per node; same
 * bundle-as-raw-text approach as content/learn, see src/lib/content/learn.ts). */
function idsFromDecisionTree(): string[] {
  const ids = new Set<string>();
  for (const m of decisionTreeRaw.matchAll(/^\s*(?:primary_test|nonparametric_alternative):\s*(\S+)\s*$/gm)) {
    if (m[1] !== "null") ids.add(m[1]);
  }
  return [...ids].sort();
}

describe("TEST_BLURBS", () => {
  it("has a plain-language entry for every primary_test / nonparametric_alternative id in the decision tree", () => {
    const ids = idsFromDecisionTree();
    expect(ids.length).toBeGreaterThan(20);
    const missing = ids.filter((id) => TEST_BLURBS[id] === undefined);
    expect(missing).toEqual([]);
  });
});
