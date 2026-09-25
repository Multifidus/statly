/**
 * Learn library + hover glossary, bundled at build time (SPEC §11.3). Everything under
 * content/learn/**.md and content/glossary.yaml is inlined by Vite as raw text, so the app
 * works fully offline and the content stays reviewable Markdown/YAML (content/learn/README.md).
 */
import { parseFrontMatter, parseYamlMap, type YamlValue } from "@/lib/content/miniYaml";

/** Known categories; new content categories (e.g. posthoc) are shown under their own heading. */
export type LearnCategory = "tests" | "assumptions" | "effect_sizes" | (string & {});

export interface LearnSection {
  heading: string;
  markdown: string;
}

export interface LearnPage {
  id: string;
  title: string;
  category: LearnCategory;
  summary: string;
  related: string[];
  ownerReviewed: boolean;
  /** Markdown body without front matter, `{{term}}` markers intact. */
  body: string;
  sections: LearnSection[];
}

export interface GlossaryEntry {
  key: string;
  term: string;
  short: string;
  long: string;
  seeAlso: string[];
}

const str = (v: YamlValue | undefined): string => (v === null || v === undefined ? "" : String(v));
const list = (v: YamlValue | undefined): string[] => (Array.isArray(v) ? v.map((x) => str(x)) : []);

/** Split a Markdown body into its `## ` sections (text before the first H2 is dropped). */
export function splitSections(body: string): LearnSection[] {
  const out: LearnSection[] = [];
  let cur: LearnSection | null = null;
  let inFence = false;
  for (const line of body.split("\n")) {
    if (/^```/.test(line)) inFence = !inFence;
    const m = !inFence && /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (cur) out.push(cur);
      cur = { heading: m[1], markdown: "" };
    } else if (cur) {
      cur.markdown += line + "\n";
    }
  }
  if (cur) out.push(cur);
  return out.map((s) => ({ ...s, markdown: s.markdown.trim() }));
}

export function parseLearnPage(raw: string): LearnPage {
  const { data, body } = parseFrontMatter(raw);
  return {
    id: str(data.id),
    title: str(data.title),
    category: str(data.category),
    summary: str(data.summary),
    related: list(data.related),
    ownerReviewed: data.owner_reviewed === true,
    body: body.trim(),
    sections: splitSections(body),
  };
}

export function parseGlossary(raw: string): Record<string, GlossaryEntry> {
  const data = parseYamlMap(raw);
  const out: Record<string, GlossaryEntry> = {};
  for (const [key, v] of Object.entries(data)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    out[key] = { key, term: str(v.term) || key, short: str(v.short), long: str(v.long), seeAlso: list(v.see_also) };
  }
  return out;
}

// --- bundled content -----------------------------------------------------------------------

const PAGE_FILES = import.meta.glob("../../../../content/learn/*/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const GLOSSARY_FILES = import.meta.glob("../../../../content/glossary.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const LEARN_PAGES: LearnPage[] = Object.values(PAGE_FILES)
  .map(parseLearnPage)
  .filter((p) => p.id)
  .sort((a, b) => a.title.localeCompare(b.title));

const PAGE_BY_ID = new Map(LEARN_PAGES.map((p) => [p.id, p]));

export const GLOSSARY: Record<string, GlossaryEntry> = parseGlossary(Object.values(GLOSSARY_FILES)[0] ?? "");

export function getLearnPage(id: string | null | undefined): LearnPage | null {
  return (id && PAGE_BY_ID.get(id)) || null;
}

export function getTerm(key: string): GlossaryEntry | null {
  return GLOSSARY[key] ?? null;
}

/**
 * Engine ids (assumption keys, effect-size keys, decision-tree ids) that share a Learn page
 * with a differently named id. Tests use their analysis id directly.
 */
const PAGE_ALIASES: Record<string, string> = {
  normality_of_differences: "normality",
  normality_of_residuals: "normality",
  multivariate_normality: "normality",
  independence_of_observations: "independence",
  independence_of_pairs: "independence",
  independence_of_residuals: "independence",
  homoscedasticity: "homogeneity_of_variance",
  d_z: "d_z_d_av",
  d_av: "d_z_d_av",
  cohens_d_z: "d_z_d_av",
  cohens_d_av: "d_z_d_av",
  cramers_v: "cramers_v_phi",
  phi: "cramers_v_phi",
  r: "r_effect",
  pearson_r: "r_effect",
  point_biserial_r: "r_effect",
  eta_sq: "eta_squared",
  partial_eta_sq: "partial_eta_squared",
  omega_sq: "omega_squared",
  epsilon_sq: "epsilon_squared",
  kendall_w: "kendalls_w",
  anova_welch: "anova.welch",
};

/** The Learn page for an analysis id, assumption key or effect-size key (null if none). */
export function learnPageFor(id: string | null | undefined): LearnPage | null {
  if (!id) return null;
  return getLearnPage(id) ?? getLearnPage(PAGE_ALIASES[id]);
}

export function sectionOf(page: LearnPage | null, heading: string | RegExp): string | null {
  if (!page) return null;
  const s = page.sections.find((x) => (typeof heading === "string" ? x.heading === heading : heading.test(x.heading)));
  return s?.markdown ?? null;
}

/** Every `{{key}}` marker used in a Markdown string, in order of first use. */
export function glossaryMarkers(md: string): string[] {
  return [...new Set([...md.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/g)].map((m) => m[1]))];
}

/**
 * Turn `{{key}}` markers into `[term](glossary:key)` links that the Markdown renderer shows as
 * glossary popovers. Unknown keys fall back to their plain words.
 */
export function linkGlossaryTerms(md: string): string {
  return md.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const e = GLOSSARY[key];
    if (!e) return key.replace(/_/g, " ");
    return `[${e.term.replace(/([[\]])/g, "\\$1")}](glossary:${key})`;
  });
}

/** Plain text of a Markdown snippet with glossary markers resolved (for short inline use). */
export function plainTerms(md: string): string {
  return md.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/g, (_m, key: string) => GLOSSARY[key]?.term ?? key.replace(/_/g, " "));
}
