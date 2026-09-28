import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "@/contracts";
import example from "../../../contracts/examples/AnalysisResult.json";
import { fmtNum, fmtPExpr, parseApaMarkup, richToHtml, richToPlain, sentencePayload, tablePayload, tableToHtml } from "@/lib/apa";

const result = example as unknown as AnalysisResult;

describe("APA copy payloads", () => {
  it("copies the APA sentence as rich HTML with italic symbols plus plain text", () => {
    const p = sentencePayload(result.apa_sentence);
    expect(p.text).toBe(result.apa_sentence.map((r) => r.text).join(""));
    expect(p.text).toContain("(37.4) = 2.31, p = .026");
    expect(p.html).toContain("<i>t</i>(37.4) = 2.31, <i>p</i> = .026");
    expect(p.html).toMatch(/^<p style="font-family:'Times New Roman'/);
  });

  it("escapes HTML and renders sub/superscripts", () => {
    expect(richToHtml([{ text: "a<b & c" }, { text: "2", superscript: true }, { text: "p", italic: true, subscript: true }])).toBe(
      "a&lt;b &amp; c<sup>2</sup><i><sub>p</sub></i>",
    );
    expect(richToPlain(null)).toBe("");
  });

  it("renders the APA table with number, italic title, horizontal rules only and notes", () => {
    const t = result.apa_table!;
    const html = tableToHtml(t);
    expect(html).toContain(`>Table ${t.number ?? 1}</p>`);
    expect(html).toContain(`font-style:italic;">${t.title}</p>`);
    expect(html).toContain("border-top:1px solid #000");
    expect(html).not.toMatch(/border-(left|right)/);
    expect(html).toContain("<i>Note.</i>");
    for (const row of t.rows) for (const c of row.cells) if (c.type === "p_value") expect(html).toContain(c.display.replace("<", "&lt;"));
    // Numeric/statistic cells and header cells must not wrap when pasted into Word/Pages; the
    // first (label) column is allowed to wrap.
    expect(html).toMatch(/<th style="[^"]*white-space:nowrap;[^"]*">/);
    const firstRowTds = html.match(/<tr>((?:<td[^>]*>.*?<\/td>)+)<\/tr>/)?.[1] ?? "";
    const tdCells = [...firstRowTds.matchAll(/<td style="([^"]*)">/g)];
    expect(tdCells.length).toBeGreaterThan(1);
    expect(tdCells[0][1]).not.toContain("white-space:nowrap;");
    for (const cell of tdCells.slice(1)) expect(cell[1]).toContain("white-space:nowrap;");
    const plain = tablePayload(t).text.split("\n");
    expect(plain[0]).toBe(`Table ${t.number ?? 1}`);
    expect(plain[1]).toBe(t.title);
    expect(plain[2].split("\t")).toHaveLength(t.columns.length);
  });

  it("formats p and bounded values per APA", () => {
    expect(fmtPExpr(0.0004)).toBe("< .001");
    expect(fmtPExpr(0.0261)).toBe("= .026");
    expect(fmtPExpr(null)).toBe("= —");
    expect(fmtNum(0.357, 2, true)).toBe(".36");
    expect(fmtNum(-0.357, 2, true)).toBe("-.36");
    expect(fmtNum(1.2345)).toBe("1.23");
  });
});

describe("parseApaMarkup (Learn-library How-to-report templates)", () => {
  it("italicizes *symbol* runs, keeps {placeholders} literal, and does not touch bare digits", () => {
    const runs = parseApaMarkup("There was a difference, *t*({df}) = {t}, *p* = {p}.");
    expect(richToPlain(runs)).toBe("There was a difference, t({df}) = {t}, p = {p}.");
    expect(runs.filter((r) => r.italic).map((r) => r.text)).toEqual(["t", "p"]);
    expect(runs.some((r) => r.text === "{df}" && !r.italic)).toBe(true);
    expect(runs.some((r) => r.text === "{p}" && !r.italic)).toBe(true);
  });

  it("renders _word as a subscript, bare or inside *..*, and ²/³ as a superscript", () => {
    const spearman = parseApaMarkup("*r*_s({df}) = {rho}");
    const sub = spearman.find((r) => r.subscript);
    expect(sub).toMatchObject({ text: "s", subscript: true });

    const dAv = parseApaMarkup("*d_av* = {dav}");
    const dSub = dAv.find((r) => r.subscript);
    expect(dSub).toMatchObject({ text: "av", subscript: true, italic: true });

    const chi = parseApaMarkup("*chi*²({df}, *N* = {n}) = {chi2}");
    const sup = chi.find((r) => r.superscript);
    expect(sup).toMatchObject({ text: "2", superscript: true });
    expect(richToPlain(chi)).toBe("chi2({df}, N = {n}) = {chi2}");
  });
});
