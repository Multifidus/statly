import * as React from "react";
import { Collapsible } from "radix-ui";
import { ChevronRight, HelpCircle } from "lucide-react";

/** "Why does this matter?" expander used on every wizard step. */
export function WhyItMatters({ children, title = "Why does this matter?" }: { children: React.ReactNode; title?: string }) {
  return (
    <Collapsible.Root className="rounded-md border bg-muted/40">
      <Collapsible.Trigger className="group flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <HelpCircle className="size-4 text-muted-foreground" aria-hidden />
        {title}
        <ChevronRight className="ml-auto size-4 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none" aria-hidden />
      </Collapsible.Trigger>
      <Collapsible.Content className="grid gap-2 px-3 pb-3 text-sm leading-relaxed">{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}
