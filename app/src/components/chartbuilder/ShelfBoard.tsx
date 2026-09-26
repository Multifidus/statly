import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { cn } from "cn";
import { Hash, Plus, Type, X } from "lucide-react";
import type { ChartSpec, ShelfAggregate, VariableSchema } from "@/contracts";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input, NativeSelect } from "@/components/ui/form";
import { accepts, CHART_INFO, varKind } from "@/lib/chartbuilder/catalog";
import type { ShelfName } from "@/lib/chartbuilder/types";
import { useChartBuilder } from "@/stores/chartBuilder";

export const SHELF_LABELS: Record<ShelfName, string> = { x: "X", y: "Y", color: "Color / Group", facet: "Facet" };
const SHELVES: ShelfName[] = ["x", "y", "color", "facet"];
const AGGREGATES: { value: ShelfAggregate; label: string }[] = [
  { value: "mean", label: "Mean" },
  { value: "median", label: "Median" },
  { value: "sum", label: "Sum" },
  { value: "count", label: "Count" },
];

const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

const label = (v: VariableSchema | undefined, name: string) => v?.label || name;

function KindIcon({ v }: { v: VariableSchema }) {
  return varKind(v) === "number" ? <Hash aria-hidden className="size-3.5 shrink-0 text-muted-foreground" /> : <Type aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />;
}

/** Menu of shelves: the keyboard (and click) alternative to dragging. */
function AddToMenu({ spec, v, from }: { spec: ChartSpec; v: VariableSchema; from?: ShelfName }) {
  const add = useChartBuilder((s) => s.addField);
  const rules = CHART_INFO[spec.chart_type].shelves;
  const targets = SHELVES.filter((s) => rules[s] && s !== from);
  if (!targets.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-label={from ? `Move ${label(v, v.name)} to another shelf` : `Add ${label(v, v.name)} to a shelf`}
        data-testid={from ? `move-${from}-${v.name}` : `add-${v.name}`}
      >
        <Plus aria-hidden className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {targets.map((s) => (
          <DropdownMenuItem key={s} onSelect={() => add(s, v.name)} data-testid={`add-to-${s}`}>
            {from ? "Move to" : "Add to"} {SHELF_LABELS[s]}
            {!accepts(rules[s], v) && <span className="ml-auto text-xs text-muted-foreground">(not ideal)</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function VariableChip({ spec, v }: { spec: ChartSpec; v: VariableSchema }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `var::${v.name}`, data: { variable: v.name } });
  return (
    <li className={cn("flex items-center gap-1 rounded-md border bg-background pr-1 text-sm", isDragging && "opacity-40")}>
      <span
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        aria-roledescription="draggable variable"
        aria-label={`${label(v, v.name)}. Drag onto a shelf, or use the plus button.`}
        className="flex min-w-0 flex-1 cursor-grab items-center gap-1.5 rounded-md px-2 py-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        data-testid={`var-chip-${v.name}`}
        title={v.question_text ?? v.label ?? v.name}
      >
        <KindIcon v={v} />
        <span className="truncate">{label(v, v.name)}</span>
      </span>
      <AddToMenu spec={spec} v={v} />
    </li>
  );
}

function ShelfPill({ spec, shelf, variable, aggregate, v }: { spec: ChartSpec; shelf: ShelfName; variable: string; aggregate: ShelfAggregate; v: VariableSchema | undefined }) {
  const remove = useChartBuilder((s) => s.removeField);
  const setAgg = useChartBuilder((s) => s.setFieldAggregate);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `pill::${shelf}::${variable}`, data: { variable, from: shelf } });
  const rule = CHART_INFO[spec.chart_type].shelves[shelf];
  const wrongKind = v && rule && !accepts(rule, v);
  const showAgg = shelf === "y" && ["bar", "grouped_bar", "line", "interaction"].includes(spec.chart_type);
  const name = label(v, variable);
  return (
    <li className={cn("flex items-center gap-1 rounded-md border bg-accent/60 py-0.5 pr-0.5 pl-2 text-sm", isDragging && "opacity-40", wrongKind && "border-amber-500")} data-testid={`pill-${shelf}-${variable}`}>
      <span ref={setNodeRef} {...listeners} {...attributes} aria-roledescription="draggable variable" aria-label={`${name} on ${SHELF_LABELS[shelf]}`} className="max-w-40 cursor-grab truncate rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        {name}
      </span>
      {showAgg && (
        <NativeSelect value={aggregate === "none" ? "mean" : aggregate} onChange={(e) => setAgg(shelf, variable, e.target.value as ShelfAggregate)} aria-label={`Summary of ${name}`} className="h-6 px-1 text-xs" data-testid={`agg-${variable}`}>
          {AGGREGATES.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </NativeSelect>
      )}
      {wrongKind && <span className="sr-only">This shelf expects {rule.accepts === "number" ? "numbers" : "groups"}.</span>}
      {v && <AddToMenu spec={spec} v={v} from={shelf} />}
      <button type="button" onClick={() => remove(shelf, variable)} aria-label={`Remove ${name} from ${SHELF_LABELS[shelf]}`} className="grid size-6 place-items-center rounded-sm text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50" data-testid={`remove-${shelf}-${variable}`}>
        <X aria-hidden className="size-3.5" />
      </button>
    </li>
  );
}

function Shelf({ spec, shelf, byName }: { spec: ChartSpec; shelf: ShelfName; byName: Map<string, VariableSchema> }) {
  const rule = CHART_INFO[spec.chart_type].shelves[shelf];
  const { setNodeRef, isOver } = useDroppable({ id: `shelf::${shelf}`, disabled: !rule, data: { shelf } });
  const fields = spec.shelves[shelf];
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-start gap-2">
      <span className={cn("pt-1.5 text-sm font-medium", !rule && "text-muted-foreground/60")} id={`shelf-label-${shelf}`}>
        {SHELF_LABELS[shelf]}
      </span>
      <ul
        ref={setNodeRef}
        aria-labelledby={`shelf-label-${shelf}`}
        data-testid={`shelf-${shelf}`}
        className={cn(
          "flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-dashed p-1 transition-colors motion-reduce:transition-none",
          isOver && "border-primary bg-primary/5",
          !rule && "bg-muted/40",
        )}
      >
        {fields.map((f) => (
          <ShelfPill key={f.variable} spec={spec} shelf={shelf} variable={f.variable} aggregate={f.aggregate} v={byName.get(f.variable)} />
        ))}
        {!fields.length && <li className="px-1 text-xs text-muted-foreground">{rule ? rule.hint : "Not used by this chart"}</li>}
      </ul>
    </div>
  );
}

function VariableList({ spec, vars }: { spec: ChartSpec; vars: VariableSchema[] }) {
  const [q, setQ] = useState("");
  const { setNodeRef, isOver } = useDroppable({ id: "variables" });
  const used = new Set([...spec.shelves.x, ...spec.shelves.y, ...spec.shelves.color, ...spec.shelves.facet].map((f) => f.variable));
  const shown = vars.filter((v) => !q || `${v.name} ${v.label ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <section aria-label="Variables" className="grid min-h-0 content-start gap-2">
      <h3 className="text-sm font-semibold">Variables</h3>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search variables" aria-label="Search variables" className="h-8" />
      <ul ref={setNodeRef} className={cn("grid max-h-[60vh] grid-cols-[minmax(0,1fr)] gap-1 overflow-auto rounded-md p-0.5", isOver && "bg-accent/40")} data-testid="chart-variables">
        {shown.map((v) => (used.has(v.name) ? null : <VariableChip key={v.name} spec={spec} v={v} />))}
      </ul>
      <p className="text-xs text-muted-foreground">Drag a variable onto a shelf, or press its + button to choose a shelf. Drag it back here to remove it.</p>
    </section>
  );
}

/** Variables list + X / Y / Color / Facet shelves, with dnd-kit drag and drop and menu alternatives. */
export function ShelfBoard({ spec, vars, children }: { spec: ChartSpec; vars: VariableSchema[]; children?: React.ReactNode }) {
  const add = useChartBuilder((s) => s.addField);
  const remove = useChartBuilder((s) => s.removeField);
  const [dragging, setDragging] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor));
  const byName = useMemo(() => new Map(vars.map((v) => [v.name, v])), [vars]);
  const onStart = (e: DragStartEvent) => setDragging(String(e.active.data.current?.variable ?? ""));
  const onEnd = (e: DragEndEvent) => {
    setDragging(null);
    const variable = e.active.data.current?.variable as string | undefined;
    const from = e.active.data.current?.from as ShelfName | undefined;
    const over = e.over?.id ? String(e.over.id) : null;
    if (!variable || !over) return;
    if (over === "variables") {
      if (from) remove(from, variable);
      return;
    }
    const shelf = over.replace("shelf::", "") as ShelfName;
    if (shelf !== from) add(shelf, variable);
  };
  const announcements = {
    onDragStart: ({ active }: { active: { data: { current?: Record<string, unknown> } } }) => `Picked up ${label(byName.get(String(active.data.current?.variable)), String(active.data.current?.variable))}.`,
    onDragOver: ({ over }: { over: { id: string | number } | null }) => (over ? `Over ${String(over.id).startsWith("shelf::") ? SHELF_LABELS[String(over.id).slice(7) as ShelfName] + " shelf" : "the variable list"}.` : "Not over a shelf."),
    onDragEnd: ({ over }: { over: { id: string | number } | null }) => (over ? `Dropped on ${String(over.id).startsWith("shelf::") ? SHELF_LABELS[String(over.id).slice(7) as ShelfName] : "the variable list"}.` : "Drag cancelled."),
    onDragCancel: () => "Drag cancelled.",
  };
  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setDragging(null)} accessibility={{ announcements: announcements as never }}>
      <div className="grid min-h-0 gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <VariableList spec={spec} vars={vars} />
        <div className="grid min-w-0 content-start gap-4">
          <section aria-label="Shelves" className="grid gap-2 rounded-lg border p-3">
            {SHELVES.map((s) => (
              <Shelf key={s} spec={spec} shelf={s} byName={byName} />
            ))}
          </section>
          {children}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging ? <div className="rounded-md border bg-background px-2 py-1 text-sm shadow-md">{label(byName.get(dragging), dragging)}</div> : null}
      </DragOverlay>
    </DndContext>
  );
}
