import { useEffect } from "react";
import { Notice } from "@/components/ui/form";
import { WhyItMatters } from "@/components/ui/why";
import { buildImportParams, findResponseSets, formatRowFilterGroup, groupRowFilters } from "@/lib/importLogic";
import { useImportFlow } from "@/stores/importFlow";
import { LinkReportView } from "./StepLinking";

export function StepSummary() {
  const preview = useImportFlow((s) => s.preview);
  const d = useImportFlow((s) => s.decisions);
  const result = useImportFlow((s) => s.result);
  const labelsFile = useImportFlow((s) => s.labelsFile);
  const survey = useImportFlow((s) => s.survey);
  const surveyMatch = useImportFlow((s) => s.surveyMatch);
  const checkSurvey = useImportFlow((s) => s.checkSurvey);
  useEffect(() => {
    if (survey && preview && d && !surveyMatch && !result) void checkSurvey();
  }, [survey, preview, d, surveyMatch, result, checkSurvey]);
  if (!preview || !d) return <Notice>Statly is still reading your files…</Notice>;

  const fileName = (fileId: string | null) => preview.files.find((f) => f.file_id === fileId)?.name ?? "file";

  if (result) {
    const log = result.meta.import_log;
    const removedGroups = groupRowFilters(log.row_filters);
    return (
      <div className="grid gap-4" data-testid="import-done">
        <Notice tone="info" role="status">
          Imported {result.meta.n_rows.toLocaleString()} responses and {result.meta.variables.length} variables.
        </Notice>
        {removedGroups.length > 0 && (
          <ul className="grid gap-1 text-sm">
            {removedGroups.map((g) => (
              <li key={`${g.kind}:${g.threshold ?? ""}:${(g.values ?? []).join("|")}`}>
                {formatRowFilterGroup(g, fileName)} <strong>{g.rowsRemoved.toLocaleString()} removed.</strong>
              </li>
            ))}
          </ul>
        )}
        {result.survey && (
          <p className="text-sm" data-testid="survey-filled">
            Question wording and answer choices from your survey file were filled in for{" "}
            {result.survey.columns.length.toLocaleString()} {result.survey.columns.length === 1 ? "column" : "columns"}. The
            Variable Interview marks them so you can check them.
          </p>
        )}
        {result.surveyWarning && <Notice tone="warn">{result.surveyWarning}</Notice>}
        {result.linkReport && <LinkReportView report={result.linkReport} />}
      </div>
    );
  }

  const params = buildImportParams(preview, d);
  const rowsRead = preview.files.reduce((n, f) => n + f.n_rows, 0);
  const cols = new Set(preview.files.flatMap((f) => f.proposed_variables.map((v) => v.name)));
  const multiSplit = Object.entries(d.multiselectSplit).filter(([, v]) => v).map(([k]) => k);
  const items: [string, string][] = [
    ["Files", preview.files.map((f) => f.name).join(", ")],
    ...(labelsFile ? ([["Answer labels", `words from ${labelsFile.name} attached to the numbers`]] as [string, string][]) : []),
    ...(survey
      ? ([
          [
            "Survey file",
            `${survey.survey.name}, ${surveyMatch ? `${surveyMatch.questions} ${surveyMatch.questions === 1 ? "question" : "questions"} matched` : "matching…"}` +
              (surveyMatch?.unmatchedDataset.length
                ? `; ${surveyMatch.unmatchedDataset.length} question ${surveyMatch.unmatchedDataset.length === 1 ? "column isn't" : "columns aren't"} in the survey`
                : ""),
          ],
        ] as [string, string][])
      : []),
    ["Responses read", `${rowsRead.toLocaleString()} rows`],
    ["Columns", `${cols.size - d.dropColumns.length} kept${d.dropColumns.length ? `, ${d.dropColumns.length} removed (${d.dropColumns.join(", ")})` : ""}`],
    [
      "Left out",
      params.row_filters.length
        ? groupRowFilters(params.row_filters)
            .map((g) => formatRowFilterGroup(g, fileName))
            .join("; ")
        : "nothing",
    ],
    ["Survey system columns", d.hideMetadata ? "hidden in the data table" : "shown"],
  ];
  if (findResponseSets(preview.files).length) items.push(["Answer choices", "numbered in the order you confirmed"]);
  if (multiSplit.length) items.push(["Split into yes/no columns", multiSplit.join(", ")]);
  if (params.stack) {
    items.push(["Time points", `${params.stack.levels.map((l) => l.label).join(" → ")} (column "${params.stack.time_variable}")`]);
    items.push(["Linking", d.linkMode === "linked" ? `by ${d.idVariable}` : "not linked (separate groups)"]);
  }

  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground">Here's what Statly will do. Go back to change anything, or import when you're ready.</p>
      <WhyItMatters>
        <p>
          These choices are saved in your project's import log, so you (or your instructor) can see exactly how the
          raw file became your data. That record is part of doing research you can explain and repeat.
        </p>
      </WhyItMatters>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg border p-4 text-sm">
        {items.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
