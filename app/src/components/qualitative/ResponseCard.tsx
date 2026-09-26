import { forwardRef } from "react";
import { Check, Tags } from "lucide-react";
import { cn } from "cn";
import type { CellValue } from "@/contracts";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ResponseItem, Tag } from "@/lib/qualitative/types";
import { Highlighted } from "./Highlighted";
import { Swatch, TagChip } from "./TagChip";

function show(v: CellValue): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

interface Props {
  index: number;
  item: ResponseItem;
  tags: Tag[];
  focused: boolean;
  /** Label lookup for context values (value labels), by variable. */
  label: (variable: string, value: CellValue) => string;
  onToggle: (tagId: string) => void;
  onFocus: () => void;
}

/** One open-ended response: who wrote it (group/time), the text with matches, and its tags. */
export const ResponseCard = forwardRef<HTMLElement, Props>(function ResponseCard(
  { index, item, tags, focused, label, onToggle, onFocus },
  ref,
) {
  const byId = new Map(tags.map((t) => [t.id, t]));
  const ctx = Object.entries(item.context);
  return (
    <article
      ref={ref}
      tabIndex={focused ? 0 : -1}
      onFocus={(e) => e.target === e.currentTarget && onFocus()}
      onMouseDown={onFocus}
      aria-label={`Response ${index + 1}, row ${item.row_id + 1}`}
      data-testid="response-card"
      data-row-id={item.row_id}
      className={cn(
        "grid gap-2 rounded-lg border bg-card p-3 outline-none",
        focused && "border-primary ring-2 ring-primary/30",
        "focus-visible:ring-[3px] focus-visible:ring-ring/60",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Row {item.row_id + 1}</span>
        {ctx.map(([k, v]) => (
          <span key={k}>
            {k}: <span className="text-foreground">{v === null ? "—" : label(k, v) || show(v)}</span>
          </span>
        ))}
      </div>
      <Highlighted text={item.text} spans={item.matches} />
      <div className="flex flex-wrap items-center gap-1.5">
        {item.tag_ids.map((id) => {
          const t = byId.get(id);
          return t ? <TagChip key={id} tag={t} onRemove={() => onToggle(id)} /> : null;
        })}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="xs" disabled={!tags.length} data-testid="tag-menu" aria-label={`Tag response ${index + 1}`}>
              <Tags aria-hidden /> {item.tag_ids.length ? "Edit tags" : "Add tag"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {tags.map((t, i) => {
              const on = item.tag_ids.includes(t.id);
              return (
                <DropdownMenuItem
                  key={t.id}
                  onSelect={(e) => {
                    e.preventDefault();
                    onToggle(t.id);
                  }}
                  aria-checked={on}
                  role="menuitemcheckbox"
                >
                  <Check className={cn("size-4", !on && "invisible")} aria-hidden />
                  <Swatch color={t.color} />
                  {t.name}
                  {i < 9 && <DropdownMenuShortcut>{i + 1}</DropdownMenuShortcut>}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
});
