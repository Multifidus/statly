import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import type { ValueLabel } from "@/contracts";
import { reorder } from "@/lib/interviewLogic";

function Row({
  id,
  index,
  count,
  item,
  onMove,
  onLabel,
}: {
  id: string;
  index: number;
  count: number;
  item: ValueLabel;
  onMove: (from: number, to: number) => void;
  onLabel: (label: string) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={"flex items-center gap-2 rounded-md border bg-background p-1.5 " + (isDragging ? "z-10 shadow-md" : "")}
      data-testid="value-label-row"
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Drag ${item.label} to reorder (space to pick up, arrow keys to move)`}
        className="cursor-grab rounded p-1 text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <span className="w-6 shrink-0 text-right text-xs text-muted-foreground tabular-nums" aria-hidden>
        {index + 1}.
      </span>
      <code className="min-w-10 shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs" title="Stored value">
        {String(item.value)}
      </code>
      <Input
        aria-label={`Label for value ${String(item.value)}`}
        value={item.label}
        onChange={(e) => onLabel(e.target.value)}
        className="h-8"
      />
      <Button variant="ghost" size="icon-xs" aria-label={`Move ${item.label} up`} disabled={index === 0} onClick={() => onMove(index, index - 1)}>
        <ArrowUp aria-hidden />
      </Button>
      <Button variant="ghost" size="icon-xs" aria-label={`Move ${item.label} down`} disabled={index === count - 1} onClick={() => onMove(index, index + 1)}>
        <ArrowDown aria-hidden />
      </Button>
    </li>
  );
}

/**
 * Ordered value labels: drag to reorder (mouse, touch, or keyboard via dnd-kit), plus explicit
 * Move up / Move down buttons as a keyboard alternative. Order = category order.
 */
export function SortableLabels({ labels, onChange, ariaLabel }: { labels: ValueLabel[]; onChange: (next: ValueLabel[]) => void; ariaLabel: string }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = labels.map((l) => `vl-${String(l.value)}`);
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    onChange(reorder(labels, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ol className="grid gap-1.5" aria-label={ariaLabel}>
          {labels.map((l, i) => (
            <Row
              key={ids[i]}
              id={ids[i]}
              index={i}
              count={labels.length}
              item={l}
              onMove={(from, to) => onChange(reorder(labels, from, to))}
              onLabel={(label) => onChange(labels.map((x, k) => (k === i ? { ...x, label } : x)))}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
