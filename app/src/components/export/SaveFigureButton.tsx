/**
 * "Save figure…" (SPEC §10.3): PNG at 1x/2x/4x (150/300/600 DPI), SVG, or PDF, for one chart.
 *
 * Two sources, same menu:
 *  - `{ result, chart }` (Results screen / assumption checks): the AnalysisResult and the ChartRef
 *    it came from (lib/export/chartSelection.availableCharts / pickReportChart pick which); renders
 *    self-contained (lib/export/figure.ts), independent of whatever chart component is mounted.
 *  - `{ view, title }` (Chart Builder): most builder charts are drawn straight from the dataset, with
 *    no AnalysisResult/ChartRef to re-render from, so bytes come off the already-mounted Vega `View`
 *    (BuilderChart's `getVegaView()`/`getActiveChartView()`) instead.
 */
import { Download } from "lucide-react";
import type { View } from "vega";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { AnalysisResult, ChartRef } from "@/contracts";
import { dpiFor, type PngScale } from "@/lib/export/figure";
import { saveBuilderFigurePdf, saveBuilderFigurePng, saveBuilderFigureSvg, saveFigurePdf, saveFigurePng, saveFigureSvg, type SaveFigureResult } from "@/lib/export/saveFigure";
import { useNotify } from "@/stores/notify";
import { useThemeStore } from "@/stores/theme";

type Source = { result: AnalysisResult; chart: ChartRef; view?: undefined; title?: undefined } | { view: () => View | null; title: string; result?: undefined; chart?: undefined };

export function SaveFigureButton(props: Source & { defaultName: string }) {
  const { defaultName } = props;
  const theme = useThemeStore((s) => s.resolved);

  async function run(action: () => Promise<SaveFigureResult | null>) {
    try {
      const res = await action();
      if (res) useNotify.getState().show(res.dpi ? `Saved ${res.path} (${res.dpi} DPI).` : `Saved ${res.path}.`);
    } catch {
      useNotify.getState().show("Statly couldn't save that figure. Please try again.", "error");
    }
  }

  let png: (scale: PngScale) => () => void;
  let svg: () => void;
  let pdf: () => void;

  if (props.view) {
    const { view, title } = props;
    const liveView = () => {
      const v = view();
      if (!v) throw new Error("This chart isn't ready to export yet.");
      return v;
    };
    png = (scale) => () => run(() => saveBuilderFigurePng(liveView(), scale, defaultName));
    svg = () => void run(() => saveBuilderFigureSvg(liveView(), defaultName));
    pdf = () => void run(() => saveBuilderFigurePdf(liveView(), title, defaultName));
  } else {
    const { result, chart } = props;
    const rows = result.chart_data[chart.data_key] ?? [];
    png = (scale) => () => run(() => saveFigurePng(chart, rows, theme, scale, defaultName));
    svg = () => void run(() => saveFigureSvg(chart, rows, theme, defaultName));
    pdf = () => void run(() => saveFigurePdf(result, chart, theme, defaultName));
  }

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
        <DropdownMenuItem onSelect={svg}>SVG (vector)</DropdownMenuItem>
        <DropdownMenuItem onSelect={pdf}>PDF</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
