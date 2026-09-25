import { ArrowDown, ArrowUp, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, CheckboxField, Input, Notice } from "@/components/ui/form";
import { WhyItMatters } from "@/components/ui/why";
import { codesFor, codesProblem, findNoncontiguous, findResponseSets, unionVariables } from "@/lib/importLogic";
import { useImportFlow } from "@/stores/importFlow";

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-3 rounded-lg border p-4">
      <h3 id={id} className="font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function StepCleanup() {
  const preview = useImportFlow((s) => s.preview);
  const d = useImportFlow((s) => s.decisions);
  const update = useImportFlow((s) => s.update);
  if (!preview || !d) return <Notice>Statly is still reading your files…</Notice>;

  const vars = unionVariables(preview.files);
  const metaCount = vars.filter((v) => v.is_metadata).length;
  const piiVars = vars.filter((v) => v.is_pii);
  const filters = preview.files.flatMap((f) => f.suggested_row_filters.map((flt) => ({ flt, file: f })));
  const multi = [...new Set(preview.files.flatMap((f) => f.multiselect_candidates))];
  const sets = findResponseSets(preview.files);
  const noncontig = findNoncontiguous(preview.files);
  const coded = vars.filter((v) => v.missing_codes.length > 0);
  const several = preview.files.length > 1;

  const toggleDrop = (name: string, drop: boolean) =>
    update({ dropColumns: drop ? [...d.dropColumns, name] : d.dropColumns.filter((c) => c !== name) });

  const move = (key: string, from: number, to: number) => {
    const order = [...(d.responseOrder[key] ?? [])];
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    update({ responseOrder: { ...d.responseOrder, [key]: order }, responseConfirmed: { ...d.responseConfirmed, [key]: false } });
  };

  const setCode = (key: string, k: number, i: number, raw: string) => {
    const codes = [...codesFor(d, key, k)];
    codes[i] = raw.trim() === "" ? Number.NaN : Number(raw);
    update({ responseCodes: { ...d.responseCodes, [key]: codes }, responseConfirmed: { ...d.responseConfirmed, [key]: false } });
  };

  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground">
        A few choices about what to keep. Statly picked safe defaults; check each one and change anything that doesn't fit your study.
      </p>
      <WhyItMatters>
        <p>
          Survey exports include extra columns and rows that aren't really answers: test runs you made while
          building the survey, spam, timing data, and details like IP addresses. Leaving them in can change your
          results or expose private information.
        </p>
        <p>Nothing here edits your original file. Every choice is written in your project's import log.</p>
      </WhyItMatters>

      {metaCount + piiVars.length + filters.length + multi.length + sets.length + noncontig.length + coded.length === 0 && (
        <Notice role="status">Nothing to clean up in this file. Continue to review your import.</Notice>
      )}

      {metaCount > 0 && (
        <Section id="sec-metadata" title="Survey system columns">
          <p className="text-sm text-muted-foreground">
            Qualtrics adds {plural(metaCount, "column")} such as start time, duration and click timing. They aren't
            answers to your questions. Statly keeps them, but you can hide them from the data table.
          </p>
          <CheckboxField
            label="Hide survey system columns in the data table (recommended)"
            checked={d.hideMetadata}
            onChange={(e) => update({ hideMetadata: e.target.checked })}
          />
        </Section>
      )}

      {piiVars.length > 0 && (
        <Section id="sec-pii" title="Personal information">
          <Notice tone="warn">
            <p className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                These columns can identify a person. Student privacy law (FERPA) and most research ethics boards
                (IRBs) expect you to remove identifying details you don't need. If you don't need a column for your
                analysis, remove it. The original file stays untouched on your computer.
              </span>
            </p>
          </Notice>
          <p className="text-sm text-muted-foreground">
            Keep a column only if you need it, for example an email address you'll use to match the same student across time points.
          </p>
          <ul className="grid gap-2" aria-label="Columns with personal information">
            {piiVars.map((v) => (
              <li key={v.name}>
                <CheckboxField
                  label={
                    <>
                      Remove <span className="font-mono">{v.name}</span>
                    </>
                  }
                  description={v.pii_reason?.explanation}
                  checked={d.dropColumns.includes(v.name)}
                  onChange={(e) => toggleDrop(v.name, e.target.checked)}
                />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {filters.length > 0 && (
        <Section id="sec-rows" title="Responses to leave out">
          <ul className="grid gap-3">
            {filters.map(({ flt, file }) => (
              <li key={flt.id}>
                <CheckboxField
                  label={
                    <>
                      {flt.kind === "exclude_values"
                        ? `Leave out ${(flt.values ?? []).map((x) => `"${x}"`).join(" and ")} responses`
                        : "Leave out unfinished responses"}{" "}
                      <Badge tone={flt.rows_removed ? "warn" : "neutral"}>
                        {plural(flt.rows_removed, "row")}
                        {several ? ` in ${file.name}` : ""}
                      </Badge>
                    </>
                  }
                  description={flt.explanation}
                  checked={!!d.enabledFilters[flt.id]}
                  onChange={(e) => update({ enabledFilters: { ...d.enabledFilters, [flt.id]: e.target.checked } })}
                />
              </li>
            ))}
            {vars.some((v) => v.name === "Progress") && (
              <li className="grid gap-2">
                <CheckboxField
                  label="Leave out responses that didn't get far enough into the survey"
                  description="Useful when some people quit partway. The number removed is shown after import."
                  checked={d.progressThreshold !== null}
                  onChange={(e) => update({ progressThreshold: e.target.checked ? 80 : null })}
                />
                {d.progressThreshold !== null && (
                  <div className="ml-6.5 flex items-center gap-2 text-sm">
                    <label htmlFor="progress-threshold">Keep only responses with progress of at least</label>
                    <Input
                      id="progress-threshold"
                      type="number"
                      min={1}
                      max={100}
                      className="w-20"
                      value={d.progressThreshold}
                      onChange={(e) => update({ progressThreshold: e.target.value === "" ? 0 : Number(e.target.value) })}
                    />
                    <span>%</span>
                  </div>
                )}
              </li>
            )}
          </ul>
        </Section>
      )}

      {multi.length > 0 && (
        <Section id="sec-multi" title={'"Select all that apply" questions'}>
          <p className="text-sm text-muted-foreground">
            In these questions people could pick more than one answer, so Qualtrics packed their choices into one
            cell, like "Textbook,Tutor". To count each choice, it helps to split them into yes/no columns, one per
            choice (1 = picked it, 0 = didn't). The original column is kept too.
          </p>
          {multi.map((c) => (
            <CheckboxField
              key={c}
              label={
                <>
                  Split <span className="font-mono">{c}</span> into yes/no columns
                </>
              }
              description={vars.find((v) => v.name === c)?.question_text ?? undefined}
              checked={!!d.multiselectSplit[c]}
              onChange={(e) => update({ multiselectSplit: { ...d.multiselectSplit, [c]: e.target.checked } })}
            />
          ))}
        </Section>
      )}

      {sets.map((s, si) => {
        const order = d.responseOrder[s.key] ?? s.labels;
        const codes = codesFor(d, s.key, order.length);
        const problem = codesProblem(codes);
        const listId = `rs-${si}`;
        return (
          <Section key={s.key} id={`sec-rs-${si}`} title="Check the order of the answer choices">
            <p className="text-sm text-muted-foreground">
              These questions were exported as words, not numbers:{" "}
              <span className="font-mono">{s.variables.join(", ")}</span>. Put the choices in order from lowest to
              highest. Statly numbers them 1 to {order.length} unless you type the codes your survey used (for
              example, Qualtrics recode values like 1, 2, 4, 5, 7).
            </p>
            <ol id={listId} className="grid gap-1.5" aria-label="Answer choices, lowest to highest">
              {order.map((label, i) => (
                <li key={label} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
                  <Input
                    type="number"
                    step={1}
                    className="h-7 w-16 font-mono tabular-nums"
                    aria-label={`Code for ${label}`}
                    value={Number.isNaN(codes[i]) ? "" : codes[i]}
                    onChange={(e) => setCode(s.key, order.length, i, e.target.value)}
                  />
                  <span className="flex-1">{label}</span>
                  <Button variant="ghost" size="icon-xs" aria-label={`Move ${label} up`} disabled={i === 0} onClick={() => move(s.key, i, i - 1)}>
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Move ${label} down`}
                    disabled={i === order.length - 1}
                    onClick={() => move(s.key, i, i + 1)}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                </li>
              ))}
            </ol>
            {problem && <Notice tone="warn">{problem}</Notice>}
            <CheckboxField
              label="This order and numbering are correct"
              checked={!!d.responseConfirmed[s.key]}
              onChange={(e) => update({ responseConfirmed: { ...d.responseConfirmed, [s.key]: e.target.checked } })}
            />
          </Section>
        );
      })}

      {noncontig.map((v) => (
        <Section key={v.variable} id={`sec-nc-${v.variable}`} title={`Unusual answer codes in ${v.variable}`}>
          <Notice tone="warn">
            <span className="font-mono">{v.variable}</span> uses the codes <strong>{v.codes.join(", ")}</strong>, not{" "}
            1 to {v.codes.length}. This happens when a question is edited in Qualtrics after it was created. If you
            average these numbers as they are, the gaps will stretch the scale and your means will be off.
          </Notice>
          <p className="text-sm text-muted-foreground">
            You can renumber them when you set up your variables. For now, confirm you've seen the codes.
          </p>
          <CheckboxField
            label={`I've checked the codes for ${v.variable}`}
            checked={!!d.noncontiguousAck[v.variable]}
            onChange={(e) => update({ noncontiguousAck: { ...d.noncontiguousAck, [v.variable]: e.target.checked } })}
          />
        </Section>
      ))}

      {coded.length > 0 && (
        <Section id="sec-missing" title="Missing-answer codes">
          <p className="text-sm text-muted-foreground">
            Some columns use a special number to mean "no answer". Statly will treat these as missing, not as real scores:
          </p>
          <ul className="grid gap-1 text-sm">
            {coded.map((v) => (
              <li key={v.name}>
                <span className="font-mono">{v.name}</span>: {v.missing_codes.join(", ")}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
