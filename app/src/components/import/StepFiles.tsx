import { FileSpreadsheet, FolderOpen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/form";
import { WhyItMatters } from "@/components/ui/why";
import type { QualtricsMode } from "@/contracts";
import { pickImportFiles } from "@/lib/dialogs";
import { useImportFlow } from "@/stores/importFlow";

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export function StepFiles() {
  const files = useImportFlow((s) => s.files);
  const addFiles = useImportFlow((s) => s.addFiles);
  const removeFile = useImportFlow((s) => s.removeFile);
  const mode = useImportFlow((s) => s.qualtricsMode);
  const setMode = useImportFlow((s) => s.setQualtricsMode);

  const choose = async () => {
    const paths = await pickImportFiles();
    if (paths?.length) addFiles(paths);
  };

  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground">
        Pick one file, or several files from the same survey given at different times (for example Pre, Post
        and Follow-up). Statly reads CSV files and Excel workbooks (.xlsx). Your original files are never changed.
      </p>
      <WhyItMatters>
        <p>
          If you gave the same survey more than once, choose all of those files now. Statly will stack them into
          one table and add a <strong>Time</strong> column, so you can compare time points later.
        </p>
        <p>Statly keeps an untouched copy of every file inside your project, so you can always see where your numbers came from.</p>
      </WhyItMatters>
      <div>
        <Button onClick={choose} data-testid="choose-files">
          <FolderOpen aria-hidden /> Choose files…
        </Button>
      </div>
      {files.length > 0 && (
        <ul className="grid gap-2" aria-label="Files to import">
          {files.map((f) => (
            <li key={f.path} className="flex items-center gap-3 rounded-md border px-3 py-2">
              <FileSpreadsheet className="size-4 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm" title={f.path}>
                {baseName(f.path)}
              </span>
              <Button variant="ghost" size="icon-sm" onClick={() => removeFile(f.path)} aria-label={`Remove ${baseName(f.path)}`}>
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid max-w-md gap-1.5">
        <label htmlFor="qualtrics-mode" className="text-sm font-medium">
          Qualtrics exports
        </label>
        <NativeSelect id="qualtrics-mode" value={mode} onChange={(e) => setMode(e.target.value as QualtricsMode)}>
          <option value="auto">Detect automatically (recommended)</option>
          <option value="on">These are Qualtrics exports</option>
          <option value="off">These are not from Qualtrics</option>
        </NativeSelect>
      </div>
    </div>
  );
}
