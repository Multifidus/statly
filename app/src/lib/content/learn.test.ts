import { describe, expect, it } from "vitest";
import { parseFrontMatter, parseYamlMap } from "@/lib/content/miniYaml";
import {
  GLOSSARY,
  getLearnPage,
  glossaryMarkers,
  LEARN_PAGES,
  learnPageFor,
  linkGlossaryTerms,
  parseGlossary,
  parseLearnPage,
  sectionOf,
} from "@/lib/content/learn";
import { caveatText, labelFor } from "@/lib/content/labels";

describe("mini YAML + front matter", () => {
  it("parses quoted strings, inline lists, booleans, numbers and comments", () => {
    const y = parseYamlMap(`# c\nid: t_test.independent\ntitle: "A \\"quoted\\" title: yes"\nrelated: [a, "b, c", 'd']\nowner_reviewed: false\nn: 3 # trailing\nnested:\n  k: 'it''s'\n`);
    expect(y).toEqual({ id: "t_test.independent", title: 'A "quoted" title: yes', related: ["a", "b, c", "d"], owner_reviewed: false, n: 3, nested: { k: "it's" } });
  });

  it("splits front matter from the body and rejects unsupported YAML", () => {
    const { data, body } = parseFrontMatter("---\nid: x\n---\n\n## What it is\nHi\n");
    expect(data).toEqual({ id: "x" });
    expect(body.trim()).toBe("## What it is\nHi");
    expect(parseFrontMatter("no front matter").data).toEqual({});
    expect(() => parseYamlMap("- a\n- b")).toThrow(/Unsupported/);
  });

  it("parses a page into sections and a glossary into entries", () => {
    const p = parseLearnPage('---\nid: demo\ntitle: "Demo"\ncategory: tests\nsummary: "S"\nrelated: [x]\nowner_reviewed: true\n---\n## What it is\nA {{p_value}}.\n\n```\n## not a heading\n```\n## Common mistakes\nNone.\n');
    expect(p).toMatchObject({ id: "demo", title: "Demo", category: "tests", related: ["x"], ownerReviewed: true });
    expect(p.sections.map((s) => s.heading)).toEqual(["What it is", "Common mistakes"]);
    const g = parseGlossary('p_value:\n  term: "p-value"\n  short: "S"\n  long: "L"\n  see_also: [alpha]\n');
    expect(g.p_value).toEqual({ key: "p_value", term: "p-value", short: "S", long: "L", seeAlso: ["alpha"] });
  });
});

describe("bundled Learn library and glossary", () => {
  it("loads every page with its category's sections", () => {
    expect(LEARN_PAGES.length).toBeGreaterThanOrEqual(40);
    const t = getLearnPage("t_test.independent")!;
    expect(t.title).toMatch(/Independent/);
    expect(t.sections.map((s) => s.heading)).toEqual([
      "What it is",
      "When to use it",
      "An everyday analogy",
      "A worked example",
      "How to read the output",
      "How to report it (APA 7)",
      "Common mistakes",
    ]);
    for (const p of LEARN_PAGES) {
      expect(p.category, p.id).toMatch(/^[a-z_]+$/);
      expect(p.sections.length, p.id).toBeGreaterThanOrEqual(5);
    }
    expect(sectionOf(getLearnPage("normality"), "What to do if it fails")).toBeTruthy();
  });

  it("has a glossary entry for every {{term}} used in any page", () => {
    expect(Object.keys(GLOSSARY).length).toBeGreaterThanOrEqual(50);
    const missing = LEARN_PAGES.flatMap((p) => glossaryMarkers(p.body).filter((k) => !GLOSSARY[k]).map((k) => `${p.id}:${k}`));
    expect(missing).toEqual([]);
    for (const e of Object.values(GLOSSARY)) {
      expect(e.term && e.short).toBeTruthy();
      // see_also may point at another term or at a Learn page.
      for (const s of e.seeAlso) expect(GLOSSARY[s] ?? learnPageFor(s), `${e.key} see_also ${s}`).toBeTruthy();
    }
  });

  it("turns glossary markers into glossary links", () => {
    expect(linkGlossaryTerms("a {{p_value}} and {{nope_not_a_term}}")).toBe("a [p-value](glossary:p_value) and nope not a term");
  });

  it("maps engine and decision-tree ids to Learn pages and labels", () => {
    expect(learnPageFor("normality_of_differences")?.id).toBe("normality");
    expect(learnPageFor("d_z")?.id).toBe("d_z_d_av");
    expect(learnPageFor("cramers_v")?.id).toBe("cramers_v_phi");
    expect(learnPageFor("mann_whitney")?.id).toBe("mann_whitney");
    expect(learnPageFor("unknown_thing")).toBeNull();
    expect(labelFor("hedges_g")).toBe("Hedges' g");
    expect(labelFor("t_test.independent", { "t_test.independent": "Independent-samples t test" })).toBe("Independent-samples t test");
    expect(labelFor("kruskal_wallis")).toMatch(/Kruskal/);
    expect(labelFor("some_new.analysis")).toBe("Some new analysis");
    expect(caveatText("aggregate_time_comparison")).toMatch(/linked/);
  });
});
