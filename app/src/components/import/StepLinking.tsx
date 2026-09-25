import { CheckboxField, NativeSelect, Notice } from "@/components/ui/form";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";
import { WhyItMatters } from "@/components/ui/why";
import type { LinkMode, LinkReport } from "@/contracts";
import { unionVariables } from "@/lib/importLogic";
import { useImportFlow } from "@/stores/importFlow";

export function AggregateTeachingNote() {
  return (
    <Notice>
      <p className="font-medium">About comparing time points without linking</p>
      <p className="mt-1">
        Without linking, Statly treats each time point as a separate group of people. That means it can't use paired
        tests (like a paired t-test), because those need to know which "before" goes with which "after".
      </p>
      <p className="mt-1">
        If many of the same people answered at both times, the groups aren't fully independent either, which the
        usual tests assume. That's okay for many class projects, but mention it as a limitation, for example: "Pre
        and post responses could not be matched, so time points were compared as independent groups."
      </p>
    </Notice>
  );
}

export function LinkReportView({ report }: { report: LinkReport }) {
  const { counts } = report;
  return (
    <section aria-labelledby="link-report" className="grid gap-3 rounded-lg border p-4" data-testid="link-report">
      <h3 id="link-report" className="font-semibold">
        How the IDs matched
      </h3>
      <dl className="grid grid-cols-3 gap-3 text-center">
        {[
          ["Matched", counts.matched, "in every time point"],
          ["Unmatched", counts.unmatched, "missing from at least one"],
          ["Duplicates", counts.duplicate, "appear twice in one time point"],
        ].map(([k, v, hint]) => (
          <div key={k as string} className="rounded-md bg-muted p-2">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{v}</dd>
            <dd className="text-xs text-muted-foreground">{hint}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm">{report.explanation}</p>
      <p className="text-sm text-muted-foreground">
        Unmatched people are left out only of paired and repeated-measures tests. They stay in your data for every other analysis.
      </p>
      {report.duplicate_ids.length > 0 && (
        <p className="text-sm">
          <span className="font-medium">Duplicate IDs to check:</span>{" "}
          <span className="font-mono">{report.duplicate_ids.slice(0, 20).join(", ")}</span>
        </p>
      )}
      {report.unmatched_ids.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer">Show unmatched IDs</summary>
          <p className="mt-1 font-mono text-xs break-words">{report.unmatched_ids.join(", ")}</p>
        </details>
      )}
    </section>
  );
}

export function StepLinking() {
  const preview = useImportFlow((s) => s.preview);
  const d = useImportFlow((s) => s.decisions);
  const update = useImportFlow((s) => s.update);
  if (!preview || !d) return <Notice>Statly is still reading your files…</Notice>;

  const candidates = unionVariables(preview.files)
    .filter((v) => v.dtype === "string" || v.dtype === "integer")
    .filter((v) => !v.is_metadata || v.is_pii || v.role === "identifier")
    .sort((a, b) => Number(b.role === "identifier") - Number(a.role === "identifier"));
  const idDropped = d.idVariable !== null && d.dropColumns.includes(d.idVariable);

  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground">Can Statly tell which answers came from the same person at each time point?</p>
      <WhyItMatters>
        <p>
          Comparing the same people before and after (paired) is more powerful than comparing two separate groups,
          because each person is compared with themselves. To do that, Statly needs a column that identifies each
          person the same way in every file, such as a student code.
        </p>
        <p>
          People type IDs differently ("ab12 " vs "AB12"), so Statly ignores extra spaces and capital letters when
          matching. After import you'll see how many people matched.
        </p>
      </WhyItMatters>
      <RadioGroup value={d.linkMode} onValueChange={(v) => update({ linkMode: v as LinkMode })} aria-label="How to treat people across time">
        <RadioCard id="link-aggregate" value="aggregate" title="Don't link (default)">
          Treat each time point as a separate group. Works with anonymous surveys.
        </RadioCard>
        <RadioCard id="link-linked" value="linked" title="Link people by an ID">
          Match each person across time points using a column like a student code.
        </RadioCard>
      </RadioGroup>
      {d.linkMode === "aggregate" ? (
        <AggregateTeachingNote />
      ) : (
        <section aria-labelledby="sec-id" className="grid gap-3 rounded-lg border p-4">
          <h3 id="sec-id" className="font-semibold">
            Which column identifies each person?
          </h3>
          <div className="grid max-w-md gap-1.5">
            <label htmlFor="id-var" className="text-sm font-medium">
              ID column
            </label>
            <NativeSelect id="id-var" value={d.idVariable ?? ""} onChange={(e) => update({ idVariable: e.target.value || null })}>
              <option value="">Choose a column…</option>
              {candidates.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}
                  {v.question_text && v.question_text !== v.name ? ` - ${v.question_text.slice(0, 60)}` : ""}
                </option>
              ))}
            </NativeSelect>
          </div>
          {idDropped && (
            <Notice tone="error" role="alert">
              This column is set to be removed as personal information. Go back to Survey clean-up and keep it, or pick another column.
            </Notice>
          )}
          <CheckboxField
            label="Ignore extra spaces"
            checked={d.normalization.trim_whitespace}
            onChange={(e) => update({ normalization: { ...d.normalization, trim_whitespace: e.target.checked } })}
          />
          <CheckboxField
            label="Ignore capital letters"
            checked={d.normalization.case_insensitive}
            onChange={(e) => update({ normalization: { ...d.normalization, case_insensitive: e.target.checked } })}
          />
          <p className="text-sm text-muted-foreground">You'll see how many people matched, didn't match, or appear twice right after import.</p>
        </section>
      )}
    </div>
  );
}
