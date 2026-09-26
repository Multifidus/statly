import { useState } from "react";
import { ChevronRight, Layers, Lightbulb, Pencil, Plus, Unlink, Wand2 } from "lucide-react";
import type { CorrectionMethod, TestLogEntry } from "@/contracts";
import { Button } from "@/components/ui/button";
import { Badge, NativeSelect, Notice } from "@/components/ui/form";
import { WhyItMatters } from "@/components/ui/why";
import { RichText } from "@/components/results/RichText";
import { FalsePositiveExplainer } from "@/components/testlog/FalsePositiveExplainer";
import { FamilyDialog, type FamilyDraft } from "@/components/testlog/FamilyDialog";
import { fmtPExpr } from "@/lib/apa";
import { adjustedLabel, eligibility, familyMembers, familyMethod, METHOD_INFO, METHOD_ORDER, suggestFamilies } from "@/lib/testFamilies";
import { useNav } from "@/stores/nav";
import { useProjectStore } from "@/stores/project";
import { useResults } from "@/stores/results";
import { useTestLog } from "@/stores/testLog";

const fmt = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

function PValues({ entry }: { entry: TestLogEntry }) {
  const label = adjustedLabel(entry.correction_method);
  if (entry.result_summary.p === null) return null;
  return (
    <>
      {" · "}
      <i>p</i> {fmtPExpr(entry.result_summary.p)}
      {label && entry.adjusted_p !== null && (
        <span className="font-medium text-foreground" data-testid={`adjusted-p-${entry.id}`}>
          {" · "}
          {label} <i>p</i> {fmtPExpr(entry.adjusted_p)}
        </span>
      )}
    </>
  );
}

/**
 * The project's Test Log (SPEC §9): every analysis run, newest first, reopenable; related tests can
 * be grouped into families and corrected for multiple comparisons, always by the user's choice.
 */
export function AnalysesScreen() {
  const log = useProjectStore((s) => s.project?.test_log ?? []);
  const families = useProjectStore((s) => s.project?.test_families ?? []);
  const dismissed = useTestLog((s) => s.dismissed);
  const busy = useTestLog((s) => s.busy);
  const error = useTestLog((s) => s.error);
  const go = useNav((s) => s.go);
  const [draft, setDraft] = useState<FamilyDraft | null>(null);
  const open = (id: string) => {
    useResults.getState().show(id);
    go("results");
  };
  const entries = [...log].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const suggestions = suggestFamilies(log, dismissed);
  const familyName = (id: string | null) => families.find((f) => f.id === id)?.name;
  const hasPosthoc = log.some((e) => e.request.analysis_id.startsWith("posthoc."));
  const groupable = log.filter((e) => e.family_id === null && eligibility(e).ok).length >= 2;
  const changeMethod = (id: string, m: CorrectionMethod) => void useTestLog.getState().setMethod(id, m);

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4" data-testid="analyses-screen">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Test Log</h1>
          <p className="text-muted-foreground">Every test you run is kept here, with its inputs and results, and saved with the project.</p>
        </div>
        {groupable && (
          <Button variant="outline" onClick={() => setDraft({ name: "", memberIds: [], method: null })} data-testid="new-family">
            <Plus aria-hidden /> Group tests
          </Button>
        )}
        <Button onClick={() => go("advisor")} data-testid="new-analysis">
          <Wand2 aria-hidden /> New analysis
        </Button>
      </div>

      {log.length >= 2 && (
        <WhyItMatters title="Running several tests? Why grouping them matters">
          <FalsePositiveExplainer />
          {hasPosthoc && (
            <p data-testid="posthoc-note">
              Post hoc tests (the pairwise comparisons after an ANOVA-type test) are not added to families: each one already applies its own
              correction across the pairs it compares, as explained on its results page.
            </p>
          )}
        </WhyItMatters>
      )}

      {suggestions.length > 0 && (
        <section aria-label="Suggested families" className="grid gap-2" data-testid="family-suggestions">
          {suggestions.map((s) => (
            <Notice key={s.key} tone="info" className="flex flex-wrap items-center gap-3" data-testid="family-suggestion">
              <Lightbulb className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                {s.message} Tests like these are often treated as one family and corrected together. Want to group them?
              </span>
              <span className="flex gap-2">
                <Button size="sm" onClick={() => setDraft({ name: s.suggestedName, memberIds: s.memberIds, method: null })} data-testid="suggestion-group">
                  Group these…
                </Button>
                <Button size="sm" variant="ghost" onClick={() => useTestLog.getState().dismiss(s.key)} data-testid="suggestion-dismiss">
                  Not now
                </Button>
              </span>
            </Notice>
          ))}
        </section>
      )}

      {families.length > 0 && (
        <section aria-labelledby="families-h" className="grid gap-3" data-testid="families">
          <h2 id="families-h" className="text-lg font-semibold">
            Test families
          </h2>
          {error && <Notice tone="error">{error}</Notice>}
          {families.map((f) => {
            const members = familyMembers(log, f.id);
            const method = familyMethod(log, f.id);
            return (
              <div key={f.id} className="grid gap-3 rounded-xl border p-4" data-testid={`family-${f.id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Layers className="size-4 text-muted-foreground" aria-hidden />
                  <h3 className="flex-1 font-medium">{f.name}</h3>
                  <label className="flex items-center gap-2 text-sm">
                    Correction
                    <NativeSelect
                      className="w-auto"
                      value={method}
                      disabled={busy}
                      onChange={(e) => changeMethod(f.id, e.target.value as CorrectionMethod)}
                      data-testid={`family-method-${f.id}`}
                    >
                      {method === "none" && <option value="none">Choose…</option>}
                      {METHOD_ORDER.map((m) => (
                        <option key={m} value={m}>
                          {METHOD_INFO[m].label}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDraft({ id: f.id, name: f.name, memberIds: members.map((m) => m.id), method })}
                    data-testid={`family-edit-${f.id}`}
                  >
                    <Pencil aria-hidden /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => useTestLog.getState().ungroup(f.id)} data-testid={`family-ungroup-${f.id}`}>
                    <Unlink aria-hidden /> Ungroup
                  </Button>
                </div>
                {method !== "none" && <p className="text-sm text-muted-foreground">{METHOD_INFO[method as Exclude<CorrectionMethod, "none">].what}</p>}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-1 font-normal">Test</th>
                      <th className="py-1 text-right font-normal">
                        Original <i>p</i>
                      </th>
                      <th className="py-1 text-right font-normal">{adjustedLabel(method) ?? "Adjusted"} <i>p</i></th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.id} className="border-b last:border-0" data-testid={`family-row-${m.id}`}>
                        <td className="py-1">
                          {m.result_summary.analysis_label}
                          <span className="text-muted-foreground"> · {m.result_summary.outcome_variables.join(", ")}</span>
                        </td>
                        <td className="py-1 text-right tabular-nums">{fmtPExpr(m.result_summary.p).replace(/^= /, "")}</td>
                        <td className="py-1 text-right font-medium tabular-nums">
                          {m.adjusted_p === null ? "—" : fmtPExpr(m.adjusted_p).replace(/^= /, "")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </section>
      )}

      {entries.length === 0 ? (
        <p className="rounded-md border p-4 text-sm text-muted-foreground">No analyses yet. The Test Advisor will help you choose one.</p>
      ) : (
        <ul className="grid gap-2" aria-label="Test Log" data-testid="test-log">
          {entries.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => open(e.id)}
                data-testid={`log-entry-${e.id}`}
                className="flex w-full items-start gap-3 rounded-md border p-3 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="font-medium">
                    {e.result_summary.analysis_label}
                    <span className="font-normal text-muted-foreground"> · {e.result_summary.outcome_variables.join(", ")}</span>
                    {e.family_id && (
                      <Badge tone="info" className="ml-2 align-middle">
                        <Layers className="size-3" aria-hidden /> {familyName(e.family_id) ?? "Family"}
                      </Badge>
                    )}
                  </span>
                  <span className="truncate font-serif text-sm">
                    <RichText runs={e.result_summary.apa_sentence} />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {fmt(e.timestamp)} · n = {e.result_summary.n_used}
                    <PValues entry={e} />
                  </span>
                </span>
                <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <FamilyDialog draft={draft} onClose={() => setDraft(null)} />
    </div>
  );
}
