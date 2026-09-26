import { cn } from "cn";
import { useDatasetStore } from "@/stores/dataset";
import { useNav, type View } from "@/stores/nav";

const TABS: { view: View; title: string; also: View[] }[] = [
  { view: "data", title: "Data", also: [] },
  { view: "variables", title: "Variables", also: ["interview"] },
  { view: "advisor", title: "Analyze", also: ["analysis"] },
  { view: "analyses", title: "Test Log", also: ["results"] },
  { view: "charts", title: "Charts", also: [] },
  { view: "qualitative", title: "Responses", also: [] },
];

/** Header navigation between the dataset screens (shown once a dataset is loaded). */
export function DatasetTabs() {
  const hasData = useDatasetStore((s) => !!s.meta);
  const view = useNav((s) => s.view);
  const go = useNav((s) => s.go);
  if (!hasData || view === "home" || view === "import" || view === "learn") return null;
  return (
    <nav aria-label="Dataset" className="flex items-center gap-1">
      {TABS.map((t) => {
        const active = view === t.view || t.also.includes(view);
        return (
          <button
            key={t.view}
            type="button"
            onClick={() => go(t.view)}
            aria-current={active ? "page" : undefined}
            data-testid={`tab-${t.view}`}
            className={cn(
              "rounded-md px-3 py-1 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              active ? "bg-accent font-semibold" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.title}
          </button>
        );
      })}
    </nav>
  );
}
