/**
 * Qualitative coding (SPEC §11.1): the response reader's query (variable, filters, search, tag
 * filter), a paged cache of response cards, the tag codebook, and the summary. The engine owns
 * the codebook and tag applications (saved into the project file on save/autosave); every change
 * here marks the project dirty.
 */
import { create } from "zustand";
import type { CellValue, DatasetMeta, VariableSchema } from "@/contracts";
import { qualRpc } from "@/lib/qualitative/api";
import type {
  CreatedVariable,
  ResponseItem,
  SummaryResult,
  TagCodebook,
  TagFilter,
  TagSpec,
  ValueFilter,
} from "@/lib/qualitative/types";
import { describeEditError } from "@/lib/variableEdits";
import { useDatasetStore } from "@/stores/dataset";
import { useHistory } from "@/stores/history";
import { useProjectStore } from "@/stores/project";

export const PAGE_SIZE = 100;
const EMPTY_BOOK: TagCodebook = { schema_version: 1, tags: [], applications: [] };

/** Variables holding written answers, open-ended ones first. */
export function textVariables(meta: DatasetMeta): VariableSchema[] {
  return [...meta.variables]
    .filter((v) => v.dtype === "string" && !v.is_metadata && !v.is_pii && v.role !== "identifier")
    .sort((a, b) => Number(b.role === "open_text") - Number(a.role === "open_text") || a.display_order - b.display_order);
}

/** Variables that sort people into a few groups (for filters, card context, and "compare by"). */
export function groupingVariables(meta: DatasetMeta): VariableSchema[] {
  return [...meta.variables]
    .filter(
      (v) =>
        !v.is_metadata &&
        !v.is_pii &&
        v.role !== "open_text" &&
        v.role !== "identifier" &&
        (v.role === "group" || v.role === "time" || ((v.level === "nominal" || v.level === "ordinal") && (v.dtype !== "string" || v.value_labels.length > 0))),
    )
    .sort((a, b) => rank(a) - rank(b) || a.display_order - b.display_order);
}

function rank(v: VariableSchema): number {
  return v.role === "group" ? 0 : v.role === "time" ? 1 : 2;
}

/** Group/time variables shown on every response card. */
export function contextVariables(meta: DatasetMeta): string[] {
  return meta.variables
    .filter((v) => (v.role === "group" || v.role === "time") && !v.is_metadata)
    .sort((a, b) => a.display_order - b.display_order)
    .map((v) => v.name);
}

interface QualState {
  datasetId: string | null;
  variable: string | null;
  contextVars: string[];
  filters: ValueFilter[];
  search: string;
  tagFilter: TagFilter;
  codebook: TagCodebook;
  /** Response cards by list position (pages load on demand). */
  items: Record<number, ResponseItem>;
  total: number;
  totalResponses: number;
  loaded: boolean;
  /** Bumped whenever the query changes; stale page answers are dropped. */
  query: number;
  focused: number;
  summaryBy: string | null;
  summary: SummaryResult | null;
  error: string | null;

  init: (meta: DatasetMeta) => Promise<void>;
  setVariable: (name: string) => Promise<void>;
  setFilter: (variable: string, values: CellValue[] | null) => Promise<void>;
  clearFilters: () => Promise<void>;
  setSearch: (search: string) => Promise<void>;
  setTagFilter: (f: TagFilter) => Promise<void>;
  reload: () => Promise<void>;
  loadPage: (offset: number) => Promise<void>;
  setFocused: (index: number) => void;
  toggleTag: (index: number, tagId: string) => Promise<void>;
  saveTag: (spec: TagSpec) => Promise<boolean>;
  deleteTag: (tagId: string) => Promise<void>;
  loadSummary: (by?: string | null) => Promise<void>;
  makeVariables: (tagIds?: string[] | null) => Promise<CreatedVariable[] | null>;
  reset: () => void;
}

const inflight = new Set<string>();

const initial = {
  datasetId: null,
  variable: null,
  contextVars: [],
  filters: [],
  search: "",
  tagFilter: null,
  codebook: EMPTY_BOOK,
  items: {},
  total: 0,
  totalResponses: 0,
  loaded: false,
  query: 0,
  focused: 0,
  summaryBy: null,
  summary: null,
  error: null,
} satisfies Partial<QualState>;

export const useQualitative = create<QualState>((set, get) => {
  const fail = (e: unknown) => set({ error: describeEditError(e) });
  const dirty = () => useProjectStore.getState().markDirty();

  /** Drop cached pages and fetch the first one for the current query. */
  const requery = async () => {
    inflight.clear();
    set({ items: {}, loaded: false, focused: 0, query: get().query + 1, error: null });
    await get().loadPage(0);
  };

  return {
    ...initial,

    init: async (meta) => {
      const same = get().datasetId === meta.dataset_id;
      const texts = textVariables(meta);
      const keep = same && get().variable && texts.some((v) => v.name === get().variable);
      const variable = keep ? get().variable : (texts[0]?.name ?? null);
      set({
        ...(same ? {} : initial),
        datasetId: meta.dataset_id,
        variable,
        contextVars: contextVariables(meta),
        filters: same ? get().filters.filter((f) => meta.variables.some((v) => v.name === f.variable)) : [],
      });
      try {
        const { codebook } = await qualRpc.codebook(meta.dataset_id);
        set({ codebook });
      } catch (e) {
        fail(e);
      }
      if (variable) await requery();
      else set({ loaded: true });
    },

    setVariable: async (name) => {
      set({ variable: name, summary: null });
      await requery();
    },

    setFilter: async (variable, values) => {
      const rest = get().filters.filter((f) => f.variable !== variable);
      set({ filters: values && values.length ? [...rest, { variable, values }] : rest });
      await requery();
    },

    clearFilters: async () => {
      set({ filters: [], search: "", tagFilter: null });
      await requery();
    },

    setSearch: async (search) => {
      set({ search });
      await requery();
    },

    setTagFilter: async (tagFilter) => {
      set({ tagFilter });
      await requery();
    },

    reload: () => requery(),

    loadPage: async (offset) => {
      const { datasetId, variable, filters, search, tagFilter, contextVars, query } = get();
      if (!datasetId || !variable) return;
      const start = Math.floor(offset / PAGE_SIZE) * PAGE_SIZE;
      const key = `${query}:${start}`;
      if (inflight.has(key) || get().items[start]) return;
      inflight.add(key);
      try {
        const res = await qualRpc.responses({
          dataset_id: datasetId,
          variable,
          filters,
          search: search.trim() || null,
          tag_filter: tagFilter,
          context_variables: contextVars,
          offset: start,
          limit: PAGE_SIZE,
        });
        if (get().query !== query) return;
        const items = { ...get().items };
        res.items.forEach((it, i) => (items[start + i] = it));
        set({ items, total: res.total, totalResponses: res.total_responses, loaded: true });
      } catch (e) {
        if (get().query === query) {
          fail(e);
          set({ loaded: true });
        }
      } finally {
        inflight.delete(key);
      }
    },

    setFocused: (focused) => set({ focused }),

    toggleTag: async (index, tagId) => {
      const { datasetId, variable, items } = get();
      const item = items[index];
      if (!datasetId || !variable || !item) return;
      const order = get().codebook.tags.map((t) => t.id);
      const next = item.tag_ids.includes(tagId)
        ? item.tag_ids.filter((t) => t !== tagId)
        : [...item.tag_ids, tagId].sort((a, b) => order.indexOf(a) - order.indexOf(b));
      const put = (tag_ids: string[]) => {
        const cur = get().items[index];
        if (cur && cur.row_id === item.row_id) set({ items: { ...get().items, [index]: { ...cur, tag_ids } } });
      };
      put(next); // optimistic
      try {
        const res = await qualRpc.apply({ dataset_id: datasetId, row_id: item.row_id, variable, tag_ids: next });
        put(res.tag_ids);
        set({ summary: null, codebook: withApplication(get().codebook, variable, item.row_id, res.tag_ids) });
        dirty();
      } catch (e) {
        put(item.tag_ids);
        fail(e);
      }
    },

    saveTag: async (spec) => {
      const { datasetId } = get();
      if (!datasetId) return false;
      try {
        const res = await qualRpc.upsertTag(datasetId, spec);
        set({ codebook: res.codebook, summary: null, error: null });
        dirty();
        return true;
      } catch (e) {
        fail(e);
        return false;
      }
    },

    deleteTag: async (tagId) => {
      const { datasetId } = get();
      if (!datasetId) return;
      try {
        const res = await qualRpc.deleteTag(datasetId, tagId);
        const items: Record<number, ResponseItem> = {};
        for (const [k, it] of Object.entries(get().items)) items[Number(k)] = { ...it, tag_ids: it.tag_ids.filter((t) => t !== tagId) };
        set({ codebook: res.codebook, items, summary: null, tagFilter: get().tagFilter === tagId ? null : get().tagFilter });
        dirty();
      } catch (e) {
        fail(e);
      }
    },

    loadSummary: async (by) => {
      const { datasetId, variable } = get();
      const summaryBy = by === undefined ? get().summaryBy : by;
      set({ summaryBy });
      if (!datasetId || !variable) return;
      try {
        const summary = await qualRpc.summary({ dataset_id: datasetId, variable, by: summaryBy });
        if (get().summaryBy === summaryBy && get().variable === variable) set({ summary, error: null });
      } catch (e) {
        fail(e);
      }
    },

    makeVariables: async (tagIds) => {
      const { variable } = get();
      const meta = useDatasetStore.getState().meta;
      if (!meta || !variable) return null;
      try {
        const res = await qualRpc.toVariables({
          dataset_id: meta.dataset_id,
          snapshot_id: meta.snapshot_id,
          variable,
          tag_ids: tagIds ?? null,
        });
        useDatasetStore.getState().setMeta(res.dataset_meta);
        dirty();
        await useHistory.getState().refresh();
        return res.created;
      } catch (e) {
        fail(e);
        return null;
      }
    },

    reset: () => {
      inflight.clear();
      set({ ...initial, query: get().query + 1 });
    },
  };
});

/** The codebook with one response's tags replaced (mirrors the engine's `tags.apply`). */
export function withApplication(book: TagCodebook, variable: string, rowId: number, tagIds: string[]): TagCodebook {
  const apps = book.applications.filter((a) => !(a.variable === variable && a.row_id === rowId));
  if (tagIds.length) apps.push({ row_id: rowId, variable, tag_ids: tagIds });
  return { ...book, applications: apps };
}
