/**
 * Export > Report… (SPEC §10.3): choose logged tests, toggle what's included, title/author, format,
 * save, progress, then a success panel. The multiple-comparison choice a user already made in the
 * Test Log (family + correction method) rides along automatically (useExportFlow.run -> test_log).
 */
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CheckboxField, Input, NativeSelect, Notice } from "@/components/ui/form";
import { copyRich } from "@/lib/clipboard";
import { useExportFlow } from "@/stores/exportFlow";
import { useProjectStore } from "@/stores/project";

function familyLabel(familyId: string | null, method: string, families: { id: string; name: string }[]): string | null {
  if (!familyId || method === "none") return null;
  const name = families.find((f) => f.id === familyId)?.name ?? "family";
  const label = { holm: "Holm", bonferroni: "Bonferroni", fdr_bh: "Benjamini-Hochberg" }[method] ?? method;
  return `${label}-adjusted · ${name}`;
}

export function ReportExportDialog() {
  const open = useExportFlow((s) => s.open);
  const hide = useExportFlow((s) => s.hide);
  const selectedIds = useExportFlow((s) => s.selectedIds);
  const toggleSelected = useExportFlow((s) => s.toggleSelected);
  const selectAll = useExportFlow((s) => s.selectAll);
  const clearSelection = useExportFlow((s) => s.clearSelection);
  const include = useExportFlow((s) => s.include);
  const setInclude = useExportFlow((s) => s.setInclude);
  const title = useExportFlow((s) => s.title);
  const setTitle = useExportFlow((s) => s.setTitle);
  const author = useExportFlow((s) => s.author);
  const setAuthor = useExportFlow((s) => s.setAuthor);
  const format = useExportFlow((s) => s.format);
  const setFormat = useExportFlow((s) => s.setFormat);
  const status = useExportFlow((s) => s.status);
  const error = useExportFlow((s) => s.error);
  const savedPath = useExportFlow((s) => s.savedPath);
  const confirmOverwritePath = useExportFlow((s) => s.confirmOverwritePath);
  const run = useExportFlow((s) => s.run);
  const confirmReplace = useExportFlow((s) => s.confirmReplace);

  const project = useProjectStore((s) => s.project);
  const entries = project?.test_log ?? [];
  const families = project?.test_families ?? [];
  const busy = status === "rendering" || status === "saving";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && hide()}>
      <DialogContent className="max-w-2xl" data-testid="report-export-dialog">
        <DialogTitle>Export report…</DialogTitle>
        <DialogDescription>Choose the logged tests to include. Statly renders offline; nothing leaves this computer.</DialogDescription>

        {status === "done" && savedPath ? (
          <div className="grid gap-3">
            <Notice tone="info" className="flex items-center gap-2">
              <CheckCircle2 aria-hidden className="size-4 shrink-0" /> Saved to {savedPath}
            </Notice>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => void copyRich({ html: savedPath, text: savedPath })} data-testid="export-copy-path">
                Copy path
              </Button>
              <Button onClick={hide}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium">
                Title
                <Input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="report-title" />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Author (optional)
                <Input value={author} onChange={(e) => setAuthor(e.target.value)} data-testid="report-author" />
              </label>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-medium">Tests to include</span>
                <div className="flex gap-2 text-xs">
                  <button type="button" className="underline" onClick={() => selectAll(entries.map((e) => e.id))} data-testid="report-select-all">
                    Select all
                  </button>
                  <button type="button" className="underline" onClick={clearSelection}>
                    Clear
                  </button>
                </div>
              </div>
              {entries.length === 0 ? (
                <Notice tone="info">Log a test first (Advisor or Results screen) to include it in a report.</Notice>
              ) : (
                <ul className="grid max-h-56 gap-1 overflow-auto rounded-md border p-2">
                  {entries.map((e) => {
                    const fam = familyLabel(e.family_id, e.correction_method, families);
                    return (
                      <li key={e.id}>
                        <CheckboxField
                          label={e.result_summary.analysis_label}
                          description={fam ?? undefined}
                          checked={selectedIds.includes(e.id)}
                          onChange={() => toggleSelected(e.id)}
                          data-testid={`report-entry-${e.id}`}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="grid gap-1.5 sm:grid-cols-2">
              <CheckboxField label="Tables" checked={include.tables} onChange={(e) => setInclude("tables", e.target.checked)} />
              <CheckboxField label="APA sentences" checked={include.sentences} onChange={(e) => setInclude("sentences", e.target.checked)} />
              <CheckboxField label="Assumption checks" checked={include.assumptions} onChange={(e) => setInclude("assumptions", e.target.checked)} />
              <CheckboxField label="Charts" checked={include.charts} onChange={(e) => setInclude("charts", e.target.checked)} />
            </div>

            <label className="grid max-w-40 gap-1 text-sm font-medium">
              Format
              <NativeSelect value={format} onChange={(e) => setFormat(e.target.value as "docx" | "pdf")} data-testid="report-format">
                <option value="docx">Word (.docx)</option>
                <option value="pdf">PDF</option>
              </NativeSelect>
            </label>

            {confirmOverwritePath && (
              <Notice tone="warn" className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <AlertTriangle aria-hidden className="size-4 shrink-0" /> A file already exists at that location. Replace it?
                </span>
                <Button size="sm" variant="destructive" onClick={() => void confirmReplace()} data-testid="report-confirm-replace">
                  Replace
                </Button>
              </Notice>
            )}
            {error && !confirmOverwritePath && <Notice tone="error">{error}</Notice>}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={hide} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={() => void run()} disabled={busy || entries.length === 0} data-testid="report-export-run">
                {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
                {status === "rendering" ? "Rendering charts…" : status === "saving" ? "Saving…" : "Export"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
