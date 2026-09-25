/**
 * Render the engine's structured APA output (RichText runs, ApaTable cells) to plain text and to
 * self-contained HTML for the clipboard (SPEC §10.1, §10.3): italic symbols, no vertical rules,
 * horizontal rules above/below the header and at the bottom, italic title under a bold
 * "Table N" line, and "Note." notes. The engine already formatted every number.
 */
import type { ApaColumn, ApaTable, RichText, TableCell, TextRun } from "@/contracts";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function richToPlain(runs: RichText | null | undefined): string {
  return (runs ?? []).map((r) => r.text).join("");
}

function runToHtml(r: TextRun): string {
  let h = escapeHtml(r.text);
  if (r.subscript) h = `<sub>${h}</sub>`;
  if (r.superscript) h = `<sup>${h}</sup>`;
  if (r.italic) h = `<i>${h}</i>`;
  return h;
}

export function richToHtml(runs: RichText | null | undefined): string {
  return (runs ?? []).map(runToHtml).join("");
}

export function cellToPlain(c: TableCell): string {
  switch (c.type) {
    case "number":
    case "p_value":
    case "interval":
      return c.display;
    case "text":
      return richToPlain(c.text);
    default:
      return "";
  }
}

export function cellToHtml(c: TableCell): string {
  return c.type === "text" ? richToHtml(c.text) : escapeHtml(cellToPlain(c));
}

/** CSS text-align for a column; "decimal" falls back to right alignment in HTML/Word. */
export function alignOf(col: ApaColumn): "left" | "center" | "right" {
  return col.align === "decimal" ? "right" : col.align;
}

export function tableNumberLabel(t: ApaTable, fallback = 1): string {
  return `Table ${t.number ?? fallback}`;
}

/** Plain-text rendering (tab-separated) for the clipboard's text/plain flavour. */
export function tableToPlain(t: ApaTable, fallbackNumber = 1): string {
  const lines = [tableNumberLabel(t, fallbackNumber), t.title];
  lines.push(t.columns.map((c) => richToPlain(c.header)).join("\t"));
  for (const row of t.rows) {
    const cells = row.cells.map(cellToPlain);
    if (row.indent) cells[0] = "  ".repeat(row.indent) + cells[0];
    lines.push(cells.join("\t"));
  }
  const notes = noteParts(t);
  if (notes.length) lines.push(notes.map(richToPlain).join(" "));
  return lines.join("\n");
}

function noteParts(t: ApaTable): RichText[] {
  const parts: RichText[] = [];
  if (t.notes.general) parts.push([{ text: "Note.", italic: true }, { text: " " }, ...t.notes.general]);
  parts.push(...t.notes.specific, ...t.notes.probability);
  return parts;
}

const RULE = "1px solid #000";

/** Self-contained APA 7 table HTML with inline styles (pastes into Word with formatting). */
export function tableToHtml(t: ApaTable, fallbackNumber = 1): string {
  const font = "font-family:'Times New Roman',Times,serif;font-size:12pt;";
  const pad = "padding:2pt 8pt;";
  const groupRow = t.column_groups.length
    ? (() => {
        const cells: string[] = [];
        let col = 0;
        for (const g of [...t.column_groups].sort((a, b) => a.first_column - b.first_column)) {
          if (g.first_column > col) cells.push(`<th colspan="${g.first_column - col}" style="${pad}"></th>`);
          cells.push(
            `<th colspan="${g.span}" style="${pad}text-align:center;font-weight:normal;border-bottom:${RULE};">${richToHtml(g.label)}</th>`,
          );
          col = g.first_column + g.span;
        }
        if (col < t.columns.length) cells.push(`<th colspan="${t.columns.length - col}" style="${pad}"></th>`);
        return `<tr>${cells.join("")}</tr>`;
      })()
    : "";
  const header = t.columns
    .map((c) => `<th style="${pad}text-align:${alignOf(c)};font-weight:normal;border-bottom:${RULE};">${richToHtml(c.header)}</th>`)
    .join("");
  const body = t.rows
    .map((row, ri) => {
      const last = ri === t.rows.length - 1;
      const cells = row.cells
        .map((c, ci) => {
          const col = t.columns[ci];
          const indent = ci === 0 && row.indent ? `padding-left:${8 + row.indent * 12}pt;` : "";
          const weight = row.kind === "section_header" ? "font-style:italic;" : "";
          const bottom = last ? `border-bottom:${RULE};` : "";
          return `<td style="${pad}${indent}${weight}${bottom}text-align:${col ? alignOf(col) : "left"};">${cellToHtml(c)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  const notes = noteParts(t)
    .map((n) => `<p style="${font}margin:4pt 0 0 0;">${richToHtml(n)}</p>`)
    .join("");
  return (
    `<div style="${font}">` +
    `<p style="${font}margin:0;font-weight:bold;">${escapeHtml(tableNumberLabel(t, fallbackNumber))}</p>` +
    `<p style="${font}margin:0 0 6pt 0;font-style:italic;">${escapeHtml(t.title)}</p>` +
    `<table style="${font}border-collapse:collapse;border-top:${RULE};border-bottom:${RULE};">` +
    `<thead>${groupRow}<tr>${header}</tr></thead><tbody>${body}</tbody></table>${notes}</div>`
  );
}

export interface CopyPayload {
  html: string;
  text: string;
}

/** Rich + plain clipboard payload for an APA sentence. */
export function sentencePayload(runs: RichText): CopyPayload {
  return {
    html: `<p style="font-family:'Times New Roman',Times,serif;font-size:12pt;">${richToHtml(runs)}</p>`,
    text: richToPlain(runs),
  };
}

export function tablePayload(t: ApaTable, fallbackNumber = 1): CopyPayload {
  return { html: tableToHtml(t, fallbackNumber), text: tableToPlain(t, fallbackNumber) };
}

// --- display formatting for values the engine did not pre-format (SPEC §10.1) --------------

/** Effect sizes / statistics that cannot exceed 1 in magnitude: no leading zero in APA. */
const BOUNDED = /^(r|rho|tau.*|r_pb|rank_biserial|.*eta.*|omega.*|epsilon.*|kendall_w|cramers_v|phi|r_sq|alpha|omega|.*_r)$/;

export function isBounded(key: string): boolean {
  return BOUNDED.test(key);
}

export function fmtNum(x: number | null | undefined, digits = 2, bounded = false): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  const s = x.toFixed(digits);
  return bounded ? s.replace(/^(-?)0\./, "$1.") : s;
}

/** APA p: three decimals, no leading zero, "< .001" floor. Returns the text after "p". */
export function fmtPExpr(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "= —";
  if (p < 0.001) return "< .001";
  return `= ${p.toFixed(3).replace(/^0\./, ".")}`;
}

export function fmtDf(df: number[]): string {
  return df.map((d) => (Number.isInteger(d) ? String(d) : d.toFixed(2))).join(", ");
}
