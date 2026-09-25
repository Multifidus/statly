import { useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { FileUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, CheckboxField, Input, NativeSelect, Notice } from "@/components/ui/form";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";
import { WhyItMatters } from "@/components/ui/why";
import { SortableLabels } from "@/components/variables/SortableLabels";
import type { MeasurementLevel, VariableRole, VariableSchema } from "@/contracts";
import { pickAnswerKeyFile } from "@/lib/dialogs";
import {
  activeScales,
  buildPlan,
  defaultMinItems,
  LEVEL_OPTIONS,
  likertItems,
  moveItem,
  ROLE_OPTIONS,
  roleTitle,
  testItems,
  type DraftScale,
  type Unit,
} from "@/lib/interviewLogic";
import { rpc } from "@/lib/rpc";
import { describeEditError } from "@/lib/variableEdits";
import { useDatasetStore } from "@/stores/dataset";
import { useInterview } from "@/stores/interview";

const useByName = () => {
  const meta = useDatasetStore((s) => s.meta);
  return new Map((meta?.variables ?? []).map((v) => [v.name, v]));
};

function useUnit(unitId: string): { unit: Unit; vars: VariableSchema[] } | null {
  const units = useInterview((s) => s.units);
  const byName = useByName();
  const unit = units.find((u) => u.id === unitId);
  if (!unit) return null;
  return { unit, vars: unit.names.map((n) => byName.get(n)!).filter(Boolean) };
}

/** The column(s) being asked about: question text + a sample of answers. */
function UnitCard({ unit, vars }: { unit: Unit; vars: VariableSchema[] }) {
  const stats = useInterview((s) => s.stats);
  const first = vars[0];
  const sample = (stats[first?.name]?.distinct ?? []).slice(0, 8);
  const labelOf = (x: unknown) => first?.value_labels.find((l) => String(l.value) === String(x))?.label;
  return (
    <div className="grid gap-2 rounded-lg border bg-muted/30 p-4" data-testid="unit-card">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-sm font-semibold">{unit.title}</span>
        {unit.kind !== "single" && (
          <span className="text-xs text-muted-foreground">
            {vars.map((v) => v.name).slice(0, 8).join(", ")}
            {vars.length > 8 ? ", …" : ""}
          </span>
        )}
      </div>
      {unit.questionText && <p className="text-sm">“{unit.questionText}”</p>}
      {sample.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Some answers{unit.kind !== "single" ? ` (${first.name})` : ""}:{" "}
          {sample.map((x, i) => (
            <span key={i}>
              {i > 0 && ", "}
              <span className="text-foreground">{String(x)}</span>
              {labelOf(x) && labelOf(x) !== String(x) && <span> ({labelOf(x)})</span>}
            </span>
          ))}
          {(stats[first.name]?.nDistinct ?? 0) > sample.length && " …"}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">No answers yet in this column.</p>
      )}
    </div>
  );
}

// --- intro -------------------------------------------------------------------------------

export function StepIntro() {
  const units = useInterview((s) => s.units);
  return (
    <div className="grid gap-4">
      <p>
        Let's set up your variables. Statly will go through your questions one at a time and ask what each one is. It has
        already made a best guess for each answer, so often you only need to check it and press <strong>Continue</strong>.
      </p>
      <p className="text-sm text-muted-foreground">
        {units.length} question{units.length === 1 ? "" : "s"} to check. Survey-system columns (like StartDate) are kept but hidden, so
        they are skipped. You can change every answer later on the Variables screen.
      </p>
      <WhyItMatters>
        <p>
          Statly can't tell from the numbers alone whether a column is a group, a test score, or a survey question. Telling it once
          means it can recommend the right tests, score your tests and scales correctly, and explain results in plain words.
        </p>
      </WhyItMatters>
    </div>
  );
}

// --- role --------------------------------------------------------------------------------

export function StepRole({ unitId }: { unitId: string }) {
  const u = useUnit(unitId);
  const answer = useInterview((s) => s.draft?.answers[unitId]);
  const setAnswer = useInterview((s) => s.setAnswer);
  if (!u || !answer) return null;
  const options = ROLE_OPTIONS.filter((o) => o.value !== "time" || u.vars[0]?.role === "time");
  return (
    <div className="grid gap-4">
      <UnitCard unit={u.unit} vars={u.vars} />
      <p className="text-sm">What is {u.unit.kind === "single" ? "this column" : "this question"}? We picked our best guess.</p>
      <RadioGroup value={answer.role} onValueChange={(v) => setAnswer(unitId, { role: v as VariableRole })} aria-label="What is this?">
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((o) => (
            <RadioCard key={o.value} id={`role-${o.value}`} value={o.value} title={o.title}>
              {o.description}
            </RadioCard>
          ))}
        </div>
      </RadioGroup>
      <WhyItMatters>
        <p>
          Statly uses these answers to pick the right test later. It needs to know which column says who is in which group and which
          column holds the score you want to compare. If a column has the wrong role, Statly might suggest a test that doesn't fit
          your study.
        </p>
      </WhyItMatters>
    </div>
  );
}

// --- level -------------------------------------------------------------------------------

export function StepLevel({ unitId }: { unitId: string }) {
  const u = useUnit(unitId);
  const answer = useInterview((s) => s.draft?.answers[unitId]);
  const setAnswer = useInterview((s) => s.setAnswer);
  if (!u || !answer) return null;
  return (
    <div className="grid gap-4">
      <UnitCard unit={u.unit} vars={u.vars} />
      <p className="text-sm">
        What kind of answers does <strong>{u.unit.title}</strong> hold? ({roleTitle(answer.role)})
      </p>
      <RadioGroup value={answer.level} onValueChange={(v) => setAnswer(unitId, { level: v as MeasurementLevel })} aria-label="Kind of answers">
        {LEVEL_OPTIONS.map((o) => (
          <RadioCard key={o.value} id={`level-${o.value}`} value={o.value} title={o.title}>
            {o.description}
          </RadioCard>
        ))}
      </RadioGroup>
      {answer.role === "likert_item" && answer.level === "ordinal" && (
        <Notice>
          A single agree/disagree question is ordered categories: “Agree” is more than “Neutral”, but the gaps may not be equal.
          Once several questions are combined into a scale score, that score is usually treated as a number.
        </Notice>
      )}
      <WhyItMatters>
        <p>
          The kind of data decides which statistics make sense. You can average test scores, but you can't average group names.
          Ordered categories, like Likert answers, sit in between: the order matters, but the steps between answers may not be
          equal, so for a single question Statly usually recommends tests made for ranked data.
        </p>
      </WhyItMatters>
    </div>
  );
}

// --- value labels ------------------------------------------------------------------------

export function StepLabels({ unitId }: { unitId: string }) {
  const u = useUnit(unitId);
  const answer = useInterview((s) => s.draft?.answers[unitId]);
  const setAnswer = useInterview((s) => s.setAnswer);
  const labelsFor = useInterview((s) => s.labelsFor);
  if (!u || !answer) return null;
  const labels = answer.valueLabels ?? labelsFor(u.unit) ?? [];
  return (
    <div className="grid gap-4">
      <UnitCard unit={u.unit} vars={u.vars} />
      <p className="text-sm">
        Put the answer choices in their natural order (for example, lowest to highest agreement) and give each a clear label. Drag a
        row, or use the arrow buttons.
      </p>
      <SortableLabels labels={labels} onChange={(next) => setAnswer(unitId, { valueLabels: next })} ariaLabel={`Answer choices for ${u.unit.title}`} />
      {u.unit.kind !== "single" && <p className="text-xs text-muted-foreground">These labels apply to all {u.vars.length} parts of the question.</p>}
      <WhyItMatters>
        <p>
          The order of the answer choices is used in tables and charts, and by tests that compare ranks. Putting “Strongly
          disagree” first and “Strongly agree” last makes results easier to read. Changing the order here never changes the stored
          numbers.
        </p>
      </WhyItMatters>
    </div>
  );
}

// --- answer key --------------------------------------------------------------------------

export function StepAnswerKey() {
  const draft = useInterview((s) => s.draft)!;
  const units = useInterview((s) => s.units);
  const stats = useInterview((s) => s.stats);
  const setDraft = useInterview((s) => s.setDraft);
  const byName = useByName();
  const t = testItems(units, draft, byName);
  const [msg, setMsg] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  const load = async () => {
    setMsg(null);
    const path = await pickAnswerKeyFile();
    if (!path) return;
    try {
      const res = await rpc.parseAnswerKey({ path });
      const key = { ...draft.key };
      const known = new Set(t.raw);
      let n = 0;
      for (const e of res.entries) {
        if (known.has(e.item) && e.correct) {
          key[e.item] = e.correct.map(String);
          n++;
        }
      }
      setDraft({ key, keyMode: "key" });
      const skipped = res.entries.length - n;
      setMsg({
        tone: n ? "info" : "error",
        text: `Loaded ${n} answer${n === 1 ? "" : "s"}.${skipped ? ` ${skipped} row${skipped === 1 ? "" : "s"} didn't match a test question here.` : ""} ${res.warnings.map((w) => w.message).join(" ")}`.trim(),
      });
    } catch (e) {
      setMsg({ tone: "error", text: describeEditError(e) });
    }
  };

  return (
    <div className="grid gap-4">
      {t.raw.length > 0 ? (
        <>
          <p className="text-sm">
            {t.raw.length} test question{t.raw.length === 1 ? "" : "s"} hold the answer each student chose. Enter the correct answer for
            each, or load your answer key file, and Statly will mark each answer right or wrong and add up a total.
          </p>
          <RadioGroup value={draft.keyMode} onValueChange={(v) => setDraft({ keyMode: v as "key" | "skip" })} aria-label="Scoring">
            <RadioCard id="key-key" value="key" title="Score with an answer key" />
            <RadioCard id="key-skip" value="skip" title="Skip for now">
              You can score the test later from the Variables screen.
            </RadioCard>
          </RadioGroup>
          {draft.keyMode === "key" && (
            <>
              <div>
                <Button variant="outline" size="sm" onClick={() => void load()}>
                  <FileUp aria-hidden /> Load answer key file…
                </Button>
              </div>
              <div className="max-h-80 overflow-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b text-left">
                      <th className="p-2 font-medium">Question</th>
                      <th className="p-2 font-medium">Correct answer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.raw.map((n) => (
                      <tr key={n} className="border-b last:border-0">
                        <td className="p-2">
                          <span className="font-mono">{n}</span>
                          {byName.get(n)?.question_text && <span className="block text-xs text-muted-foreground">{byName.get(n)!.question_text}</span>}
                        </td>
                        <td className="p-2">
                          <NativeSelect
                            aria-label={`Correct answer for ${n}`}
                            value={draft.key[n]?.[0] ?? ""}
                            onChange={(e) => setDraft({ key: { ...draft.key, [n]: e.target.value ? [e.target.value] : [] } })}
                          >
                            <option value="">Choose…</option>
                            {[...new Set([...(stats[n]?.distinct ?? []).map(String), ...(draft.key[n] ?? [])])].sort().map((x) => (
                              <option key={x} value={x}>
                                {x}
                              </option>
                            ))}
                          </NativeSelect>
                          {(draft.key[n]?.length ?? 0) > 1 && <span className="ml-2 text-xs text-muted-foreground">+ {draft.key[n].slice(1).join(", ")}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {msg && (
            <Notice tone={msg.tone === "error" ? "error" : "info"} role="status">
              {msg.text}
            </Notice>
          )}
        </>
      ) : (
        <>
          <p className="text-sm">
            {t.scored.length} test question{t.scored.length === 1 ? " is" : "s are"} already scored as numbers. Should Statly add them up into a
            total score?
          </p>
          <RadioGroup value={draft.keyMode === "skip" ? "skip" : "scored"} onValueChange={(v) => setDraft({ keyMode: v as "scored" | "skip" })} aria-label="Scoring">
            <RadioCard id="key-scored" value="scored" title="Yes, add them up (1 = correct)" />
            <RadioCard id="key-skip2" value="skip" title="No, leave them as they are" />
          </RadioGroup>
        </>
      )}
      <WhyItMatters>
        <p>
          Statly only knows which choice each student picked. With the answer key it marks each answer right (1) or wrong (0) and adds up
          a total score, which is usually what you compare between groups. A blank answer earns no point; a student who left every
          question blank gets no total.
        </p>
      </WhyItMatters>
    </div>
  );
}

// --- scales ------------------------------------------------------------------------------

function ItemChip({ name, scales, scaleKey, reverse, onMove, onReverse }: {
  name: string;
  scales: DraftScale[];
  scaleKey: string | null;
  reverse: boolean;
  onMove: (target: string | null) => void;
  onReverse: (r: boolean) => void;
}) {
  const byName = useByName();
  const v = byName.get(name);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `item:${name}` });
  return (
    <li
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={"grid gap-1 rounded-md border bg-background p-2 " + (isDragging ? "z-10 shadow-md" : "")}
      data-testid={`scale-item-${name}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Drag ${name} into a scale`}
          className="cursor-grab rounded p-0.5 text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
        <span className="font-mono text-sm font-medium">{name}</span>
        <NativeSelect aria-label={`Scale for ${name}`} value={scaleKey ?? ""} onChange={(e) => onMove(e.target.value || null)} className="ml-auto h-7 text-xs">
          <option value="">Not in a scale</option>
          {scales.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name || "Untitled scale"}
            </option>
          ))}
        </NativeSelect>
      </div>
      {v?.question_text && <p className="text-xs text-muted-foreground">{v.question_text}</p>}
      {scaleKey && (
        <CheckboxField
          label={`Negatively worded (reverse-score ${name})`}
          checked={reverse}
          onChange={(e) => onReverse(e.target.checked)}
        />
      )}
    </li>
  );
}

function ScaleBox({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={(className ?? "") + (isOver ? " ring-2 ring-primary" : "")}>
      {children}
    </div>
  );
}

export function StepScales() {
  const draft = useInterview((s) => s.draft)!;
  const units = useInterview((s) => s.units);
  const setDraft = useInterview((s) => s.setDraft);
  const byName = useByName();
  const likert = likertItems(units, draft, byName);
  const likertSet = new Set(likert);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor));
  const scaleOf = (item: string) => draft.scales.find((s) => s.items.includes(item))?.key ?? null;
  const loose = likert.filter((i) => !scaleOf(i));

  const move = (item: string, target: string | null) => setDraft({ scales: moveItem(draft.scales, item, target) });
  const setReverse = (item: string, r: boolean) => setDraft({ reverse: { ...draft.reverse, [item]: r } });
  const rename = (key: string, name: string) => setDraft({ scales: draft.scales.map((s) => (s.key === key ? { ...s, name } : s)) });
  const remove = (key: string) => setDraft({ scales: draft.scales.filter((s) => s.key !== key) });
  const add = () => {
    const key = `new-${Date.now().toString(36)}-${draft.scales.length}`;
    setDraft({ scales: [...draft.scales, { key, id: null, name: `Scale ${draft.scales.length + 1}`, items: [], method: "mean", minItems: null }] });
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const item = String(e.active.id).replace(/^item:/, "");
    const target = String(e.over.id);
    move(item, target === "pool" ? null : target);
  };
  const chip = (name: string) => (
    <ItemChip
      key={name}
      name={name}
      scales={draft.scales}
      scaleKey={scaleOf(name)}
      reverse={!!draft.reverse[name]}
      onMove={(t) => move(name, t)}
      onReverse={(r) => setReverse(name, r)}
    />
  );

  return (
    <div className="grid gap-4">
      <p className="text-sm">
        Group survey questions that measure the same idea into a scale. Statly suggested groups from your survey's matrix questions.
        Drag questions between boxes, or use each question's “Scale” menu. Tick <strong>Negatively worded</strong> for questions where
        agreeing means <em>less</em> of the idea (for example “I dislike this class” in a scale about enjoying class).
      </p>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="grid gap-3">
          {draft.scales.map((s) => {
            const items = s.items.filter((i) => likertSet.has(i));
            return (
              <ScaleBox key={s.key} id={s.key} className="grid gap-2 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Input aria-label="Scale name" value={s.name} onChange={(e) => rename(s.key, e.target.value)} className="h-8 max-w-xs font-medium" />
                  <Badge>{items.length} item{items.length === 1 ? "" : "s"}</Badge>
                  <Button variant="ghost" size="sm" className="ml-auto" onClick={() => remove(s.key)} aria-label={`Remove scale ${s.name}`}>
                    <Trash2 aria-hidden /> Remove
                  </Button>
                </div>
                {items.length ? (
                  <ul className="grid gap-1.5" aria-label={`Items in ${s.name}`}>
                    {items.map(chip)}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Drag questions here.</p>
                )}
              </ScaleBox>
            );
          })}
          <ScaleBox id="pool" className="grid gap-2 rounded-lg border border-dashed p-3">
            <p className="text-sm font-medium">Not in a scale ({loose.length})</p>
            {loose.length > 0 && <ul className="grid gap-1.5" aria-label="Questions not in a scale">{loose.map(chip)}</ul>}
          </ScaleBox>
        </div>
      </DndContext>
      <div>
        <Button variant="outline" size="sm" onClick={add}>
          <Plus aria-hidden /> Add a scale
        </Button>
      </div>
      <WhyItMatters>
        <p>
          Several questions about the same idea give a steadier measure than one question alone. Negatively worded questions must be
          flipped first so that a high number always means the same thing. Statly flips them with (lowest + highest) − answer, so on a
          1–5 scale a 1 becomes a 5 and a 4 becomes a 2. Your stored answers are not changed; only the scale score uses the flipped
          values.
        </p>
      </WhyItMatters>
    </div>
  );
}

// --- scale scoring -----------------------------------------------------------------------

export function StepScoring() {
  const draft = useInterview((s) => s.draft)!;
  const units = useInterview((s) => s.units);
  const setDraft = useInterview((s) => s.setDraft);
  const byName = useByName();
  const scales = activeScales(draft, units, byName);
  const patch = (key: string, p: Partial<DraftScale>) => setDraft({ scales: draft.scales.map((s) => (s.key === key ? { ...s, ...p } : s)) });
  return (
    <div className="grid gap-4">
      <p className="text-sm">Choose how each scale score is worked out. The defaults suit most surveys.</p>
      {scales.map((s) => {
        const def = defaultMinItems(s.items.length, s.method);
        return (
          <fieldset key={s.key} className="grid gap-3 rounded-lg border p-3">
            <legend className="px-1 font-medium">
              {s.name} <span className="text-sm font-normal text-muted-foreground">({s.items.length} items)</span>
            </legend>
            <RadioGroup value={s.method} onValueChange={(v) => patch(s.key, { method: v as "mean" | "sum", minItems: null })} aria-label={`Score for ${s.name}`}>
              <RadioCard id={`m-${s.key}`} value="mean" title="Average of the answered questions (recommended)">
                Keeps the score on the same scale as the questions (for example 1–5).
              </RadioCard>
              <RadioCard id={`s-${s.key}`} value="sum" title="Sum of the answers">
                Adds the answers up. Best when everyone answered every question.
              </RadioCard>
            </RadioGroup>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Only give a score to people who answered at least</span>
              <span className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={s.items.length}
                  className="h-8 w-20"
                  aria-label={`Minimum answered questions for ${s.name}`}
                  value={s.minItems ?? def}
                  onChange={(e) => patch(s.key, { minItems: e.target.value === "" ? null : Number(e.target.value) })}
                />
                of {s.items.length} questions
              </span>
              <span className="text-xs text-muted-foreground">
                Default: {def} ({s.method === "mean" ? "at least half the questions, rounded up" : "all of them, because a sum with gaps is too low"}).
              </span>
            </label>
          </fieldset>
        );
      })}
      <WhyItMatters>
        <p>
          An average of the answered questions stays on the same scale as the questions and still gives a fair score to someone who
          skipped a question. Requiring at least half of the questions stops a score from resting on just one or two answers. A sum
          is only fair when everyone answered everything, because each skipped question makes the total look lower.
        </p>
      </WhyItMatters>
    </div>
  );
}

// --- summary -----------------------------------------------------------------------------

export function StepSummary() {
  const draft = useInterview((s) => s.draft)!;
  const units = useInterview((s) => s.units);
  const goTo = useInterview((s) => s.goTo);
  const labelsFor = useInterview((s) => s.labelsFor);
  const meta = useDatasetStore((s) => s.meta)!;
  const byName = useByName();
  const plan = buildPlan(meta, units, draft, labelsFor);
  const scales = activeScales(draft, units, byName);
  return (
    <div className="grid gap-4">
      <p className="text-sm">Here is everything you told Statly. Press <strong>Finish</strong> to apply it. You can change any of it later on the Variables screen, and undo each change.</p>
      <section aria-labelledby="sum-roles" className="grid gap-2">
        <h3 id="sum-roles" className="font-semibold">Questions</h3>
        <ul className="grid gap-1 text-sm" data-testid="summary-roles">
          {units.map((u) => {
            const a = draft.answers[u.id];
            return (
              <li key={u.id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{u.title}</span>
                <span className="text-muted-foreground">→</span>
                <span>{roleTitle(a.role)}</span>
                {a.role !== "ignore" && <Badge>{a.level}</Badge>}
                <Button variant="link" size="xs" onClick={() => goTo(`role:${u.id}`)} aria-label={`Change ${u.title}`}>
                  Change
                </Button>
              </li>
            );
          })}
        </ul>
      </section>
      {scales.length > 0 && (
        <section aria-labelledby="sum-scales" className="grid gap-2">
          <h3 id="sum-scales" className="font-semibold">Scales</h3>
          <ul className="grid gap-1 text-sm">
            {scales.map((s) => {
              const rev = s.items.filter((i) => draft.reverse[i]);
              return (
                <li key={s.key}>
                  <strong>{s.name}</strong>: {s.method === "mean" ? "average" : "sum"} of {s.items.join(", ")}
                  {rev.length > 0 && <> (reverse-scored: {rev.join(", ")})</>}; needs {s.minItems ?? defaultMinItems(s.items.length, s.method)} answered.
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {plan.key && (
        <section aria-labelledby="sum-key" className="grid gap-2">
          <h3 id="sum-key" className="font-semibold">Test scoring</h3>
          <p className="text-sm">
            {plan.key.length} question{plan.key.length === 1 ? "" : "s"} will be scored right/wrong and added up into a total.
          </p>
        </section>
      )}
      <p className="text-xs text-muted-foreground" data-testid="summary-changes">
        {plan.updates.length} variable{plan.updates.length === 1 ? "" : "s"} to update · {plan.upsertScales.length} scale score
        {plan.upsertScales.length === 1 ? "" : "s"} to compute{plan.deleteScales.length ? ` · ${plan.deleteScales.length} scale(s) to remove` : ""}
      </p>
    </div>
  );
}
