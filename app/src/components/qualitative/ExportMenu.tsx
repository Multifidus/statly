import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { pickExportPath } from "@/lib/dialogs";
import { qualRpc } from "@/lib/qualitative/api";
import { describeEditError } from "@/lib/variableEdits";
import { useNotify } from "@/stores/notify";
import { useQualitative } from "@/stores/qualitative";

type Choice = { kind: "responses" | "codebook"; format: "xlsx" | "docx"; label: string };
const CHOICES: Choice[] = [
  { kind: "responses", format: "xlsx", label: "Coded responses (Excel, one column per tag)" },
  { kind: "responses", format: "docx", label: "Coded responses (Word, grouped by tag)" },
  { kind: "codebook", format: "xlsx", label: "Codebook (Excel)" },
  { kind: "codebook", format: "docx", label: "Codebook (Word)" },
];

/** Export coded responses and the codebook (engine `export.qualitative`). */
export function ExportMenu({ datasetId }: { datasetId: string }) {
  const variable = useQualitative((s) => s.variable);
  const contextVars = useQualitative((s) => s.contextVars);
  const [busy, setBusy] = useState(false);
  const notify = useNotify((s) => s.show);

  const run = async (c: Choice) => {
    if (!variable) return;
    const path = await pickExportPath(c.kind === "codebook" ? `${variable} codebook` : `${variable} coded responses`, c.format);
    if (!path) return;
    setBusy(true);
    try {
      // The save dialog already asked before replacing an existing file.
      const res = await qualRpc.exportQualitative({
        dataset_id: datasetId,
        variable,
        kind: c.kind,
        format: c.format,
        path,
        context_variables: contextVars,
        overwrite: true,
      });
      notify(`Saved ${res.path.split(/[\\/]/).pop()} (${res.n_responses} responses).`);
    } catch (e) {
      notify(describeEditError(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy || !variable} data-testid="qual-export">
          <Download aria-hidden /> Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {CHOICES.map((c, i) => (
          <span key={c.label}>
            {i === 2 && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={() => void run(c)}>{c.label}</DropdownMenuItem>
          </span>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
