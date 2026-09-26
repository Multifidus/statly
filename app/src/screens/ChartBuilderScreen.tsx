import { useEffect, useRef } from "react";
import { ChartBuilder } from "@/components/chartbuilder/ChartBuilder";
import { ChartsList } from "@/components/chartbuilder/ChartsList";
import { useChartBuilder } from "@/stores/chartBuilder";
import { useProjectStore } from "@/stores/project";

/** Charts tab (SPEC §10.2): the project's saved charts, or the builder for one of them. */
export function ChartBuilderScreen() {
  const draft = useChartBuilder((s) => s.draft);
  const projectId = useProjectStore((s) => s.project?.project_id ?? null);
  const seen = useRef(projectId);
  // A different project was opened: drop the draft that belonged to the previous one.
  useEffect(() => {
    if (seen.current !== projectId) useChartBuilder.getState().close();
    seen.current = projectId;
  }, [projectId]);
  return (
    <div data-testid="charts-screen" className="grid w-full">
      {draft ? <ChartBuilder spec={draft} /> : <ChartsList />}
    </div>
  );
}
