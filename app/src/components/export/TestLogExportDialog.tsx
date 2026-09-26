/** Export > Test Log… (SPEC §10.3, §9): every logged test, with family/correction/adjusted-p columns, as XLSX/CSV/DOCX. */
import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, Notice } from "@/components/ui/form";
import { pickExportPath } from "@/lib/dialogs";
import { isFileExists } from "@/lib/export/writeRetry";
import { describeRpcError, rpc } from "@/lib/rpc";
import type { TestLogEntry } from "@/contracts";
import { useProjectStore } from "@/stores/project";

// A stable reference: a selector that returns a fresh `[]` on every call breaks
// useSyncExternalStore's snapshot caching and causes an infinite render loop.
const NO_ENTRIES: TestLogEntry[] = [];

export function TestLogExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const entries = useProjectStore((s) => s.project?.test_log ?? NO_ENTRIES);
  const [format, setFormat] = useState<"xlsx" | "csv" | "docx">("xlsx");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [confirmPath, setConfirmPath] = useState<string | null>(null);

  async function save(path: string, overwrite: boolean) {
    setBusy(true);
    setError(null);
    try {
      const out = await rpc.exportTestLog({ entries, format, path, overwrite });
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
    const path = await pickExportPath("Test Log", format);
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
      <DialogContent data-testid="testlog-export-dialog">
        <DialogTitle>Export Test Log…</DialogTitle>
        <DialogDescription>
          {entries.length === 0 ? "No tests logged yet." : `${entries.length} logged test${entries.length === 1 ? "" : "s"}, with family and adjusted-p columns.`}
        </DialogDescription>
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
              <NativeSelect value={format} onChange={(e) => setFormat(e.target.value as "xlsx" | "csv" | "docx")}>
                <option value="xlsx">Excel (.xlsx)</option>
                <option value="csv">CSV</option>
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
              <Button onClick={() => void start()} disabled={busy || entries.length === 0} data-testid="testlog-export-run">
                {busy && <Loader2 aria-hidden className="size-4 animate-spin" />} Export
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
