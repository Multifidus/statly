import { useCallback, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { CellValue, DatasetMeta } from "@/contracts";
import { PAGE_SIZE, useQualitative } from "@/stores/qualitative";
import { ResponseCard } from "./ResponseCard";

const EST_H = 132;

/**
 * Virtualized list of response cards (pages of 100 load as they scroll into view).
 * Keyboard: Up/Down (or K/J) move between responses; 1–9 toggle the matching codebook tag on the
 * focused response; Home/End jump to the first/last one.
 */
export function ResponseList({ meta }: { meta: DatasetMeta }) {
  const items = useQualitative((s) => s.items);
  const total = useQualitative((s) => s.total);
  const tags = useQualitative((s) => s.codebook.tags);
  const focused = useQualitative((s) => s.focused);
  const query = useQualitative((s) => s.query);
  const setFocused = useQualitative((s) => s.setFocused);
  const toggleTag = useQualitative((s) => s.toggleTag);
  const loadPage = useQualitative((s) => s.loadPage);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<number, HTMLElement>());
  const wantFocus = useRef(false);

  const rows = useVirtualizer({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => EST_H,
    overscan: 6,
  });
  const virtual = rows.getVirtualItems();

  // Load any page that is visible but not cached yet.
  useEffect(() => {
    const pages = new Set(virtual.filter((v) => !items[v.index]).map((v) => Math.floor(v.index / PAGE_SIZE) * PAGE_SIZE));
    pages.forEach((p) => void loadPage(p));
  }, [virtual, items, loadPage]);

  useEffect(() => {
    rows.scrollToOffset(0);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  // Move DOM focus with the keyboard cursor once the card is rendered.
  useEffect(() => {
    if (!wantFocus.current) return;
    const el = cardRefs.current.get(focused);
    if (el) {
      wantFocus.current = false;
      el.focus({ preventScroll: true });
    }
  });

  const label = useCallback(
    (variable: string, value: CellValue) => {
      const v = meta.variables.find((x) => x.name === variable);
      const l = v?.value_labels.find((x) => String(x.value) === String(value));
      return l?.label ?? "";
    },
    [meta],
  );

  const move = (to: number) => {
    if (!total) return;
    const i = Math.max(0, Math.min(total - 1, to));
    wantFocus.current = true;
    setFocused(i);
    rows.scrollToIndex(i, { align: "auto" });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select, [role=menu]")) return;
    if (e.key === "ArrowDown" || e.key === "j") move(focused + 1);
    else if (e.key === "ArrowUp" || e.key === "k") move(focused - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(total - 1);
    else if (/^[1-9]$/.test(e.key)) {
      const tag = tags[Number(e.key) - 1];
      if (!tag) return;
      void toggleTag(focused, tag.id);
    } else return;
    e.preventDefault();
  };

  return (
    <div
      ref={scrollRef}
      onKeyDown={onKeyDown}
      className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/20"
      data-testid="response-list"
    >
      <div role="list" aria-label="Responses" style={{ height: rows.getTotalSize(), position: "relative" }}>
        {virtual.map((v) => {
          const item = items[v.index];
          return (
            <div
              key={v.key}
              role="listitem"
              data-index={v.index}
              ref={rows.measureElement}
              className="absolute inset-x-0 px-2 pt-2"
              style={{ transform: `translateY(${v.start}px)` }}
            >
              {item ? (
                <ResponseCard
                  ref={(el) => {
                    if (el) cardRefs.current.set(v.index, el);
                    else cardRefs.current.delete(v.index);
                  }}
                  index={v.index}
                  item={item}
                  tags={tags}
                  focused={v.index === focused}
                  label={label}
                  onFocus={() => v.index !== focused && setFocused(v.index)}
                  onToggle={(id) => void toggleTag(v.index, id)}
                />
              ) : (
                <div className="h-24 animate-pulse rounded-lg border bg-card" aria-hidden />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
