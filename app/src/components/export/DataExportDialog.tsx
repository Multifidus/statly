/**
 * Export > Data… (SPEC §10.3): dataset as XLSX/CSV, with metadata columns and a label row optional,
 * and a plain-language warning about PII columns the export would include (`pii_columns`, returned
 * by `export.data` after the write, since PII detection lives entirely on the engine side).
 */
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CheckboxField, NativeSelect, Notice } from "@/components/ui/form";
import { pickExportPath } from "@/lib/dialogs";
import { isFileExists } from "@/lib/export/writeRetry";
import { describeRpcError, rpc } from "@/lib/rpc";
import { useDatasetStore } from "@/stores/dataset";

export function DataExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const meta = useDatasetStore((s) => s.meta);
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [includeMetadata, setIncludeMetadata] = useState(false);
  const [labelRow, setLabelRow] = useState(true);
  const [excludePii, setExcludePii] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ path: string; pii: string[] } | null>(null);
  const [confirmPath, setConfirmPath] = useState<string | null>(null);

  async function save(path: string, overwrite: boolean) {
    if (!meta) return;
    setBusy(true);
    setError(null);
    try {
      const out = await rpc.exportData({
        dataset_id: meta.dataset_id, format, path,
        include_metadata_columns: includeMetadata,
        options: { label_row: labelRow, exclude_pii: excludePii },
        overwrite,
      });
      setResult({ path: out.path, pii: out.pii_columns });
      setConfirmPath(null);
    } catch (e) {
      if (!overwrite && isFileExists(e)) setConfirmPath(path);
      else setError(describeRpcError(e));
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    const path = await pickExportPath(meta?.dataset_id ? "Data" : "Data", format);
    if (path) await save(path, false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setResult(null);
          setError(null);
          setConfirmPath(null);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent data-testid="data-export-dialog">
        <DialogTitle>Export data…</DialogTitle>
        <DialogDescription>The current dataset, in Variables-screen column order.</DialogDescription>
        {result ? (
          <div className="grid gap-3">
            <Notice tone="info" className="flex items-center gap-2">
              <CheckCircle2 aria-hidden className="size-4 shrink-0" /> Saved to {result.path}
            </Notice>
            {result.pii.length > 0 && (
              <Notice tone="warn" className="flex items-start gap-2">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>
                  This file includes columns Statly flagged as possibly identifying: {result.pii.join(", ")}. Be careful about where you
                  share it.
                </span>
              </Notice>
            )}
            <div className="flex justify-end">
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            <label className="grid max-w-40 gap-1 text-sm font-medium">
              Format
              <NativeSelect value={format} onChange={(e) => setFormat(e.target.value as "xlsx" | "csv")}>
                <option value="xlsx">Excel (.xlsx)</option>
                <option value="csv">CSV</option>
              </NativeSelect>
            </label>
            <CheckboxField label="Include metadata columns" checked={includeMetadata} onChange={(e) => setIncludeMetadata(e.target.checked)} />
            <CheckboxField label="Add a variable-label row" checked={labelRow} onChange={(e) => setLabelRow(e.target.checked)} />
            <CheckboxField
              label="Exclude columns flagged as PII"
              description="Removes columns Statly thinks might identify a person (e.g. email, name)."
              checked={excludePii}
              onChange={(e) => setExcludePii(e.target.checked)}
            />
            {confirmPath && (
              <Notice tone="warn" className="flex items-center justify-between gap-2">
                <span>A file already exists at that location. Replace it?</span>
                <Button size="sm" variant="destructive" onClick={() => void save(confirmPath, true)}>
                  Replace
                </Button>
              </Notice>
            )}
            {error && !confirmPath && <Notice tone="error">{error}</Notice>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={() => void start()} disabled={busy || !meta} data-testid="data-export-run">
                {busy && <Loader2 aria-hidden className="size-4 animate-spin" />} Export
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
