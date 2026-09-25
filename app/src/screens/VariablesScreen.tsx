import { useState } from "react";
import { Calculator, ClipboardList, Pencil, Redo2, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CheckboxField, Input, Notice } from "@/components/ui/form";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";
import { ComputedBuilder } from "@/components/variables/ComputedBuilder";
import { VariablesTable } from "@/components/variables/VariablesTable";
import type { DatasetMeta, Scale } from "@/contracts";
import { defaultMinItems } from "@/lib/interviewLogic";
import { EditError, edits, redoEdit, undoEdit } from "@/lib/variableEdits";
import { useDatasetStore, visibleVariables } from "@/stores/dataset";
import { useHistory } from "@/stores/history";
import { useInterview } from "@/stores/interview";
import { useNav } from "@/stores/nav";

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

export function UndoRedo() {
  const h = useHistory();
  const undoLabel = h.undoLabel();
  const redoLabel = h.redoLabel();
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Undo and redo">
      <Button
        variant="outline"
        size="sm"
        onClick={() => void undoEdit()}
        disabled={!h.canUndo()}
        title={undoLabel ? `Undo: ${undoLabel} (${MOD}Z)` : `Undo (${MOD}Z)`}
        aria-keyshortcuts="Meta+Z Control+Z"
        data-testid="undo"
      >
        <Undo2 aria-hidden /> Undo
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void redoEdit()}
        disabled={!h.canRedo()}
        title={redoLabel ? `Redo: ${redoLabel} (${MOD}⇧Z)` : `Redo (${MOD}⇧Z)`}
        aria-keyshortcuts="Meta+Shift+Z Control+Shift+Z"
        data-testid="redo"
      >
        <Redo2 aria-hidden /> Redo
      </Button>
    </div>
  );
}

function ScaleEditor({ scale, onClose }: { scale: Scale; onClose: () => void }) {
  const [name, setName] = useState(scale.name);
  const [method, setMethod] = useState(scale.scoring_method);
  const [minItems, setMinItems] = useState(String(scale.min_items ?? ""));
  const [error, setError] = useState<string | null>(null);
  const n = scale.items.length;
  const save = async () => {
    const mi = minItems.trim() === "" ? defaultMinItems(n, method) : Number(minItems);
    if (!Number.isInteger(mi) || mi < 1 || mi > n) {
      setError(`The minimum must be a whole number from 1 to ${n}.`);
      return;
    }
    try {
      await edits.upsertScale({ id: scale.id, name: name.trim(), items: scale.items, scoring_method: method, min_items: mi });
      onClose();
    } catch (e) {
      setError(e instanceof EditError ? e.message : String(e));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby="se-desc" className="max-w-lg">
        <DialogTitle>Edit scale</DialogTitle>
        <DialogDescription id="se-desc">
          {n} items: {scale.items.join(", ")}. Change which items belong to it in the table's Scale column.
        </DialogDescription>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Scale name" />
        </label>
        <RadioGroup value={method} onValueChange={(v) => setMethod(v as "mean" | "sum")} aria-label="Scale score">
          <RadioCard id="se-mean" value="mean" title="Average of the answered items" />
          <RadioCard id="se-sum" value="sum" title="Sum of the items" />
        </RadioGroup>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Minimum answered items</span>
          <Input type="number" min={1} max={n} value={minItems} placeholder={String(defaultMinItems(n, method))} onChange={(e) => setMinItems(e.target.value)} className="w-24" aria-label="Minimum answered items" />
          <span className="text-xs text-muted-foreground">Empty = default ({method === "mean" ? "half the items, rounded up" : "all items"}).</span>
        </label>
        {error && (
          <Notice tone="error" role="alert">
            {error}
          </Notice>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!name.trim()}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ScalesPanel({ meta }: { meta: DatasetMeta }) {
  const [editing, setEditing] = useState<Scale | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <section aria-labelledby="scales-title" className="grid content-start gap-2">
      <h2 id="scales-title" className="text-sm font-semibold">
        Scales
      </h2>
      {meta.scales.length === 0 && <p className="text-sm text-muted-foreground">No scales yet. Use the interview or the table's Scale column.</p>}
      <ul className="grid gap-2" data-testid="scales-list">
        {meta.scales.map((s) => (
          <li key={s.id} className="grid gap-1 rounded-md border p-2 text-sm">
            <div className="flex items-center gap-1">
              <span className="font-medium">{s.name}</span>
              <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label={`Edit scale ${s.name}`} onClick={() => setEditing(s)}>
                <Pencil aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Delete scale ${s.name}`}
                onClick={() => void edits.deleteScale(s.id).catch((e) => setError(e instanceof EditError ? e.message : String(e)))}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">
              {s.scoring_method === "mean" ? "Average" : "Sum"} of {s.items.length} items
              {s.min_items ? `, needs ${s.min_items} answered` : ""}
              {s.score_variable ? ` → ${s.score_variable}` : " (not scored yet)"}
            </span>
          </li>
        ))}
      </ul>
      {error && (
        <Notice tone="error" role="alert">
          {error}
        </Notice>
      )}
      {editing && <ScaleEditor scale={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function HistoryPanel() {
  const entries = useHistory((s) => s.entries);
  const cursor = useHistory((s) => s.cursor);
  if (!entries.length) return null;
  return (
    <section aria-labelledby="history-title" className="grid content-start gap-2">
      <h2 id="history-title" className="text-sm font-semibold">
        Changes
      </h2>
      <ol className="grid max-h-60 gap-0.5 overflow-auto text-xs" data-testid="history-list">
        {entries.map((e, i) => (
          <li key={e.snapshot_id} aria-current={i === cursor ? "step" : undefined} className={i === cursor ? "font-semibold" : i > cursor ? "text-muted-foreground line-through" : ""}>
            {e.label}
            {i === cursor && <span className="sr-only"> (current)</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Variables screen (SPEC §6): editable table, scales, calculated variables, undo/redo. */
export function VariablesScreen() {
  const meta = useDatasetStore((s) => s.meta);
  const showMetadata = useDatasetStore((s) => s.showMetadata);
  const setShowMetadata = useDatasetStore((s) => s.setShowMetadata);
  const go = useNav((s) => s.go);
  const resetInterview = useInterview((s) => s.reset);
  const [builder, setBuilder] = useState(false);

  if (!meta) {
    return (
      <div className="mx-auto grid max-w-md gap-4 text-center">
        <h1 className="text-xl font-semibold">No data yet</h1>
        <p className="text-muted-foreground">Import a file to set up its variables.</p>
      </div>
    );
  }
  const vars = visibleVariables(meta, showMetadata);
  const metaCount = meta.variables.filter((v) => v.is_metadata).length;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-lg font-semibold" data-testid="variables-title">
          Variables
        </h1>
        <p className="text-sm text-muted-foreground">{meta.variables.length} variables</p>
        <UndoRedo />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {metaCount > 0 && <CheckboxField label={`Show survey system columns (${metaCount})`} checked={showMetadata} onChange={(e) => setShowMetadata(e.target.checked)} />}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              resetInterview();
              go("interview");
            }}
          >
            <ClipboardList aria-hidden /> Variable interview
          </Button>
          <Button size="sm" onClick={() => setBuilder(true)} data-testid="new-computed">
            <Calculator aria-hidden /> New calculated variable
          </Button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-h-[20rem] min-w-0">
          <VariablesTable meta={meta} variables={vars} />
        </div>
        <aside className="grid min-h-0 content-start gap-5 overflow-auto rounded-md border p-4">
          <ScalesPanel meta={meta} />
          <HistoryPanel />
        </aside>
      </div>
      <ComputedBuilder meta={meta} open={builder} onOpenChange={setBuilder} />
    </div>
  );
}
