import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CheckboxField, Input, NativeSelect, Notice } from "@/components/ui/form";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";
import { WhyItMatters } from "@/components/ui/why";
import type { ComputedDefinition, DatasetMeta, RecodeRule, VariableOperand, VariableSchema } from "@/contracts";
import { formatCell } from "@/components/data/DataGrid";
import { defaultMinItems } from "@/lib/interviewLogic";
import { rpc } from "@/lib/rpc";
import { describeEditError, EditError, edits } from "@/lib/variableEdits";
import type { ComputedPreviewResult } from "@/lib/variablesRpc";

export type BuilderKind = "gain" | "normalized_gain" | "scale" | "recode";

const KINDS: { value: BuilderKind; title: string; description: string }[] = [
  { value: "gain", title: "Gain score", description: "How much a score changed: later score minus earlier score (post − pre)." },
  { value: "normalized_gain", title: "Normalized gain", description: "The share of the possible improvement that was actually gained (Hake's g). Needs the maximum possible score." },
  { value: "scale", title: "Average or total of questions", description: "Combine several numeric questions into one score." },
  { value: "recode", title: "Recode", description: "Give answers new values, for example group 1–3 into 'low', or 4–5 into 'high'." },
];

const NUMERIC = new Set(["integer", "float", "boolean"]);

interface RecodeRow {
  from: string;
  to: string;
}

interface BuilderState {
  kind: BuilderKind;
  name: string;
  label: string;
  /** gain / normalized gain */
  mode: "columns" | "time";
  later: string;
  earlier: string;
  variable: string;
  laterLevel: string;
  earlierLevel: string;
  maxScore: string;
  /** scale */
  items: string[];
  method: "scale_mean" | "scale_sum";
  minItems: string;
  /** recode */
  source: string;
  rows: RecodeRow[];
  unmatched: "keep" | "missing";
}

const toValue = (s: string): number | string => (s.trim() !== "" && Number.isFinite(Number(s)) ? Number(s) : s.trim());

/** Build the ComputedDefinition from the form, or a plain-language reason it isn't ready. */
export function definitionFrom(b: BuilderState): ComputedDefinition | string {
  const opnd = (variable: string, level: string | null): VariableOperand => ({ variable, time_level: level });
  if (b.kind === "gain" || b.kind === "normalized_gain") {
    let later: VariableOperand;
    let earlier: VariableOperand;
    if (b.mode === "time") {
      if (!b.variable) return "Choose the score.";
      if (!b.laterLevel || !b.earlierLevel || b.laterLevel === b.earlierLevel) return "Choose two different time points.";
      later = opnd(b.variable, b.laterLevel);
      earlier = opnd(b.variable, b.earlierLevel);
    } else {
      if (!b.later || !b.earlier) return "Choose the later and the earlier score.";
      if (b.later === b.earlier) return "Choose two different scores.";
      later = opnd(b.later, null);
      earlier = opnd(b.earlier, null);
    }
    if (b.kind === "gain") return { op: "difference", minuend: later, subtrahend: earlier };
    const max = Number(b.maxScore);
    if (!b.maxScore.trim() || !Number.isFinite(max) || max <= 0) return "Enter the maximum possible score (a number above 0).";
    return { op: "normalized_gain", pre: earlier, post: later, max_score: max };
  }
  if (b.kind === "scale") {
    if (b.items.length < 2) return "Choose at least two questions.";
    const mi = b.minItems.trim() === "" ? null : Number(b.minItems);
    if (mi !== null && (!Number.isInteger(mi) || mi < 1 || mi > b.items.length)) return `The minimum must be a whole number from 1 to ${b.items.length}.`;
    return { op: b.method, items: b.items as [string, ...string[]], min_items: mi, scale_id: null };
  }
  if (!b.source) return "Choose the variable to recode.";
  const rules: RecodeRule[] = [];
  for (const r of b.rows) {
    if (!r.from.trim()) continue;
    const range = /^\s*(-?\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(-?\d+(?:\.\d+)?)\s*$/.exec(r.from);
    const to = r.to.trim() === "" ? null : toValue(r.to);
    if (range) rules.push({ from_values: null, from_range: { min: Number(range[1]), max: Number(range[2]) }, to });
    else rules.push({ from_values: r.from.split(",").map((x) => toValue(x)).filter((x) => x !== ""), from_range: null, to });
  }
  if (!rules.length) return "Add at least one rule.";
  return { op: "recode", source: b.source, rules: rules as [RecodeRule, ...RecodeRule[]], unmatched: b.unmatched };
}

function suggestName(b: BuilderState, meta: DatasetMeta): string {
  const base =
    b.kind === "gain"
      ? `${b.mode === "time" ? b.variable : b.later}_gain`
      : b.kind === "normalized_gain"
        ? `${b.mode === "time" ? b.variable : b.later}_ngain`
        : b.kind === "scale"
          ? `${b.items[0]?.replace(/_\d+$/, "") ?? "items"}_${b.method === "scale_mean" ? "mean" : "sum"}`
          : `${b.source}_recoded`;
  const taken = new Set(meta.variables.map((v) => v.name));
  let name = base;
  for (let k = 2; taken.has(name); k++) name = `${base}_${k}`;
  return name;
}

function VarSelect({ label, value, onChange, vars }: { label: string; value: string; onChange: (v: string) => void; vars: VariableSchema[] }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <NativeSelect value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">Choose…</option>
        {vars.map((v) => (
          <option key={v.name} value={v.name}>
            {v.name}
            {v.label ? ` — ${v.label}` : ""}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}

/** Guided builder for calculated variables (no formula language), with a 10-row preview before adding. */
export function ComputedBuilder({ meta, open, onOpenChange, initialKind = "gain" }: { meta: DatasetMeta; open: boolean; onOpenChange: (o: boolean) => void; initialKind?: BuilderKind }) {
  const levels = meta.stacking?.levels.map((l) => l.label) ?? [];
  const linked = meta.link.mode === "linked" && levels.length >= 2;
  const numeric = meta.variables.filter((v) => NUMERIC.has(v.dtype) && !v.is_metadata).sort((a, b) => a.display_order - b.display_order);
  const all = meta.variables.filter((v) => !v.is_metadata).sort((a, b) => a.display_order - b.display_order);
  const fresh = (): BuilderState => ({
    kind: initialKind,
    name: "",
    label: "",
    mode: linked ? "time" : "columns",
    later: "",
    earlier: "",
    variable: "",
    laterLevel: levels[levels.length - 1] ?? "",
    earlierLevel: levels[0] ?? "",
    maxScore: "",
    items: [],
    method: "scale_mean",
    minItems: "",
    source: "",
    rows: [{ from: "", to: "" }],
    unmatched: "keep",
  });
  const [b, setB] = useState<BuilderState>(fresh);
  const [nameTouched, setNameTouched] = useState(false);
  const [preview, setPreview] = useState<{ key: string; res: ComputedPreviewResult } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setB(fresh());
      setNameTouched(false);
      setPreview(null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (p: Partial<BuilderState>) => setB((cur) => ({ ...cur, ...p }));
  const def = definitionFrom(b);
  const defKey = typeof def === "string" ? "" : JSON.stringify(def);
  const name = nameTouched ? b.name : suggestName(b, meta);

  // Preview the first 10 values whenever the definition is complete.
  useEffect(() => {
    if (!open || typeof def === "string") return;
    let live = true;
    setPreviewing(true);
    setPreviewError(null);
    const t = window.setTimeout(() => {
      rpc
        .previewComputed({ dataset_id: meta.dataset_id, definition: def })
        .then((res) => live && setPreview({ key: defKey, res }))
        .catch((e) => live && (setPreview(null), setPreviewError(describeEditError(e))))
        .finally(() => live && setPreviewing(false));
    }, 200);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defKey, open, meta.snapshot_id]);

  const ready = typeof def !== "string" && preview?.key === defKey && !!name.trim();
  const add = async () => {
    if (typeof def === "string") return;
    setSaving(true);
    setError(null);
    try {
      await edits.addComputed({ name: name.trim(), label: b.label.trim() || null, definition: def });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof EditError ? e.message : describeEditError(e));
    } finally {
      setSaving(false);
    }
  };

  const sourceVar = meta.variables.find((v) => v.name === b.source);
  const levelSelect = (label: string, value: string, onChange: (v: string) => void) => (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <NativeSelect value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {levels.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </NativeSelect>
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="cb-desc" className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogTitle>New calculated variable</DialogTitle>
        <DialogDescription id="cb-desc">Pick what to calculate, fill in the blanks, check the preview, then add it.</DialogDescription>

        <RadioGroup value={b.kind} onValueChange={(v) => set({ kind: v as BuilderKind })} aria-label="What to calculate">
          <div className="grid gap-2 sm:grid-cols-2">
            {KINDS.map((k) => (
              <RadioCard key={k.value} id={`cb-${k.value}`} value={k.value} title={k.title}>
                {k.description}
              </RadioCard>
            ))}
          </div>
        </RadioGroup>

        {(b.kind === "gain" || b.kind === "normalized_gain") && (
          <div className="grid gap-3">
            {levels.length >= 2 && (
              <RadioGroup value={b.mode} onValueChange={(v) => set({ mode: v as "columns" | "time" })} aria-label="Where are the two scores?">
                <RadioCard id="cb-mode-time" value="time" title="One score measured at two time points">
                  {linked
                    ? "Statly finds each person's earlier and later answer using the linked ID and writes the result on all of that person's rows."
                    : "Link people across time on the Data screen first; without linking Statly can't tell which rows belong to the same person."}
                </RadioCard>
                <RadioCard id="cb-mode-cols" value="columns" title="Two columns in the same row" />
              </RadioGroup>
            )}
            {b.mode === "time" && levels.length >= 2 ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <VarSelect label="Score" value={b.variable} onChange={(variable) => set({ variable })} vars={numeric} />
                {levelSelect("Later time point", b.laterLevel, (laterLevel) => set({ laterLevel }))}
                {levelSelect("Earlier time point", b.earlierLevel, (earlierLevel) => set({ earlierLevel }))}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <VarSelect label="Later score (post)" value={b.later} onChange={(later) => set({ later })} vars={numeric} />
                <VarSelect label="Earlier score (pre)" value={b.earlier} onChange={(earlier) => set({ earlier })} vars={numeric} />
              </div>
            )}
            {b.kind === "normalized_gain" && (
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Maximum possible score</span>
                <Input type="number" value={b.maxScore} onChange={(e) => set({ maxScore: e.target.value })} className="w-32" aria-label="Maximum possible score" />
              </label>
            )}
          </div>
        )}

        {b.kind === "scale" && (
          <div className="grid gap-3">
            <fieldset className="grid max-h-48 gap-1 overflow-auto rounded-md border p-2">
              <legend className="px-1 text-sm font-medium">Questions to combine</legend>
              {numeric.map((v) => (
                <CheckboxField
                  key={v.name}
                  label={`${v.name}${v.reverse_coded ? " (reverse-scored)" : ""}`}
                  checked={b.items.includes(v.name)}
                  onChange={(e) => set({ items: e.target.checked ? [...b.items, v.name] : b.items.filter((i) => i !== v.name) })}
                />
              ))}
            </fieldset>
            <div className="flex flex-wrap gap-4">
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Combine by</span>
                <NativeSelect value={b.method} onChange={(e) => set({ method: e.target.value as "scale_mean" | "scale_sum" })} aria-label="Combine by">
                  <option value="scale_mean">Average of answered questions</option>
                  <option value="scale_sum">Sum</option>
                </NativeSelect>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">At least this many answered</span>
                <Input
                  type="number"
                  className="w-24"
                  aria-label="Minimum answered questions"
                  placeholder={String(defaultMinItems(b.items.length || 2, b.method === "scale_mean" ? "mean" : "sum"))}
                  value={b.minItems}
                  onChange={(e) => set({ minItems: e.target.value })}
                />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">Leave the minimum empty for: at least one answer (average) or every question (sum). Reverse-scored questions are flipped first.</p>
          </div>
        )}

        {b.kind === "recode" && (
          <div className="grid gap-3">
            <VarSelect label="Variable to recode" value={b.source} onChange={(source) => set({ source })} vars={all.filter((v) => !v.computed || v.computed.op === "recode")} />
            {sourceVar?.value_labels.length ? (
              <p className="text-xs text-muted-foreground">
                Its answers: {sourceVar.value_labels.map((l) => (String(l.value) === l.label ? l.label : `${String(l.value)} = ${l.label}`)).join(", ")}
              </p>
            ) : null}
            <div className="grid gap-2">
              {b.rows.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input aria-label={`Rule ${i + 1}: old values`} placeholder="Old values, e.g. 1, 2 or 1-3" value={r.from} onChange={(e) => set({ rows: b.rows.map((x, k) => (k === i ? { ...x, from: e.target.value } : x)) })} />
                  <span aria-hidden>→</span>
                  <Input aria-label={`Rule ${i + 1}: new value`} placeholder="New value (empty = missing)" value={r.to} onChange={(e) => set({ rows: b.rows.map((x, k) => (k === i ? { ...x, to: e.target.value } : x)) })} />
                  <Button variant="ghost" size="icon-xs" aria-label={`Remove rule ${i + 1}`} disabled={b.rows.length === 1} onClick={() => set({ rows: b.rows.filter((_, k) => k !== i) })}>
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              ))}
              <div>
                <Button variant="outline" size="xs" onClick={() => set({ rows: [...b.rows, { from: "", to: "" }] })}>
                  <Plus aria-hidden /> Add a rule
                </Button>
              </div>
            </div>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Answers no rule covers</span>
              <NativeSelect value={b.unmatched} onChange={(e) => set({ unmatched: e.target.value as "keep" | "missing" })} aria-label="Answers no rule covers">
                <option value="keep">Keep as they are</option>
                <option value="missing">Make them missing</option>
              </NativeSelect>
            </label>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Name</span>
            <Input value={name} onChange={(e) => (setNameTouched(true), set({ name: e.target.value }))} aria-label="New variable name" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Label (optional)</span>
            <Input value={b.label} onChange={(e) => set({ label: e.target.value })} aria-label="New variable label" />
          </label>
        </div>

        <section aria-labelledby="cb-preview" className="grid gap-2 rounded-md border p-3" aria-busy={previewing}>
          <h3 id="cb-preview" className="text-sm font-semibold">
            Preview (first 10 rows)
          </h3>
          {typeof def === "string" ? (
            <p className="text-sm text-muted-foreground">{def}</p>
          ) : previewError ? (
            <Notice tone="error" role="alert">
              {previewError}
            </Notice>
          ) : preview ? (
            <>
              <ol className="flex flex-wrap gap-1.5" data-testid="computed-preview">
                {preview.res.values.map((x, i) => (
                  <li key={i} className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                    {x === null ? "missing" : formatCell(x)}
                  </li>
                ))}
              </ol>
              <p className="text-xs text-muted-foreground">
                {preview.res.n_valid} rows get a value, {preview.res.n_missing} are missing.
              </p>
              {preview.res.warnings.map((w, i) => (
                <Notice key={i} tone="warn">
                  {w.message}
                </Notice>
              ))}
            </>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Calculating…
            </p>
          )}
        </section>

        {b.kind === "normalized_gain" && (
          <WhyItMatters title="What is a normalized gain?">
            <p>
              A student who starts at 90 out of 100 can only gain 10 points, while one who starts at 20 can gain 80. The normalized gain
              divides what was gained by what could have been gained: (post − pre) ÷ (maximum − pre). A value of 0.5 means the student
              gained half of the points they were missing.
            </p>
          </WhyItMatters>
        )}

        {error && (
          <Notice tone="error" role="alert">
            {error}
          </Notice>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void add()} disabled={!ready || saving} data-testid="computed-add">
            {saving && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />}
            Add variable
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

