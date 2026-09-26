import { X } from "lucide-react";
import type { Tag } from "@/lib/qualitative/types";
import { textOn } from "@/lib/qualitative/highlight";

/** A tag's color swatch + name; with `onRemove`, a keyboard-reachable remove button. */
export function TagChip({ tag, onRemove }: { tag: Tag; onRemove?: () => void }) {
  const fg = textOn(tag.color);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: tag.color, color: fg }}
      data-testid="tag-chip"
    >
      {tag.name}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove tag ${tag.name}`}
          className="-mr-1 rounded-full p-0.5 outline-none hover:bg-black/15 focus-visible:ring-2 focus-visible:ring-current"
        >
          <X className="size-3" aria-hidden />
        </button>
      )}
    </span>
  );
}

export function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="inline-block size-3 shrink-0 rounded-full border border-black/20" style={{ backgroundColor: color }} />;
}
