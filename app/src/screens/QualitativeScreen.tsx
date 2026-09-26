import { useEffect, useState } from "react";
import { cn } from "cn";
import { Notice } from "@/components/ui/form";
import { CodebookPanel } from "@/components/qualitative/CodebookPanel";
import { ExportMenu } from "@/components/qualitative/ExportMenu";
import { FilterBar } from "@/components/qualitative/FilterBar";
import { ResponseList } from "@/components/qualitative/ResponseList";
import { SummaryPanel } from "@/components/qualitative/SummaryPanel";
import { useDatasetStore } from "@/stores/dataset";
import { textVariables, useQualitative } from "@/stores/qualitative";

type Tab = "read" | "summary";

/** Qualitative module (SPEC §11.1): read, search, filter, and tag open-ended responses; summarize tags. */
export function QualitativeScreen() {
  const meta = useDatasetStore((s) => s.meta);
  const init = useQualitative((s) => s.init);
  const total = useQualitative((s) => s.total);
  const totalResponses = useQualitative((s) => s.totalResponses);
  const loaded = useQualitative((s) => s.loaded);
  const error = useQualitative((s) => s.error);
  const variable = useQualitative((s) => s.variable);
  const [tab, setTab] = useState<Tab>("read");

  const datasetId = meta?.dataset_id;
  const snapshotId = meta?.snapshot_id;
  useEffect(() => {
    if (meta) void init(meta);
  }, [datasetId, snapshotId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!meta) return <p className="text-sm text-muted-foreground">Import data first.</p>;
  const hasText = textVariables(meta).length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold" data-testid="qual-title">
            Written responses
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Read what people wrote, tag each answer with the ideas it mentions, and count how often each idea comes up. Your tags are saved
            with the project.
          </p>
        </div>
        {hasText && (
          <div className="ml-auto">
            <ExportMenu datasetId={meta.dataset_id} />
          </div>
        )}
      </div>
      {!hasText ? (
        <Notice>This dataset has no written-answer (text) questions to read.</Notice>
      ) : (
        <>
          <div role="tablist" aria-label="Responses view" className="flex gap-1 border-b">
            {(
              [
                ["read", "Read and tag"],
                ["summary", "Summary"],
              ] as const
            ).map(([id, title]) => (
              <button
                key={id}
                role="tab"
                id={`qual-tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`qual-panel-${id}`}
                onClick={() => setTab(id)}
                data-testid={`qual-tab-${id}`}
                className={cn(
                  "-mb-px border-b-2 px-3 py-1.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  tab === id ? "border-primary font-semibold" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {title}
              </button>
            ))}
          </div>
          {error && (
            <Notice tone="error" role="alert">
              {error}
            </Notice>
          )}
          {tab === "read" ? (
            <div id="qual-panel-read" role="tabpanel" aria-labelledby="qual-tab-read" className="flex min-h-0 flex-1 gap-4">
              <div className="flex min-h-[420px] min-w-0 flex-1 flex-col gap-3">
                <FilterBar meta={meta} />
                <p className="text-xs text-muted-foreground" aria-live="polite" data-testid="qual-count">
                  {loaded ? `Showing ${total} of ${totalResponses} written answers to ${variable}.` : "Loading answers…"}
                </p>
                {loaded && total === 0 ? (
                  <Notice>No answers match. Try other words or clear the filters.</Notice>
                ) : (
                  <ResponseList meta={meta} />
                )}
              </div>
              <aside className="w-72 shrink-0 overflow-auto">
                <CodebookPanel />
              </aside>
            </div>
          ) : (
            <div id="qual-panel-summary" role="tabpanel" aria-labelledby="qual-tab-summary" className="grid gap-4">
              <SummaryPanel meta={meta} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
