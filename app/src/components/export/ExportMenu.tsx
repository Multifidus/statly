/** Export menu (SPEC §10.3), a peer of ProjectMenu since a report spans the whole project (multiple logged tests). */
import { useState } from "react";
import { ChevronDown, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CodebookExportDialog } from "@/components/export/CodebookExportDialog";
import { DataExportDialog } from "@/components/export/DataExportDialog";
import { ReportExportDialog } from "@/components/export/ReportExportDialog";
import { TestLogExportDialog } from "@/components/export/TestLogExportDialog";
import { useExportFlow } from "@/stores/exportFlow";
import { useProjectStore } from "@/stores/project";

type SimpleDialog = "data" | "codebook" | "testlog" | null;

export function ExportMenu() {
  const project = useProjectStore((s) => s.project);
  const [dialog, setDialog] = useState<SimpleDialog>(null);
  const showReport = useExportFlow((s) => s.show);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" disabled={!project} data-testid="export-menu">
            <FileDown aria-hidden /> Export
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={showReport} data-testid="export-menu-report">
            Report…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("data")} data-testid="export-menu-data">
            Data…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("codebook")} data-testid="export-menu-codebook">
            Codebook…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("testlog")} data-testid="export-menu-testlog">
            Test Log…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ReportExportDialog />
      <DataExportDialog open={dialog === "data"} onOpenChange={(o) => setDialog(o ? "data" : null)} />
      <CodebookExportDialog open={dialog === "codebook"} onOpenChange={(o) => setDialog(o ? "codebook" : null)} />
      <TestLogExportDialog open={dialog === "testlog"} onOpenChange={(o) => setDialog(o ? "testlog" : null)} />
    </>
  );
}
