import * as React from "react";
import { Popover } from "radix-ui";
import { getTerm, learnPageFor } from "@/lib/content/learn";

/**
 * Hover glossary (SPEC §11.3): a technical term with a dotted underline that explains itself on
 * hover, keyboard focus, or click. Focus stays on the term (Esc closes), so reading order is kept.
 */
export function Term({ k, children }: { k: string; children?: React.ReactNode }) {
  const entry = getTerm(k);
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef<number | null>(null);
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  React.useEffect(() => clear, []);
  if (!entry) return <>{children ?? k.replace(/_/g, " ")}</>;
  const later = (value: boolean, ms: number) => {
    clear();
    timer.current = window.setTimeout(() => setOpen(value), ms);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-glossary={k}
          aria-label={`${typeof children === "string" ? children : entry.term}: what does this mean?`}
          className="cursor-help rounded-sm underline decoration-dotted decoration-from-font underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onPointerEnter={(e) => e.pointerType === "mouse" && later(true, 250)}
          onPointerLeave={(e) => e.pointerType === "mouse" && later(false, 200)}
          onFocus={() => later(true, 0)}
          onBlur={() => later(false, 0)}
        >
          {children ?? entry.term}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onPointerEnter={clear}
          onPointerLeave={() => later(false, 200)}
          role="tooltip"
          data-testid={`glossary-${k}`}
          className="z-50 max-w-xs rounded-md border bg-popover p-3 text-sm text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none"
        >
          <p className="font-semibold">{entry.term}</p>
          <p className="mt-1">{entry.short}</p>
          {entry.long && <p className="mt-2 text-muted-foreground">{entry.long}</p>}
          {entry.seeAlso.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              See also: {entry.seeAlso.map((s) => getTerm(s)?.term ?? learnPageFor(s)?.title ?? s.replace(/_/g, " ")).join(", ")}
            </p>
          )}
          <Popover.Arrow className="fill-popover" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
