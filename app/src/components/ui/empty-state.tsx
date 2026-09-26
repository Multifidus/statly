import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";

interface EmptyStateAction {
  label: ReactNode;
  onClick: () => void;
  icon?: LucideIcon;
}

interface EmptyStateProps extends Omit<ComponentProps<"div">, "title"> {
  icon: LucideIcon;
  title: ReactNode;
  /** One short sentence explaining what's missing and what to do about it. */
  body: ReactNode;
  action?: EmptyStateAction;
}

/** A friendly placeholder for a screen or panel with nothing to show yet: an icon, a plain-language
 * explanation, and (usually) a button that leads to the next action. */
export function EmptyState({ icon: Icon, title, body, action, className, ...props }: EmptyStateProps) {
  return (
    <div className={cn("grid justify-items-center gap-2 rounded-lg border border-dashed p-8 text-center", className)} {...props}>
      <Icon aria-hidden className="size-8 text-muted-foreground" />
      <p className="font-medium">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
      {action && (
        <Button className="mt-2" onClick={action.onClick}>
          {action.icon && <action.icon aria-hidden />} {action.label}
        </Button>
      )}
    </div>
  );
}
