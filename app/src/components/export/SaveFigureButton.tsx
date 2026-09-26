/**
 * "Save figure…" (SPEC §10.3): PNG at 1x/2x/4x (150/300/600 DPI), SVG, or PDF, for one chart. Takes
 * the AnalysisResult and the ChartRef it came from (lib/export/chartSelection.availableCharts /
 * pickReportChart pick which); renders self-contained (lib/export/figure.ts), independent of
 * whatever chart component is currently mounted.
 */
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { AnalysisResult, ChartRef } from "@/contracts";
import { dpiFor, type PngScale } from "@/lib/export/figure";
import { saveFigurePdf, saveFigurePng, saveFigureSvg, type SaveFigureResult } from "@/lib/export/saveFigure";
import { useNotify } from "@/stores/notify";
import { useThemeStore } from "@/stores/theme";

export function SaveFigureButton({ result, chart, defaultName }: { result: AnalysisResult; chart: ChartRef; defaultName: string }) {
  const theme = useThemeStore((s) => s.resolved);
  const rows = result.chart_data[chart.data_key] ?? [];

  async function run(action: () => Promise<SaveFigureResult | null>) {
    try {
      const res = await action();
      if (res) useNotify.getState().show(res.dpi ? `Saved ${res.path} (${res.dpi} DPI).` : `Saved ${res.path}.`);
    } catch {
      useNotify.getState().show("Statly couldn't save that figure. Please try again.", "error");
    }
  }

  const png = (scale: PngScale) => () => run(() => saveFigurePng(chart, rows, theme, scale, defaultName));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" data-testid="save-figure">
          <Download aria-hidden /> Save figure…
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={png(1)}>PNG ({dpiFor(1)} DPI)</DropdownMenuItem>
        <DropdownMenuItem onSelect={png(2)}>PNG ({dpiFor(2)} DPI)</DropdownMenuItem>
        <DropdownMenuItem onSelect={png(4)}>PNG ({dpiFor(4)} DPI)</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void run(() => saveFigureSvg(chart, rows, theme, defaultName))}>SVG (vector)</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void run(() => saveFigurePdf(result, chart, theme, defaultName))}>PDF</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
