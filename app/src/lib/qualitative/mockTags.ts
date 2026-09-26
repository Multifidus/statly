/**
 * Mock-engine implementation of the Phase 9 `tags.*` and `export.qualitative` methods
 * (VITE_STATLY_MOCK=1 and vitest). Mirrors engine/statly_engine/data/tags.py closely enough for
 * the UI: codebook CRUD, applications, paged responses with UTF-16 match spans, summaries, and
 * yes/no variables. The mock engine supplies dataset access through `MockTagHost`.
 */
import type { CellValue, DatasetMeta, ProjectFile, TagCodebook, VariableSchema } from "@/contracts";
import type { EngineError } from "@/lib/engine";
import type { DatasetEditResult } from "@/lib/variablesRpc";
import { TAG_PALETTE } from "./highlight";
import type { CreatedVariable, GroupCounts, ResponseItem, TagCount, TagSpec, ValueFilter } from "./types";

export interface MockTagHost {
  dataset(id: string): { meta: DatasetMeta; nRows: number; cell: (r: number, col: string) => CellValue };
  /** Add (or replace) integer columns + variables as one labelled edit; returns the edit result. */
  addColumns(
    id: string,
    snapshotId: string | null | undefined,
    newVars: VariableSchema[],
    cols: Map<string, CellValue[]>,
    label: string,
  ): DatasetEditResult;
}

const err = (code: number, message: string, type: string): EngineError => ({ kind: "rpc", code, message, data: { type } }) as EngineError;
const invalid = (m: string) => err(-32003, m, "InvalidParams");
const clone = <T,>(x: T): T => structuredClone(x);
const empty = (): TagCodebook => ({ schema_version: 1, tags: [], applications: [] });
const slug = (s: string) => s.replace(/[^0-9A-Za-z]+/g, "_").replace(/^_+|_+$/g, "") || "option";
const key = (x: CellValue | undefined) => (x === null || x === undefined ? null : typeof x === "number" ? `n:${x}` : typeof x === "boolean" ? `b:${x}` : `s:${x}`);
const hasText = (x: CellValue) => typeof x === "string" && x.trim() !== "";

export function mockMatchSpans(text: string, terms: string[]): [number, number][] | null {
  if (!terms.length) return [];
  const low = text.toLowerCase().length === text.length ? text.toLowerCase() : text;
  const spans: [number, number][] = [];
  for (const t of terms) {
    let i = low.indexOf(t);
    if (i < 0) return null;
    while (i >= 0) {
      spans.push([i, i + t.length]);
      i = low.indexOf(t, i + 1);
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of spans) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

export function searchTerms(search: string | null | undefined): string[] {
  if (!search?.trim()) return [];
  return [...search.matchAll(/"([^"]+)"|(\S+)/g)].map((m) => (m[1] ?? m[2]).toLowerCase()).filter((t) => t.trim());
}

export class MockTags {
  private books = new Map<string, TagCodebook>();
  constructor(private host: MockTagHost) {}

  book(datasetId: string): TagCodebook {
    this.host.dataset(datasetId);
    let b = this.books.get(datasetId);
    if (!b) this.books.set(datasetId, (b = empty()));
    return b;
  }

  /** project.save / autosave: the mock engine's codebook becomes `tag_codebook`. */
  attach(project: ProjectFile): void {
    const b = project.dataset_meta && this.books.get(project.dataset_meta.dataset_id);
    if (b) project.tag_codebook = b.tags.length || b.applications.length ? clone(b) : null;
  }

  /** project.load: the saved codebook becomes the live one. */
  restore(project: ProjectFile): void {
    if (project.dataset_meta) this.books.set(project.dataset_meta.dataset_id, project.tag_codebook ? clone(project.tag_codebook) : empty());
  }

  /** Returns undefined for methods this module doesn't handle. */
  call(method: string, params: Record<string, unknown>): unknown {
    const p = params as never;
    switch (method) {
      case "tags.codebook.get":
        return { codebook: clone(this.book((p as { dataset_id: string }).dataset_id)) };
      case "tags.codebook.upsert":
        return this.upsert(p);
      case "tags.codebook.delete":
        return this.remove(p);
      case "tags.apply":
        return this.apply(p);
      case "tags.responses":
        return this.responses(p);
      case "tags.summary":
        return this.summary(p);
      case "tags.to_variables":
        return this.toVariables(p);
      case "export.qualitative":
        return this.exportFile(p);
      default:
        return undefined;
    }
  }

  private textVar(meta: DatasetMeta, name: string): VariableSchema {
    const v = meta.variables.find((x) => x.name === name);
    if (!v) throw invalid(`There is no variable called '${name}'.`);
    if (v.dtype !== "string") throw invalid(`'${name}' doesn't hold written answers, so it can't be tagged.`);
    return v;
  }

  private upsert(p: { dataset_id: string; tag: TagSpec }) {
    const b = this.book(p.dataset_id);
    const name = (p.tag.name ?? "").trim();
    if (!name) throw invalid("Give the tag a name.");
    const dup = b.tags.find((t) => t.name.toLowerCase() === name.toLowerCase() && t.id !== p.tag.id);
    if (dup) throw invalid(`There is already a tag called '${dup.name}'. Choose another name.`);
    const definition = (p.tag.definition ?? "").trim();
    let tag = p.tag.id ? b.tags.find((t) => t.id === p.tag.id) : undefined;
    if (p.tag.id && !tag) throw invalid("That tag isn't in the codebook any more.");
    if (tag) Object.assign(tag, { name, definition, color: p.tag.color ?? tag.color });
    else {
      const base = `tag_${slug(name).toLowerCase()}`;
      let id = base;
      for (let k = 2; b.tags.some((t) => t.id === id); k++) id = `${base}_${k}`;
      const used = new Set(b.tags.map((t) => t.color.toUpperCase()));
      const color = p.tag.color ?? TAG_PALETTE.find((c) => !used.has(c)) ?? TAG_PALETTE[b.tags.length % TAG_PALETTE.length];
      tag = { id, name, color, definition };
      b.tags.push(tag);
    }
    return { codebook: clone(b), tag: clone(tag) };
  }

  private remove(p: { dataset_id: string; tag_id: string }) {
    const b = this.book(p.dataset_id);
    if (!b.tags.some((t) => t.id === p.tag_id)) throw invalid("That tag isn't in the codebook any more.");
    b.tags = b.tags.filter((t) => t.id !== p.tag_id);
    b.applications = b.applications
      .map((a) => ({ ...a, tag_ids: a.tag_ids.filter((t) => t !== p.tag_id) }))
      .filter((a) => a.tag_ids.length);
    return { codebook: clone(b) };
  }

  private apply(p: { dataset_id: string; row_id: number; variable: string; tag_ids: string[] }) {
    const ds = this.host.dataset(p.dataset_id);
    const b = this.book(p.dataset_id);
    this.textVar(ds.meta, p.variable);
    if (p.row_id < 0 || p.row_id >= ds.nRows) throw err(-32002, "That response is no longer in the dataset.", "StaleOrUnknown");
    const order = b.tags.map((t) => t.id);
    if (p.tag_ids.some((t) => !order.includes(t))) throw invalid("Some of those tags aren't in the codebook any more.");
    const ids = [...new Set(p.tag_ids)].sort((x, y) => order.indexOf(x) - order.indexOf(y));
    b.applications = b.applications.filter((a) => !(a.row_id === p.row_id && a.variable === p.variable));
    if (ids.length) b.applications.push({ row_id: p.row_id, variable: p.variable, tag_ids: ids });
    return { row_id: p.row_id, variable: p.variable, tag_ids: ids };
  }

  private index(b: TagCodebook, variable: string): Map<number, string[]> {
    return new Map(b.applications.filter((a) => a.variable === variable).map((a) => [a.row_id, a.tag_ids]));
  }

  private rows(datasetId: string, variable: string, filters: ValueFilter[] = []): number[] {
    const ds = this.host.dataset(datasetId);
    const out: number[] = [];
    const wanted = filters.map((f) => ({ v: f.variable, keys: new Set(f.values.map(key)) }));
    for (let r = 0; r < ds.nRows; r++) {
      if (!hasText(ds.cell(r, variable))) continue;
      if (wanted.every((f) => f.keys.has(key(ds.cell(r, f.v))))) out.push(r);
    }
    return out;
  }

  private responses(p: {
    dataset_id: string;
    variable: string;
    filters?: ValueFilter[];
    search?: string | null;
    tag_filter?: string | null;
    context_variables?: string[];
    offset?: number;
    limit?: number;
  }) {
    const ds = this.host.dataset(p.dataset_id);
    this.textVar(ds.meta, p.variable);
    const b = this.book(p.dataset_id);
    const apps = this.index(b, p.variable);
    const limit = p.limit ?? 100;
    if (limit < 1 || limit > 500) throw invalid("limit must be between 1 and 500.");
    let rows = this.rows(p.dataset_id, p.variable, p.filters);
    if (p.tag_filter === "untagged") rows = rows.filter((r) => !apps.get(r)?.length);
    else if (p.tag_filter) rows = rows.filter((r) => apps.get(r)?.includes(p.tag_filter!));
    const terms = searchTerms(p.search);
    const hits: { r: number; spans: [number, number][] }[] = [];
    for (const r of rows) {
      const spans = mockMatchSpans(String(ds.cell(r, p.variable)), terms);
      if (spans) hits.push({ r, spans });
    }
    const offset = p.offset ?? 0;
    const items: ResponseItem[] = hits.slice(offset, offset + limit).map(({ r, spans }) => ({
      row_id: r,
      text: String(ds.cell(r, p.variable)),
      matches: spans,
      tag_ids: [...(apps.get(r) ?? [])],
      context: Object.fromEntries((p.context_variables ?? []).map((c) => [c, ds.cell(r, c)])),
    }));
    return {
      snapshot_id: ds.meta.snapshot_id,
      variable: p.variable,
      offset,
      total: hits.length,
      total_responses: this.rows(p.dataset_id, p.variable).length,
      items,
    };
  }

  private counts(b: TagCodebook, rows: number[], apps: Map<number, string[]>): TagCount[] {
    return b.tags.map((t) => {
      const count = rows.filter((r) => apps.get(r)?.includes(t.id)).length;
      return { tag_id: t.id, count, percent: rows.length ? Math.round((1000 * count) / rows.length) / 10 : null };
    });
  }

  private summary(p: { dataset_id: string; variable: string; by?: string | null }) {
    const ds = this.host.dataset(p.dataset_id);
    this.textVar(ds.meta, p.variable);
    const b = this.book(p.dataset_id);
    const apps = this.index(b, p.variable);
    const rows = this.rows(p.dataset_id, p.variable);
    const coded = rows.filter((r) => apps.get(r)?.length).length;
    const groups: GroupCounts[] = [];
    let missing = 0;
    if (p.by) {
      const v = ds.meta.variables.find((x) => x.name === p.by);
      if (!v) throw invalid(`There is no variable called '${p.by}'.`);
      const miss = new Set(v.missing_codes.map((c) => key(c)));
      const levels = new Map<string, { value: CellValue; rows: number[] }>();
      for (const r of rows) {
        const x = ds.cell(r, p.by);
        const k = key(x);
        if (k === null || miss.has(k) || x === "") {
          missing++;
          continue;
        }
        if (!levels.has(k)) levels.set(k, { value: x, rows: [] });
        levels.get(k)!.rows.push(r);
      }
      const labelled = v.value_labels.map((l) => key(l.value as CellValue)!).filter((k) => levels.has(k));
      const rest = [...levels.keys()].filter((k) => !labelled.includes(k)).sort((a, b2) => {
        const x = levels.get(a)!.value, y = levels.get(b2)!.value;
        return typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      });
      for (const k of [...labelled, ...rest]) {
        const g = levels.get(k)!;
        const label = v.value_labels.find((l) => key(l.value as CellValue) === k)?.label ?? String(g.value);
        groups.push({ value: g.value, label, n_responses: g.rows.length, counts: this.counts(b, g.rows, apps) });
      }
    }
    return {
      snapshot_id: ds.meta.snapshot_id,
      variable: p.variable,
      n_responses: rows.length,
      n_coded: coded,
      n_uncoded: rows.length - coded,
      tags: clone(b.tags),
      overall: this.counts(b, rows, apps),
      by: p.by ?? null,
      groups,
      n_missing_group: missing,
    };
  }

  private toVariables(p: { dataset_id: string; snapshot_id?: string | null; variable: string; tag_ids?: string[] | null }) {
    const ds = this.host.dataset(p.dataset_id);
    this.textVar(ds.meta, p.variable);
    const b = this.book(p.dataset_id);
    const ids = p.tag_ids?.length ? p.tag_ids : b.tags.map((t) => t.id);
    if (!ids.length) throw invalid("Add at least one tag to the codebook first.");
    const apps = this.index(b, p.variable);
    const taken = new Set(ds.meta.variables.map((v) => v.name));
    const newVars: VariableSchema[] = [];
    const cols = new Map<string, CellValue[]>();
    const created: CreatedVariable[] = [];
    for (const id of ids) {
      const t = b.tags.find((x) => x.id === id);
      if (!t) throw invalid("That tag isn't in the codebook any more.");
      const base = `${p.variable}_${slug(t.name).toLowerCase()}`;
      const label = `${p.variable} tagged '${t.name}' (1 = yes, 0 = no)`;
      const existing = ds.meta.variables.find((v) => v.name === base);
      const reuse = !!existing && existing.label === label && existing.dtype === "integer";
      let name = base;
      if (!reuse) for (let k = 2; taken.has(name); k++) name = `${base}_${k}`;
      taken.add(name);
      const values: CellValue[] = [];
      for (let r = 0; r < ds.nRows; r++) values.push(hasText(ds.cell(r, p.variable)) ? (apps.get(r)?.includes(id) ? 1 : 0) : null);
      cols.set(name, values);
      if (!reuse) {
        newVars.push({
          schema_version: 1, name, label, question_text: `Made from the tag '${t.name}' on ${p.variable}.`, role: "unassigned",
          level: "nominal", dtype: "integer", value_labels: [{ value: 0, label: "No" }, { value: 1, label: "Yes" }],
          reverse_coded: false, response_range: null, scale_id: null, missing_codes: [], sources: [], is_metadata: false,
          is_pii: false, pii_reason: null, computed: null, display_order: 0,
        });
      }
      const yes = values.filter((x) => x === 1).length;
      const no = values.filter((x) => x === 0).length;
      created.push({ tag_id: id, variable: name, n_yes: yes, n_no: no, n_missing: ds.nRows - yes - no, updated: reuse });
    }
    const n = ids.length;
    const res = this.host.addColumns(p.dataset_id, p.snapshot_id, newVars, cols, `Made yes/no variable${n > 1 ? "s" : ""} from ${n} tag${n > 1 ? "s" : ""}`);
    return { ...res, created };
  }

  private exportFile(p: { dataset_id: string; variable: string; kind?: string; format: string; path: string }) {
    const ds = this.host.dataset(p.dataset_id);
    this.textVar(ds.meta, p.variable);
    if (!["xlsx", "docx"].includes(p.format)) throw invalid(`format must be one of: xlsx, docx (got '${p.format}').`);
    if (!p.path) throw invalid("Choose where to save the file.");
    const n = this.rows(p.dataset_id, p.variable).length;
    return { path: p.path, bytes: 2048 + n * 64, n_responses: n };
  }
}
