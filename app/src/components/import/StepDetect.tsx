import { AlertTriangle, Info } from "lucide-react";
import { Badge, CheckboxField, NativeSelect, Notice } from "@/components/ui/form";
import { WhyItMatters } from "@/components/ui/why";
import type { FilePreview } from "@/contracts";
import { useImportFlow } from "@/stores/importFlow";

export function describeEncoding(enc: string | null): string {
  if (!enc) return "Excel workbook";
  const e = enc.toLowerCase();
  if (e === "utf-8-sig") return "UTF-8 (with byte-order mark)";
  if (e.startsWith("utf-16")) return "UTF-16 (common in Qualtrics exports)";
  if (e === "utf-8") return "UTF-8";
  return enc;
}

export function describeDelimiter(d: string | null): string | null {
  if (d === null) return null;
  if (d === ",") return "commas";
  if (d === "\t") return "tabs";
  if (d === ";") return "semicolons";
  return `"${d}"`;
}

function headerText(n: number) {
  if (n === 3) return "3 header rows: short names, question text, and Qualtrics' internal IDs (the last row is skipped).";
  if (n === 2) return "2 header rows: short names and question text (an older Qualtrics export).";
  return "1 header row.";
}

function FileCard({ f }: { f: FilePreview }) {
  const decisions = useImportFlow((s) => s.decisions);
  const update = useImportFlow((s) => s.update);
  const changeSheet = useImportFlow((s) => s.changeSheet);
  const busy = useImportFlow((s) => s.busy);
  if (!decisions) return null;
  const confirmed = decisions.qualtricsConfirmed[f.file_id] ?? false;
  const shownVars = f.proposed_variables.filter((v) => !v.is_metadata).slice(0, 6);
  const idx = shownVars.map((v) => f.proposed_variables.indexOf(v));
  const delim = describeDelimiter(f.delimiter);

  return (
    <section className="grid gap-3 rounded-lg border p-4" aria-labelledby={`fp-${f.file_id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`fp-${f.file_id}`} className="font-semibold">
          {f.name}
        </h3>
        <Badge>{f.format.toUpperCase()}</Badge>
        {f.qualtrics.detected && <Badge tone="info">Qualtrics export</Badge>}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Text encoding</dt>
        <dd>{describeEncoding(f.encoding)}</dd>
        {delim && (
          <>
            <dt className="text-muted-foreground">Columns split by</dt>
            <dd>{delim}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Responses</dt>
        <dd>{f.n_rows.toLocaleString()} rows, {f.proposed_variables.length} columns</dd>
        <dt className="text-muted-foreground">Headers</dt>
        <dd>{headerText(confirmed ? f.qualtrics.header_rows : 1)}</dd>
      </dl>
      {f.sheets.length > 1 && (
        <div className="grid max-w-sm gap-1.5">
          <label htmlFor={`sheet-${f.file_id}`} className="text-sm font-medium">
            Which sheet holds the responses?
          </label>
          <NativeSelect
            id={`sheet-${f.file_id}`}
            value={f.sheet_name ?? f.sheets[0]}
            disabled={busy}
            onChange={(e) => void changeSheet(f.file_id, e.target.value)}
          >
            {f.sheets.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      {(f.qualtrics.detected || f.qualtrics.header_rows > 1) && (
        <CheckboxField
          label="Treat this as a Qualtrics export"
          description="Uses the first header row as short names and the second as question text."
          checked={confirmed}
          onChange={(e) => update({ qualtricsConfirmed: { ...decisions.qualtricsConfirmed, [f.file_id]: e.target.checked } })}
        />
      )}
      {f.issues.length > 0 && (
        <ul className="grid gap-1.5">
          {f.issues.map((i, k) => (
            <li key={k} className="flex items-start gap-2 text-sm">
              {i.severity === "info" ? (
                <Info className="mt-0.5 size-4 shrink-0 text-sky-700 dark:text-sky-300" aria-label="Note" />
              ) : (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" aria-label="Check this" />
              )}
              <span>{i.message}</span>
            </li>
          ))}
        </ul>
      )}
      {shownVars.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="mb-1 text-left text-xs text-muted-foreground">First few answers (survey system columns not shown)</caption>
            <thead>
              <tr>
                {shownVars.map((v) => (
                  <th key={v.name} scope="col" className="border-b px-2 py-1 font-medium" title={v.question_text ?? undefined}>
                    {v.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {f.sample_rows.slice(0, 4).map((row, r) => (
                <tr key={r}>
                  {idx.map((c) => (
                    <td key={c} className="max-w-40 truncate border-b px-2 py-1">
                      {row[c] === null ? "" : String(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function StepDetect() {
  const preview = useImportFlow((s) => s.preview);
  if (!preview) return <Notice>Statly is still reading your files…</Notice>;
  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground">Here's how Statly read each file. Most of the time you don't need to change anything.</p>
      <WhyItMatters>
        <p>
          Files can be saved in different ways. Qualtrics sometimes uses an unusual text format (UTF-16) or tabs
          instead of commas. If Statly guessed wrong, names and letters can come out garbled.
        </p>
        <p>
          Qualtrics exports have two or three header rows before the answers start: short names like Q5_1, the
          full question text, and sometimes an internal ID row. Statly uses the short names as variable names,
          keeps the question text as a label, and skips the ID row so it isn't counted as a person.
        </p>
      </WhyItMatters>
      {preview.files.map((f) => (
        <FileCard key={f.file_id} f={f} />
      ))}
    </div>
  );
}
