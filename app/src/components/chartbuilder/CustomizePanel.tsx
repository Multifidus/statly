import { useId } from "react";
import type { ChartSpec } from "@/contracts";
import { CheckboxField, Input, NativeSelect } from "@/components/ui/form";
import { CHART_INFO } from "@/lib/chartbuilder/catalog";
import { autoTitle } from "@/lib/chartbuilder/compile";
import { HEX, PALETTES, paletteColors } from "@/lib/chartbuilder/palettes";
import type { BuilderCustomization, ChartsDataResult } from "@/lib/chartbuilder/types";
import { useChartBuilder } from "@/stores/chartBuilder";

const FONTS = [
  { value: "", label: "Default for the style" },
  { value: "Arial, Helvetica, sans-serif", label: "Arial" },
  { value: "Helvetica, Arial, sans-serif", label: "Helvetica" },
  { value: "Calibri, Carlito, sans-serif", label: "Calibri" },
  { value: "Georgia, serif", label: "Georgia (serif)" },
  { value: "'Times New Roman', Times, serif", label: "Times New Roman (serif)" },
];

function Field({ label, children, hint }: { label: string; children: (id: string) => React.ReactNode; hint?: string }) {
  const id = useId();
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const numOrNull = (s: string): number | null => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-2 border-t pt-3">
      <legend className="pr-2 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

function AxisFields({ axis, name, c }: { axis: "x_axis" | "y_axis"; name: string; c: BuilderCustomization }) {
  const setAxis = useChartBuilder((s) => s.setAxis);
  const a = c[axis] ?? {};
  return (
    <div className="grid gap-2">
      <Field label={`${name} axis label`}>{(id) => <Input id={id} value={a.label ?? ""} placeholder="Automatic" onChange={(e) => setAxis(axis, { label: e.target.value === "" ? null : e.target.value })} data-testid={`${axis}-label`} />}</Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={`${name} from`}>{(id) => <Input id={id} type="number" value={a.min ?? ""} placeholder="Auto" onChange={(e) => setAxis(axis, { min: numOrNull(e.target.value) })} data-testid={`${axis}-min`} />}</Field>
        <Field label={`${name} to`}>{(id) => <Input id={id} type="number" value={a.max ?? ""} placeholder="Auto" onChange={(e) => setAxis(axis, { max: numOrNull(e.target.value) })} data-testid={`${axis}-max`} />}</Field>
      </div>
    </div>
  );
}

/** Titles, axes, colors, fonts, legend, labels, gridlines, size, error bars and the APA figure preset. */
export function CustomizePanel({ spec, data }: { spec: ChartSpec; data: ChartsDataResult | null }) {
  const customize = useChartBuilder((s) => s.customize);
  const setPreset = useChartBuilder((s) => s.setPreset);
  const setErrorBars = useChartBuilder((s) => s.setErrorBars);
  const c = spec.customization as BuilderCustomization;
  const info = CHART_INFO[spec.chart_type];
  const apa = spec.theme_preset === "apa";
  const seriesLevels = data?.meta.levels?.[spec.chart_type === "scree" ? "series" : "color"] ?? data?.meta.levels?.x ?? [];
  const nSeries = Math.max(1, Math.min(8, spec.chart_type === "violin" && !spec.shelves.color.length ? seriesLevels.length : (data?.meta.levels?.color?.length ?? (spec.chart_type === "scree" ? 3 : 1))));
  const custom = c.palette === "custom";
  const current = paletteColors(custom ? "colorblind_safe" : c.palette, "light", nSeries, custom ? c.custom_colors : null);
  const usesPalette = !["likert_diverging", "correlation_heatmap", "cfa_path"].includes(spec.chart_type);
  return (
    <section aria-label="Customize chart" className="grid content-start gap-3" data-testid="customize-panel">
      <h3 className="text-sm font-semibold">Customize</h3>

      <div role="radiogroup" aria-label="Style" className="grid grid-cols-2 gap-1 rounded-md border p-1">
        {(["statly", "apa"] as const).map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={spec.theme_preset === p}
            onClick={() => setPreset(p)}
            data-testid={`preset-${p}`}
            className={"rounded-sm px-2 py-1 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 " + (spec.theme_preset === p ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
          >
            {p === "apa" ? "APA figure" : "Statly style"}
          </button>
        ))}
      </div>
      {apa && (
        <div className="grid gap-2" data-testid="apa-options">
          <p className="text-xs text-muted-foreground">APA 7 figure style: sans-serif font, no gridlines, a bold figure number with an italic title above, and an optional note below.</p>
          <div className="grid grid-cols-[5rem_1fr] gap-2">
            <Field label="Figure no.">{(id) => <Input id={id} type="number" min={1} value={c.figure_number ?? 1} onChange={(e) => customize({ figure_number: Math.max(1, Math.round(Number(e.target.value) || 1)) })} data-testid="figure-number" />}</Field>
            <div className="self-end pb-1.5">
              <CheckboxField label="Black and greys" checked={!!c.greyscale} onChange={(e) => customize({ greyscale: e.target.checked })} data-testid="apa-greyscale" />
            </div>
          </div>
        </div>
      )}

      <Section title="Titles">
        <Field label={apa ? "Figure title (italic)" : "Title"}>
          {(id) => <Input id={id} value={c.title ?? ""} placeholder={autoTitle(spec, data)} onChange={(e) => customize({ title: e.target.value === "" ? null : e.target.value })} data-testid="chart-title" />}
        </Field>
        {!apa && <Field label="Subtitle">{(id) => <Input id={id} value={c.subtitle ?? ""} onChange={(e) => customize({ subtitle: e.target.value === "" ? null : e.target.value })} />}</Field>}
        <Field label={apa ? "Note (below the figure)" : "Note below the chart"}>
          {(id) => <textarea id={id} rows={2} value={c.figure_note ?? ""} onChange={(e) => customize({ figure_note: e.target.value === "" ? null : e.target.value })} className="rounded-md border border-input bg-background px-2 py-1 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" data-testid="figure-note" />}
        </Field>
      </Section>

      {(info.errorBars || ["histogram", "scatter", "correlation_heatmap", "density", "violin"].includes(spec.chart_type)) && (
        <Section title="Chart options">
          {info.errorBars && (
            <Field label="Error bars" hint="SE shows how precise each mean is; SD shows how spread out scores are; 95% CI is the range likely to hold the true mean.">
              {(id) => (
                <NativeSelect id={id} value={spec.error_bars} onChange={(e) => setErrorBars(e.target.value as ChartSpec["error_bars"])} data-testid="error-bars">
                  <option value="ci95">95% confidence interval</option>
                  <option value="se">Standard error (SE)</option>
                  <option value="sd">Standard deviation (SD)</option>
                  <option value="none">None</option>
                </NativeSelect>
              )}
            </Field>
          )}
          {spec.chart_type === "histogram" && (
            <Field label="Number of bins" hint="Leave empty for the Freedman-Diaconis rule.">
              {(id) => <Input id={id} type="number" min={2} max={100} value={c.bins ?? ""} placeholder="Automatic" onChange={(e) => customize({ bins: numOrNull(e.target.value) })} data-testid="bins" />}
            </Field>
          )}
          {spec.chart_type === "scatter" && (
            <Field label="Fit line">
              {(id) => (
                <NativeSelect id={id} value={c.fit_line ?? "linear"} onChange={(e) => customize({ fit_line: e.target.value as BuilderCustomization["fit_line"] })} data-testid="fit-line">
                  <option value="linear">Straight line (least squares)</option>
                  <option value="loess">Smooth curve (LOWESS)</option>
                  <option value="none">None</option>
                </NativeSelect>
              )}
            </Field>
          )}
          {spec.chart_type === "correlation_heatmap" && (
            <Field label="Correlation">
              {(id) => (
                <NativeSelect id={id} value={c.correlation_method ?? "pearson"} onChange={(e) => customize({ correlation_method: e.target.value as "pearson" | "spearman" })}>
                  <option value="pearson">Pearson r</option>
                  <option value="spearman">Spearman rho (ranks)</option>
                </NativeSelect>
              )}
            </Field>
          )}
          {(spec.chart_type === "density" || spec.chart_type === "violin") && (
            <Field label="Smoothing" hint="1 = Scott's rule. Lower shows more detail.">
              {(id) => <Input id={id} type="number" step={0.1} min={0.1} max={5} value={c.bandwidth_adjust ?? 1} onChange={(e) => customize({ bandwidth_adjust: numOrNull(e.target.value) ?? 1 })} />}
            </Field>
          )}
        </Section>
      )}

      {spec.chart_type !== "cfa_path" && (
        <Section title="Axes">
          <AxisFields axis="x_axis" name="X" c={c} />
          <AxisFields axis="y_axis" name="Y" c={c} />
        </Section>
      )}

      {usesPalette && !(apa && c.greyscale) && (
        <Section title="Colors">
          <Field label="Palette">
            {(id) => (
              <NativeSelect id={id} value={c.palette ?? "colorblind_safe"} onChange={(e) => customize({ palette: e.target.value, ...(e.target.value === "custom" && !c.custom_colors?.length ? { custom_colors: paletteColors("colorblind_safe", "light", nSeries) } : {}) })} data-testid="palette">
                {PALETTES.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.label}
                  </option>
                ))}
                <option value="custom">Custom colors</option>
              </NativeSelect>
            )}
          </Field>
          <div className="flex flex-wrap gap-2" aria-label="Series colors">
            {current.map((col, i) => (
              <label key={i} className="grid justify-items-center gap-0.5 text-xs">
                <input
                  type="color"
                  value={HEX.test(col) ? col : "#000000"}
                  disabled={!custom}
                  aria-label={`Color ${i + 1}${seriesLevels[i] ? ` (${seriesLevels[i]})` : ""}`}
                  onChange={(e) => {
                    const next = [...(c.custom_colors ?? current)];
                    next[i] = e.target.value;
                    customize({ palette: "custom", custom_colors: next });
                  }}
                  className="h-7 w-9 cursor-pointer rounded border disabled:cursor-default"
                />
                <span className="max-w-12 truncate text-muted-foreground">{seriesLevels[i] ?? ""}</span>
              </label>
            ))}
          </div>
          {custom && <p className="text-xs text-muted-foreground">Custom colors may be hard to tell apart for some readers. The default palettes are colorblind-safe.</p>}
        </Section>
      )}

      <Section title="Text and layout">
        <div className="grid grid-cols-[1fr_5rem] gap-2">
          <Field label="Font">
            {(id) => (
              <NativeSelect id={id} value={c.font_family ?? ""} onChange={(e) => customize({ font_family: e.target.value || undefined })}>
                {FONTS.map((f) => (
                  <option key={f.label} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="Size">{(id) => <Input id={id} type="number" min={8} max={24} value={c.font_size ?? 12} onChange={(e) => customize({ font_size: Math.min(24, Math.max(8, Number(e.target.value) || 12)) })} />}</Field>
        </div>
        <Field label="Legend">
          {(id) => (
            <NativeSelect id={id} value={c.legend_position ?? (apa || spec.chart_type === "likert_diverging" ? "bottom" : "right")} onChange={(e) => customize({ legend_position: e.target.value as BuilderCustomization["legend_position"] })} data-testid="legend-position">
              <option value="right">Right</option>
              <option value="bottom">Bottom</option>
              <option value="top">Top</option>
              <option value="left">Left</option>
              <option value="none">Hidden</option>
            </NativeSelect>
          )}
        </Field>
        <CheckboxField label="Show data labels" checked={c.data_labels ?? spec.chart_type === "correlation_heatmap"} onChange={(e) => customize({ data_labels: e.target.checked })} data-testid="data-labels" />
        <CheckboxField label="Gridlines" checked={c.gridlines ?? !apa} onChange={(e) => customize({ gridlines: e.target.checked })} data-testid="gridlines" />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Width (px)">{(id) => <Input id={id} type="number" min={200} max={1600} step={10} value={c.width ?? 480} onChange={(e) => customize({ width: Math.max(200, Math.round(Number(e.target.value) || 480)) })} data-testid="chart-width" />}</Field>
          <Field label="Height (px)">{(id) => <Input id={id} type="number" min={120} max={1200} step={10} value={c.height ?? 300} onChange={(e) => customize({ height: Math.max(120, Math.round(Number(e.target.value) || 300)) })} data-testid="chart-height" />}</Field>
        </div>
      </Section>
    </section>
  );
}
