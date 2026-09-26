import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { TAG_PALETTE } from "@/lib/qualitative/highlight";
import type { Tag } from "@/lib/qualitative/types";
import { useQualitative } from "@/stores/qualitative";
import { Swatch } from "./TagChip";

const COLOR_NAMES: Record<string, string> = {
  "#0072B2": "Blue",
  "#E69F00": "Orange",
  "#009E73": "Green",
  "#CC79A7": "Pink",
  "#56B4E9": "Sky blue",
  "#D55E00": "Red-orange",
  "#F0E442": "Yellow",
  "#999999": "Grey",
};

function TagForm({ tag, onDone }: { tag: Tag | null; onDone: () => void }) {
  const saveTag = useQualitative((s) => s.saveTag);
  const used = useQualitative((s) => s.codebook.tags).map((t) => t.color);
  const [name, setName] = useState(tag?.name ?? "");
  const [definition, setDefinition] = useState(tag?.definition ?? "");
  const [color, setColor] = useState(tag?.color ?? TAG_PALETTE.find((c) => !used.includes(c)) ?? TAG_PALETTE[0]);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const ok = await saveTag({ id: tag?.id ?? null, name: name.trim(), definition: definition.trim(), color });
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <form onSubmit={submit} className="grid gap-2 rounded-md border bg-background p-3" aria-label={tag ? `Edit tag ${tag.name}` : "New tag"}>
      <label className="grid gap-1 text-xs font-medium">
        Tag name
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Confidence" data-testid="tag-name" />
      </label>
      <label className="grid gap-1 text-xs font-medium">
        Definition <span className="font-normal text-muted-foreground">(when should someone use this tag?)</span>
        <textarea
          value={definition}
          onChange={(e) => setDefinition(e.target.value)}
          rows={2}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          placeholder="e.g. Mentions feeling more or less sure about math."
          data-testid="tag-definition"
        />
      </label>
      <fieldset className="grid gap-1">
        <legend className="text-xs font-medium">Color</legend>
        <div className="flex flex-wrap gap-1.5">
          {TAG_PALETTE.map((c) => (
            <label key={c} className="cursor-pointer">
              <input type="radio" name="tag-color" value={c} checked={color === c} onChange={() => setColor(c)} className="peer sr-only" aria-label={COLOR_NAMES[c]} />
              <span
                className="block size-6 rounded-full border-2 border-transparent peer-checked:border-foreground peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50"
                style={{ backgroundColor: c }}
              />
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || !name.trim()} data-testid="tag-save">
          {tag ? "Save tag" : "Add tag"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** The tag codebook: name, color, and definition per tag; numbers 1–9 are keyboard shortcuts. */
export function CodebookPanel() {
  const tags = useQualitative((s) => s.codebook.tags);
  const deleteTag = useQualitative((s) => s.deleteTag);
  const [editing, setEditing] = useState<Tag | "new" | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <section aria-labelledby="codebook-title" className="grid content-start gap-3" data-testid="codebook-panel">
      <div className="flex items-center justify-between">
        <h2 id="codebook-title" className="text-sm font-semibold">
          Codebook
        </h2>
        {editing === null && (
          <Button size="xs" variant="outline" onClick={() => setEditing("new")} data-testid="new-tag">
            <Plus aria-hidden /> New tag
          </Button>
        )}
      </div>
      {editing === "new" && <TagForm tag={null} onDone={() => setEditing(null)} />}
      {tags.length === 0 && editing === null && (
        <p className="text-sm text-muted-foreground">
          A codebook is your list of themes. Add a tag for each idea you see in the answers, like “Confidence” or “Wants more
          practice.” Then tag each response with every idea it mentions.
        </p>
      )}
      <ol className="grid gap-2">
        {tags.map((t, i) =>
          editing !== "new" && editing?.id === t.id ? (
            <li key={t.id}>
              <TagForm tag={t} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={t.id} className="grid gap-1 rounded-md border bg-background p-2" data-testid="codebook-tag">
              <div className="flex items-center gap-2">
                {i < 9 && (
                  <kbd className="rounded border px-1 font-mono text-[10px] text-muted-foreground" title={`Press ${i + 1} to toggle this tag`}>
                    {i + 1}
                  </kbd>
                )}
                <Swatch color={t.color} />
                <span className="flex-1 text-sm font-medium">{t.name}</span>
                <Button size="icon-xs" variant="ghost" onClick={() => setEditing(t)} aria-label={`Edit tag ${t.name}`}>
                  <Pencil aria-hidden />
                </Button>
                <Button size="icon-xs" variant="ghost" onClick={() => setConfirm(t.id)} aria-label={`Delete tag ${t.name}`}>
                  <Trash2 aria-hidden />
                </Button>
              </div>
              {t.definition && <p className="text-xs text-muted-foreground">{t.definition}</p>}
              {confirm === t.id && (
                <div role="alert" className="flex flex-wrap items-center gap-2 text-xs">
                  Delete “{t.name}”? It will be removed from every response.
                  <Button size="xs" variant="destructive" onClick={() => void deleteTag(t.id).then(() => setConfirm(null))}>
                    Delete
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setConfirm(null)}>
                    Keep
                  </Button>
                </div>
              )}
            </li>
          ),
        )}
      </ol>
      {tags.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Tip: click a response, then press <kbd className="font-mono">1</kbd>–<kbd className="font-mono">9</kbd> to add or remove a tag.
          Use the arrow keys to move between responses.
        </p>
      )}
    </section>
  );
}
