import { useEffect, useState } from "react";
import type { CorrectionMethod } from "@/contracts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CheckboxField, Input, Notice } from "@/components/ui/form";
import { WhyItMatters } from "@/components/ui/why";
import { FalsePositiveExplainer } from "@/components/testlog/FalsePositiveExplainer";
import { MethodChooser } from "@/components/testlog/MethodChooser";
import { fmtPExpr } from "@/lib/apa";
import { eligibility } from "@/lib/testFamilies";
import { useProjectStore } from "@/stores/project";
import { useTestLog } from "@/stores/testLog";

export interface FamilyDraft {
  /** Existing family being edited; undefined = new family. */
  id?: string;
  name: string;
  memberIds: string[];
  method: CorrectionMethod | null;
}

/** Name a family, pick its tests and choose a correction (SPEC §9). */
export function FamilyDialog({ draft, onClose }: { draft: FamilyDraft | null; onClose: () => void }) {
  const log = useProjectStore((s) => s.project?.test_log ?? []);
  const families = useProjectStore((s) => s.project?.test_families ?? []);
  const busy = useTestLog((s) => s.busy);
  const error = useTestLog((s) => s.error);
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [method, setMethod] = useState<CorrectionMethod | null>(null);

  useEffect(() => {
    if (!draft) return;
    setName(draft.name);
    setMembers(draft.memberIds);
    setMethod(draft.method);
    useTestLog.setState({ error: null });
  }, [draft]);

  const entries = [...log].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const ready = name.trim() !== "" && members.length >= 2 && method !== null && method !== "none";
  const save = async () => {
    if (!ready || !draft) return;
    const id = await useTestLog.getState().saveFamily({ name, memberIds: members, method: method! }, draft.id);
    if (id) onClose();
  };

  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" aria-describedby="family-dialog-desc" data-testid="family-dialog">
        <DialogTitle>{draft?.id ? "Edit test family" : "Group tests into a family"}</DialogTitle>
        <DialogDescription id="family-dialog-desc">
          A family is a set of related tests you correct together, for example the same outcome across several items.
        </DialogDescription>

        <WhyItMatters title="Why correct for several tests?">
          <FalsePositiveExplainer k={members.length} />
        </WhyItMatters>

        <label className="grid gap-1.5 text-sm font-medium">
          Family name
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Attitude items" data-testid="family-name" />
        </label>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-semibold">Tests in this family</legend>
          {entries.map((e) => {
            const elig = eligibility(e);
            const other = e.family_id && e.family_id !== draft?.id ? families.find((f) => f.id === e.family_id) : undefined;
            const disabled = !elig.ok || !!other;
            return (
              <CheckboxField
                key={e.id}
                data-testid={`family-member-${e.id}`}
                disabled={disabled}
                checked={members.includes(e.id)}
                onChange={(ev) => setMembers(ev.target.checked ? [...members, e.id] : members.filter((m) => m !== e.id))}
                label={
                  <>
                    {e.result_summary.analysis_label}
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      · {e.result_summary.outcome_variables.join(", ")}
                      {e.result_summary.p !== null && (
                        <>
                          {" "}
                          · <i>p</i> {fmtPExpr(e.result_summary.p)}
                        </>
                      )}
                    </span>
                  </>
                }
                description={!elig.ok ? elig.reason : other ? `Already in the family “${other.name}”.` : undefined}
              />
            );
          })}
        </fieldset>

        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">Correction method</h3>
          <MethodChooser value={method} onChange={setMethod} idPrefix="family-dialog" />
        </div>

        {error && <Notice tone="error">{error}</Notice>}
        {!ready && (
          <p className="text-sm text-muted-foreground" data-testid="family-dialog-hint">
            {members.length < 2 ? "Choose at least two tests." : !name.trim() ? "Give the family a name." : "Choose a correction method."}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!ready || busy} data-testid="family-save">
            {draft?.id ? "Save changes" : "Create family"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
