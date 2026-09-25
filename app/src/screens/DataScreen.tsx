import { useState } from "react";
import { Link2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CheckboxField, NativeSelect, Notice } from "@/components/ui/form";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";
import { DataGrid } from "@/components/data/DataGrid";
import { MissingSummary } from "@/components/data/MissingSummary";
import { AggregateTeachingNote, LinkReportView } from "@/components/import/StepLinking";
import type { LinkMode, LinkReport } from "@/contracts";
import { describeRpcError, rpc } from "@/lib/rpc";
import { useDatasetStore, visibleVariables } from "@/stores/dataset";
import { useImportFlow } from "@/stores/importFlow";
import { useNav } from "@/stores/nav";
import { useProjectStore } from "@/stores/project";

function LinkSettings() {
  const meta = useDatasetStore((s) => s.meta)!;
  const setMeta = useDatasetStore((s) => s.setMeta);
  const markDirty = useProjectStore((s) => s.markDirty);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<LinkMode>(meta.link.mode);
  const [idVar, setIdVar] = useState<string | null>(meta.link.id_variable);
  const [trim, setTrim] = useState(meta.link.normalization?.trim_whitespace ?? true);
  const [caseless, setCaseless] = useState(meta.link.normalization?.case_insensitive ?? true);
  const [report, setReport] = useState<LinkReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await rpc.link({
        dataset_id: meta.dataset_id,
        mode,
        id_variable: mode === "linked" ? idVar : null,
        normalization: mode === "linked" ? { trim_whitespace: trim, case_insensitive: caseless } : null,
      });
      setMeta(res.dataset_meta);
      setReport(res.report);
      markDirty();
    } catch (e) {
      setError(describeRpcError(e));
    } finally {
      setBusy(false);
    }
  };

  const summary = meta.link.mode === "linked" ? `Linked by ${meta.link.id_variable}` : "Not linked";
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setReport(null); }}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Link2 aria-hidden /> {summary}
      </Button>
      <DialogContent aria-describedby="link-desc" className="max-w-xl">
        <DialogTitle>Link people across time</DialogTitle>
        <DialogDescription id="link-desc">Choose whether Statly should match each person's answers across time points.</DialogDescription>
        <RadioGroup value={mode} onValueChange={(v) => setMode(v as LinkMode)} aria-label="Linking mode">
          <RadioCard id="dl-agg" value="aggregate" title="Don't link">Treat each time point as a separate group.</RadioCard>
          <RadioCard id="dl-link" value="linked" title="Link people by an ID">Match people using an ID column.</RadioCard>
        </RadioGroup>
        {mode === "aggregate" ? (
          <AggregateTeachingNote />
        ) : (
          <div className="grid gap-2">
            <label htmlFor="dl-id" className="text-sm font-medium">ID column</label>
            <NativeSelect id="dl-id" value={idVar ?? ""} onChange={(e) => setIdVar(e.target.value || null)}>
              <option value="">Choose a column…</option>
              {meta.variables.filter((v) => v.role !== "time").map((v) => (
                <option key={v.name} value={v.name}>{v.name}</option>
              ))}
            </NativeSelect>
            <CheckboxField label="Ignore extra spaces" checked={trim} onChange={(e) => setTrim(e.target.checked)} />
            <CheckboxField label="Ignore capital letters" checked={caseless} onChange={(e) => setCaseless(e.target.checked)} />
          </div>
        )}
        {report && <LinkReportView report={report} />}
        {error && <Notice tone="error" role="alert">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
          <Button onClick={() => void apply()} disabled={busy || (mode === "linked" && !idVar)}>Apply</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DataScreen() {
  const meta = useDatasetStore((s) => s.meta);
  const showMetadata = useDatasetStore((s) => s.showMetadata);
  const setShowMetadata = useDatasetStore((s) => s.setShowMetadata);
  const go = useNav((s) => s.go);
  const resetFlow = useImportFlow((s) => s.reset);

  if (!meta) {
    return (
      <div className="mx-auto grid max-w-md gap-4 text-center">
        <h1 className="text-xl font-semibold">No data yet</h1>
        <p className="text-muted-foreground">This project doesn't have any data. Import a file to get started.</p>
        <Button className="justify-self-center" onClick={() => { resetFlow(); go("import"); }}>
          <Upload aria-hidden /> Import data
        </Button>
      </div>
    );
  }

  const vars = visibleVariables(meta, showMetadata);
  const metaCount = meta.variables.filter((v) => v.is_metadata).length;
  const piiCount = meta.variables.filter((v) => v.is_pii).length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <h1 className="text-lg font-semibold" data-testid="data-title">Your data</h1>
        <p className="text-sm text-muted-foreground" data-testid="data-counts">
          {meta.n_rows.toLocaleString()} rows · {meta.variables.length} variables
          {meta.stacking && ` · ${meta.stacking.levels.map((l) => l.label).join(", ")}`}
        </p>
        {piiCount > 0 && <p className="text-sm text-amber-800 dark:text-amber-300">{piiCount} column{piiCount > 1 ? "s" : ""} marked PII</p>}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {metaCount > 0 && (
            <CheckboxField
              label={`Show survey system columns (${metaCount})`}
              checked={showMetadata}
              onChange={(e) => setShowMetadata(e.target.checked)}
            />
          )}
          {meta.stacking && <LinkSettings />}
        </div>
      </div>
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-h-[20rem] min-w-0">
          <DataGrid meta={meta} variables={vars} />
        </div>
        <aside className="min-h-0 overflow-hidden rounded-md border p-4">
          <MissingSummary meta={meta} />
        </aside>
      </div>
    </div>
  );
}
