/** Split text into plain / matched segments from engine match spans (UTF-16 indices). */
export interface Segment {
  text: string;
  match: boolean;
}

export function highlightSegments(text: string, spans: readonly (readonly [number, number])[]): Segment[] {
  const out: Segment[] = [];
  let pos = 0;
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  for (const [s0, e0] of sorted) {
    const s = Math.max(pos, Math.min(s0, text.length));
    const e = Math.max(s, Math.min(e0, text.length));
    if (e <= s) continue;
    if (s > pos) out.push({ text: text.slice(pos, s), match: false });
    out.push({ text: text.slice(s, e), match: true });
    pos = e;
  }
  if (pos < text.length || out.length === 0) out.push({ text: text.slice(pos), match: false });
  return out;
}

/** Okabe-Ito colorblind-safe palette (black swapped for grey so it shows in both themes). */
export const TAG_PALETTE = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#D55E00", "#F0E442", "#999999"] as const;

/** Readable text color (black or white) on a tag color, by WCAG relative luminance. */
export function textOn(hex: string): "#000000" | "#ffffff" {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? "#000000" : "#ffffff";
}
