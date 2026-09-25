import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Calculator, ListOrdered, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Badge, Input, NativeSelect, Notice } from "@/components/ui/form";
import { SortableLabels } from "@/components/variables/SortableLabels";
import type { DatasetMeta, MeasurementLevel, Scale, ValueLabel, VariableRole, VariableSchema } from "@/contracts";
import { LEVEL_OPTIONS, ROLE_OPTIONS, roleTitle } from "@/lib/interviewLogic";
import { EditError, edits } from "@/lib/variableEdits";
import type { VariablePatch } from "@/lib/variablesRpc";
import { useNotify } from "@/stores/notify";

const ROW_H = 44;
export const COLUMNS = [
  { key: "name", title: "Name", width: "11rem" },
  { key: "label", title: "Label", width: "12rem" },
  { key: "question", title: "Question text", width: "18rem" },
  { key: "role", title: "Role", width: "11rem" },
  { key: "level", title: "Level", width: "9rem" },
  { key: "labels", title: "Value labels", width: "8rem" },
  { key: "reverse", title: "Reverse-coded", width: "7rem" },
  { key: "scale", title: "Scale", width: "10rem" },
  { key: "missing", title: "Missing codes", width: "8rem" },
] as const;
const TEMPLATE = COLUMNS.map((c) => c.width).join(" ");
const NUMERIC = new Set(["integer", "float", "boolean"]);

async function save(patch: VariablePatch) {
  try {
    await edits.updateVariables([patch]);
  } catch (e) {
    useNotify.getState().show(e instanceof EditError ? e.message : "That change couldn't be saved.", "error");
  }
}

/** Text cell: edits locally, saves on Enter or when focus leaves; Escape cancels. */
function TextCell({ value, label, onSave, multiline = false }: { value: string | null; label: string; onSave: (v: string | null) => void; multiline?: boolean }) {
  const [draft, setDraft] = useState(value ?? "");
  const cancelled = useRef(false);
  useEffect(() => setDraft(value ?? ""), [value]);
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const next = draft.trim() === "" ? null : draft;
    if (next !== (value ?? null)) onSave(next);
  };
  return (
    <Input
      aria-label={label}
      value={draft}
      title={multiline ? (value ?? undefined) : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          setDraft(value ?? "");
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="h-8"
    />
  );
}

export function parseCodes(text: string, numeric: boolean): (number | string)[] {
  return text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (numeric && Number.isFinite(Number(t)) ? Number(t) : t));
}

function LabelsDialog({ v, onClose }: { v: VariableSchema; onClose: () => void }) {
  const [labels, setLabels] = useState<ValueLabel[]>(v.value_labels.map((l) => ({ ...l })));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby="vl-desc" className="max-w-lg">
        <DialogTitle>Answer choices for {v.name}</DialogTitle>
        <DialogDescription id="vl-desc">Drag or use the arrows to set the order; edit the labels people will see.</DialogDescription>
        <SortableLabels labels={labels} onChange={setLabels} ariaLabel={`Answer choices for ${v.name}`} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onClose();
              if (JSON.stringify(labels) !== JSON.stringify(v.value_labels)) void save({ name: v.name, value_labels: labels });
            }}
          >
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

async function moveToScale(meta: DatasetMeta, v: VariableSchema, target: string) {
  try {
    if (target === "") {
      const cur = meta.scales.find((s) => s.items.includes(v.name));
      if (!cur) return;
      await edits.upsertScale({ id: cur.id, name: cur.name, items: cur.items.filter((i) => i !== v.name), scoring_method: cur.scoring_method, min_items: null });
    } else {
      const s = meta.scales.find((x) => x.id === target)!;
      await edits.upsertScale({
        id: s.id,
        name: s.name,
        items: [...s.items, v.name],
        scoring_method: s.scoring_method,
        min_items: s.min_items === null ? null : Math.min(s.min_items, s.items.length + 1),
      });
    }
  } catch (e) {
    useNotify.getState().show(e instanceof EditError ? e.message : "That change couldn't be saved.", "error");
  }
}

function Row({ v, meta, scales, onLabels, style, index }: { v: VariableSchema; meta: DatasetMeta; scales: Scale[]; onLabels: () => void; style: React.CSSProperties; index: number }) {
  const scale = scales.find((s) => s.items.includes(v.name)) ?? null;
  const numeric = NUMERIC.has(v.dtype);
  const [codes, setCodes] = useState(v.missing_codes.join(", "));
  useEffect(() => setCodes(v.missing_codes.join(", ")), [v.missing_codes]);
  const isScore = !!v.computed && (v.computed.op === "scale_mean" || v.computed.op === "scale_sum");
  return (
    <div role="row" aria-rowindex={index + 2} style={{ ...style, gridTemplateColumns: TEMPLATE }} className="absolute inset-x-0 grid items-center gap-2 border-b px-2" data-testid={`var-row-${v.name}`}>
      <div role="rowheader" className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-mono text-sm font-medium" title={v.name}>
          {v.name}
        </span>
        {v.computed && (
          <Badge tone="info" title="Calculated by Statly">
            <Calculator className="size-3" aria-hidden />
            <span className="sr-only">calculated</span>
          </Badge>
        )}
        {v.computed && !isScore && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove calculated variable ${v.name}`}
            onClick={() => void edits.removeComputed(v.name).catch((e) => useNotify.getState().show(e instanceof EditError ? e.message : String(e), "error"))}
          >
            <Trash2 aria-hidden />
          </Button>
        )}
      </div>
      <div role="cell">
        <TextCell value={v.label} label={`Label for ${v.name}`} onSave={(label) => void save({ name: v.name, label })} />
      </div>
      <div role="cell">
        <TextCell value={v.question_text} label={`Question text for ${v.name}`} multiline onSave={(question_text) => void save({ name: v.name, question_text })} />
      </div>
      <div role="cell">
        <NativeSelect aria-label={`Role of ${v.name}`} value={v.role} onChange={(e) => void save({ name: v.name, role: e.target.value as VariableRole })} className="h-8 w-full">
          {v.role === "unassigned" && <option value="unassigned">Not set</option>}
          {v.role === "scale_score" && <option value="scale_score">{roleTitle("scale_score")}</option>}
          {ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.title}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div role="cell">
        <NativeSelect aria-label={`Level of ${v.name}`} value={v.level} onChange={(e) => void save({ name: v.name, level: e.target.value as MeasurementLevel })} className="h-8 w-full">
          {LEVEL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.value}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div role="cell">
        <Button variant="outline" size="xs" onClick={onLabels} disabled={!v.value_labels.length} aria-label={`Edit value labels of ${v.name}`}>
          <ListOrdered aria-hidden /> {v.value_labels.length || "None"}
        </Button>
      </div>
      <div role="cell" className="flex justify-center">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          aria-label={`Reverse-code ${v.name}`}
          checked={v.reverse_coded}
          disabled={!numeric || !!v.computed}
          onChange={(e) => void save({ name: v.name, reverse_coded: e.target.checked })}
        />
      </div>
      <div role="cell">
        {isScore ? (
          <span className="text-xs text-muted-foreground">Score of {scales.find((s) => s.score_variable === v.name)?.name ?? "a scale"}</span>
        ) : (
          <NativeSelect
            aria-label={`Scale of ${v.name}`}
            value={scale?.id ?? ""}
            disabled={!numeric || !!v.computed}
            onChange={(e) => void moveToScale(meta, v, e.target.value)}
            className="h-8 w-full"
          >
            <option value="">—</option>
            {scales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>
      <div role="cell">
        <Input
          aria-label={`Missing codes for ${v.name}`}
          value={codes}
          placeholder="e.g. -99"
          disabled={!!v.computed}
          onChange={(e) => setCodes(e.target.value)}
          onBlur={() => {
            const next = parseCodes(codes, numeric);
            if (JSON.stringify(next) !== JSON.stringify(v.missing_codes)) void save({ name: v.name, missing_codes: next });
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="h-8"
        />
      </div>
    </div>
  );
}

/** Editable, virtualized table of variables (SPEC §6 Variables screen). Every edit is one undo step. */
export function VariablesTable({ meta, variables }: { meta: DatasetMeta; variables: VariableSchema[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [labelsFor, setLabelsFor] = useState<string | null>(null);
  const rows = useVirtualizer({ count: variables.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H, overscan: 8 });
  const editing = labelsFor ? variables.find((v) => v.name === labelsFor) : null;
  if (!variables.length) return <Notice>No variables to show.</Notice>;
  return (
    <div ref={scrollRef} className="h-full min-h-[20rem] overflow-auto rounded-md border" data-testid="variables-table">
      <div role="table" aria-label="Variables" aria-rowcount={variables.length + 1} className="relative min-w-max">
        <div role="row" aria-rowindex={1} className="sticky top-0 z-10 grid gap-2 border-b bg-muted px-2 py-2 text-xs font-medium" style={{ gridTemplateColumns: TEMPLATE }}>
          {COLUMNS.map((c) => (
            <div key={c.key} role="columnheader">
              {c.title}
            </div>
          ))}
        </div>
        <div role="rowgroup" style={{ height: rows.getTotalSize(), position: "relative" }}>
          {rows.getVirtualItems().map((r) => {
            const v = variables[r.index];
            return (
              <Row
                key={v.name}
                v={v}
                meta={meta}
                scales={meta.scales}
                index={r.index}
                onLabels={() => setLabelsFor(v.name)}
                style={{ top: r.start, height: r.size }}
              />
            );
          })}
        </div>
      </div>
      {editing && <LabelsDialog v={editing} onClose={() => setLabelsFor(null)} />}
    </div>
  );
}
