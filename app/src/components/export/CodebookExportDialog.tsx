/** Export > Codebook… (SPEC §10.3): variable metadata (labels, roles, missing codes, scales) as XLSX/DOCX. */
import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, Notice } from "@/components/ui/form";
import { pickExportPath } from "@/lib/dialogs";
import { isFileExists } from "@/lib/export/writeRetry";
import { describeRpcError, rpc } from "@/lib/rpc";
import { useDatasetStore } from "@/stores/dataset";

export function CodebookExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const meta = useDatasetStore((s) => s.meta);
  const [format, setFormat] = useState<"xlsx" | "docx">("xlsx");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [confirmPath, setConfirmPath] = useState<string | null>(null);

  async function save(path: string, overwrite: boolean) {
    if (!meta) return;
    setBusy(true);
    setError(null);
    try {
      const out = await rpc.exportCodebook({ dataset_id: meta.dataset_id, format, path, overwrite });
      setSavedPath(out.path);
      setConfirmPath(null);
    } catch (e) {
      if (!overwrite && isFileExists(e)) setConfirmPath(path);
      else setError(describeRpcError(e));
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    const path = await pickExportPath("Codebook", format);
    if (path) await save(path, false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setSavedPath(null);
          setError(null);
          setConfirmPath(null);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent data-testid="codebook-export-dialog">
        <DialogTitle>Export codebook…</DialogTitle>
        <DialogDescription>Every variable's label, role, type, missing codes, and scale membership.</DialogDescription>
        {savedPath ? (
          <div className="grid gap-3">
            <Notice tone="info" className="flex items-center gap-2">
              <CheckCircle2 aria-hidden className="size-4 shrink-0" /> Saved to {savedPath}
            </Notice>
            <div className="flex justify-end">
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            <label className="grid max-w-40 gap-1 text-sm font-medium">
              Format
              <NativeSelect value={format} onChange={(e) => setFormat(e.target.value as "xlsx" | "docx")}>
                <option value="xlsx">Excel (.xlsx)</option>
                <option value="docx">Word (.docx)</option>
              </NativeSelect>
            </label>
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
              <Button onClick={() => void start()} disabled={busy || !meta} data-testid="codebook-export-run">
                {busy && <Loader2 aria-hidden className="size-4 animate-spin" />} Export
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
