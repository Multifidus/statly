import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import type { CellValue, DatasetMeta } from "@/contracts";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/form";
import { qualRpc } from "@/lib/qualitative/api";
import { groupingVariables, textVariables, useQualitative } from "@/stores/qualitative";

interface Level {
  value: CellValue;
  label: string;
  n: number;
}

/** Checkbox list of one grouping variable's levels (only levels that have written answers). */
function LevelFilter({ meta, variable }: { meta: DatasetMeta; variable: string }) {
  const textVar = useQualitative((s) => s.variable);
  const filter = useQualitative((s) => s.filters.find((f) => f.variable === variable));
  const setFilter = useQualitative((s) => s.setFilter);
  const [levels, setLevels] = useState<Level[] | null>(null);
  useEffect(() => {
    if (!textVar) return;
    let live = true;
    qualRpc
      .summary({ dataset_id: meta.dataset_id, variable: textVar, by: variable })
      .then((s) => live && setLevels(s.groups.map((g) => ({ value: g.value, label: g.label, n: g.n_responses }))))
      .catch(() => live && setLevels([]));
    return () => {
      live = false;
    };
  }, [meta.dataset_id, textVar, variable]);
  if (!levels) return <p className="text-xs text-muted-foreground">Loading…</p>;
  const chosen = new Set((filter?.values ?? []).map(String));
  const toggle = (v: CellValue) => {
    const next = chosen.has(String(v)) ? (filter?.values ?? []).filter((x) => String(x) !== String(v)) : [...(filter?.values ?? []), v];
    void setFilter(variable, next.length ? next : null);
  };
  return (
    <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <legend className="sr-only">Show responses where {variable} is</legend>
      {levels.map((l) => (
        <label key={String(l.value)} className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={chosen.has(String(l.value))} onChange={() => toggle(l.value)} />
          {l.label} <span className="text-xs text-muted-foreground">({l.n})</span>
        </label>
      ))}
    </fieldset>
  );
}

/** Which written-answer variable to read, keyword search, tag filter, and group/time filters. */
export function FilterBar({ meta }: { meta: DatasetMeta }) {
  const variable = useQualitative((s) => s.variable);
  const setVariable = useQualitative((s) => s.setVariable);
  const search = useQualitative((s) => s.search);
  const setSearch = useQualitative((s) => s.setSearch);
  const tagFilter = useQualitative((s) => s.tagFilter);
  const setTagFilter = useQualitative((s) => s.setTagFilter);
  const tags = useQualitative((s) => s.codebook.tags);
  const filters = useQualitative((s) => s.filters);
  const clearFilters = useQualitative((s) => s.clearFilters);
  const [draft, setDraft] = useState(search);
  const [filterVar, setFilterVar] = useState<string>("");
  const texts = textVariables(meta);
  const groups = groupingVariables(meta);

  useEffect(() => setDraft(search), [search]);
  useEffect(() => {
    if (draft === search) return;
    const t = window.setTimeout(() => void setSearch(draft), 300);
    return () => window.clearTimeout(t);
  }, [draft, search, setSearch]);

  const active = filters.length > 0 || !!search || tagFilter !== null;
  const shownVars = [...new Set([...filters.map((f) => f.variable), ...(filterVar ? [filterVar] : [])])];

  return (
    <div className="grid gap-2" data-testid="qual-filters">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-medium">
          Question
          <NativeSelect value={variable ?? ""} onChange={(e) => void setVariable(e.target.value)} data-testid="qual-variable">
            {texts.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
                {v.label ? ` — ${v.label}` : ""}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="grid flex-1 gap-1 text-xs font-medium" style={{ minWidth: 200 }}>
          Search the answers
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-2 size-4 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void setSearch(draft)}
              placeholder='Words to find, or "an exact phrase"'
              className="pl-8"
              data-testid="qual-search"
            />
          </div>
        </label>
        <label className="grid gap-1 text-xs font-medium">
          Show
          <NativeSelect value={tagFilter ?? ""} onChange={(e) => void setTagFilter(e.target.value || null)} data-testid="qual-tag-filter">
            <option value="">All responses</option>
            <option value="untagged">Not tagged yet</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                Tagged “{t.name}”
              </option>
            ))}
          </NativeSelect>
        </label>
        {groups.length > 0 && (
          <label className="grid gap-1 text-xs font-medium">
            Filter by
            <NativeSelect value={filterVar} onChange={(e) => setFilterVar(e.target.value)} data-testid="qual-filter-var">
              <option value="">Choose a variable…</option>
              {groups.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}
                  {v.label ? ` — ${v.label}` : ""}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
        {active && (
          <Button variant="ghost" size="sm" onClick={() => void clearFilters().then(() => setFilterVar(""))}>
            <X aria-hidden /> Clear filters
          </Button>
        )}
      </div>
      {shownVars.map((name) => (
        <div key={name} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-1.5">
          <span className="text-xs font-medium">{name}:</span>
          <LevelFilter meta={meta} variable={name} />
        </div>
      ))}
    </div>
  );
}
