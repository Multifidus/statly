import * as React from "react";
import { cn } from "cn";

const focus = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn("h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm shadow-xs disabled:opacity-50", focus, className)}
      {...props}
    />
  );
}

export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn("h-9 rounded-md border border-input bg-background px-2 text-sm shadow-xs", focus, className)}
      {...props}
    />
  );
}

/** Native checkbox + label: fully keyboard/screen-reader accessible with no extra ARIA. */
export function CheckboxField({
  label,
  description,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & { label: React.ReactNode; description?: React.ReactNode }) {
  const autoId = React.useId();
  const id = props.id ?? autoId;
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <input
        type="checkbox"
        id={id}
        className="mt-0.5 size-4 shrink-0 accent-primary rounded outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-describedby={description ? `${id}-desc` : undefined}
        {...props}
      />
      <div className="grid gap-0.5">
        <label htmlFor={id} className="text-sm leading-snug font-medium">
          {label}
        </label>
        {description && (
          <p id={`${id}-desc`} className="text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

export function Badge({ className, tone = "neutral", ...props }: React.ComponentProps<"span"> & { tone?: "neutral" | "warn" | "info" | "ok" }) {
  const tones = {
    neutral: "bg-secondary text-secondary-foreground",
    warn: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    info: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
    ok: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  };
  return <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium", tones[tone], className)} {...props} />;
}

export function Notice({
  tone = "info",
  className,
  ...props
}: React.ComponentProps<"div"> & { tone?: "info" | "warn" | "error" }) {
  const tones = {
    info: "border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-100",
    warn: "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100",
    error: "border-red-300 bg-red-50 text-red-950 dark:border-red-800 dark:bg-red-950/50 dark:text-red-100",
  };
  return <div className={cn("rounded-md border p-3 text-sm", tones[tone], className)} {...props} />;
}
