/**
 * Colorblind-safe palettes (SPEC §12). Okabe-Ito is the default; Paul Tol's "bright" is the
 * alternative; greyscale serves the APA print preset. Dark-surface variants swap colors that vanish
 * on a dark background (black, the darkest greys).
 */
import type { ResolvedTheme } from "@/stores/theme";

export type PaletteName = "colorblind_safe" | "tol_bright" | "greyscale" | "custom";

const OKABE_ITO = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#D55E00", "#F0E442", "#000000"];
const OKABE_ITO_DARK = ["#3A9AD9", "#E69F00", "#1FB58A", "#D98BB8", "#56B4E9", "#E8742A", "#F0E442", "#BBBBBB"];
const TOL_BRIGHT = ["#4477AA", "#EE6677", "#228833", "#CCBB44", "#66CCEE", "#AA3377", "#BBBBBB"];
const TOL_BRIGHT_DARK = ["#6699CC", "#EE6677", "#44AA55", "#CCBB44", "#66CCEE", "#CC5599", "#BBBBBB"];
const GREYS_LIGHT = ["#000000", "#6b6b6b", "#a8a8a8", "#d0d0d0", "#3a3a3a", "#8a8a8a"];
const GREYS_DARK = ["#f2f2f2", "#a8a8a8", "#6b6b6b", "#4a4a4a", "#d0d0d0", "#8a8a8a"];

export const PALETTES: { name: Exclude<PaletteName, "custom">; label: string; description: string }[] = [
  { name: "colorblind_safe", label: "Colorblind-safe (Okabe-Ito)", description: "Readable for the common kinds of color blindness." },
  { name: "tol_bright", label: "Colorblind-safe (Tol bright)", description: "A second colorblind-safe set with softer tones." },
  { name: "greyscale", label: "Black and greys", description: "For print and APA figures." },
];

export const HEX = /^#[0-9a-f]{6}$/i;

/** `n` series colors for a palette (cycled when there are more series than colors). */
export function paletteColors(name: string | undefined, theme: ResolvedTheme, n: number, custom?: string[] | null): string[] {
  let base: string[];
  if (custom && custom.filter((c) => HEX.test(c)).length) base = custom.filter((c) => HEX.test(c));
  else if (name === "greyscale") base = theme === "dark" ? GREYS_DARK : GREYS_LIGHT;
  else if (name === "tol_bright") base = theme === "dark" ? TOL_BRIGHT_DARK : TOL_BRIGHT;
  else base = theme === "dark" ? OKABE_ITO_DARK : OKABE_ITO;
  const k = Math.max(1, n);
  return Array.from({ length: k }, (_, i) => base[i % base.length]);
}

// ColorBrewer PuOr (colorblind-safe diverging): orange = disagree, purple = agree, grey = neutral.
const PUOR: Record<number, string[]> = {
  2: ["#E08214", "#8073AC"],
  3: ["#F1A340", "#D9D9D9", "#998EC3"],
  4: ["#E66101", "#FDB863", "#B2ABD2", "#5E3C99"],
  5: ["#E66101", "#FDB863", "#D9D9D9", "#B2ABD2", "#5E3C99"],
  6: ["#B35806", "#F1A340", "#FEE0B6", "#D8DAEB", "#998EC3", "#542788"],
  7: ["#B35806", "#F1A340", "#FEE0B6", "#D9D9D9", "#D8DAEB", "#998EC3", "#542788"],
};

/** Colors for `k` ordered Likert responses, disagree -> agree. */
export function divergingColors(k: number, greyscale: boolean, theme: ResolvedTheme): string[] {
  if (greyscale) {
    const light = ["#1a1a1a", "#555555", "#8f8f8f", "#c4c4c4", "#e6e6e6"];
    const ramp = theme === "dark" ? [...light].reverse() : light;
    return Array.from({ length: k }, (_, i) => ramp[Math.round((i * (ramp.length - 1)) / Math.max(1, k - 1))]);
  }
  if (PUOR[k]) return PUOR[k];
  const seven = PUOR[7];
  return Array.from({ length: k }, (_, i) => seven[Math.round((i * 6) / Math.max(1, k - 1))]);
}
