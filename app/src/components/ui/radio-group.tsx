import * as React from "react";
import { RadioGroup as RG } from "radix-ui";
import { cn } from "cn";

export function RadioGroup({ className, ...props }: React.ComponentProps<typeof RG.Root>) {
  return <RG.Root className={cn("grid gap-3", className)} {...props} />;
}

/** A radio item with its label and optional description, laid out as one clickable card. */
export function RadioCard({
  value,
  id,
  title,
  children,
}: {
  value: string;
  id: string;
  title: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[button[data-state=checked]]:border-primary has-[button[data-state=checked]]:bg-accent/60"
    >
      <RG.Item
        id={id}
        value={value}
        className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-foreground/60 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <RG.Indicator className="size-2 rounded-full bg-primary" />
      </RG.Item>
      <span className="grid gap-1">
        <span className="text-sm font-medium">{title}</span>
        {children && <span className="text-sm text-muted-foreground">{children}</span>}
      </span>
    </label>
  );
}
