import { beforeEach, describe, expect, it } from "vitest";
import { edits, EditError, redoEdit, undoEdit } from "@/lib/variableEdits";
import type { MockEngine } from "@/mocks/engine";
import { MESSY, useFreshMock } from "@/test/mockTransport";
import { useDatasetStore } from "@/stores/dataset";
import { useHistory } from "@/stores/history";
import { useImportFlow } from "@/stores/importFlow";
import { useInterview } from "@/stores/interview";
import { useProjectStore } from "@/stores/project";

let engine: MockEngine;

async function importMessy() {
  useProjectStore.getState().newProject();
  const flow = useImportFlow.getState();
  flow.addFiles([MESSY]);
  await useImportFlow.getState().runPreview();
  const d = useImportFlow.getState().decisions!;
  const ack = Object.fromEntries(Object.keys(d.noncontiguousAck).map((k) => [k, true]));
  useImportFlow.getState().update({ noncontiguousAck: { ...ack, Q6: true } });
  expect(await useImportFlow.getState().commit()).toBe(true);
  await useHistory.getState().refresh();
}

const meta = () => useDatasetStore.getState().meta!;
const variable = (name: string) => meta().variables.find((v) => v.name === name)!;

beforeEach(() => {
  engine = useFreshMock();
  useInterview.getState().reset();
  useHistory.getState().reset();
});

describe("history store (undo/redo pointer)", () => {
  it("tracks edits and moves through them with restore_snapshot", async () => {
    await importMessy();
    expect(useHistory.getState().entries).toHaveLength(1);
    expect(useProjectStore.getState().canUndo()).toBe(false);
    const label0 = variable("Q1").label;

    await edits.updateVariables([{ name: "Q1", role: "group" }]);
    await edits.updateVariables([{ name: "Q1", label: "Consent" }]);
    const h = useHistory.getState();
    expect(h.entries.map((e) => e.label)).toEqual(["Imported data", "Changed role of Q1", "Changed label of Q1"]);
    expect(h.cursor).toBe(2);
    expect(h.undoLabel()).toBe("Changed label of Q1");
    expect(useProjectStore.getState().dirty).toBe(true);

    expect(await undoEdit()).toBe(true);
    expect(variable("Q1").label).toBe(label0);
    expect(variable("Q1").role).toBe("group");
    expect(await useProjectStore.getState().undo()).toBe(true);
    expect(variable("Q1").role).not.toBe("group");
    expect(useProjectStore.getState().canUndo()).toBe(false);
    expect(await undoEdit()).toBe(false);

    expect(await redoEdit()).toBe(true);
    expect(variable("Q1").role).toBe("group");
    expect(engine.calls.filter((c) => c.method === "dataset.restore_snapshot")).toHaveLength(3);

    // A new edit after undo drops the redo tail.
    await edits.updateVariables([{ name: "Q1", role: "demographic" }]);
    expect(useHistory.getState().entries.map((e) => e.label)).toEqual(["Imported data", "Changed role of Q1", "Changed role of Q1"]);
    expect(useProjectStore.getState().canRedo()).toBe(false);
  });

  it("reports engine errors as EditError with a plain message", async () => {
    await importMessy();
    await expect(
      edits.addComputed({
        name: "gain",
        definition: { op: "difference", minuend: { variable: "SC0", time_level: "Post" }, subtrahend: { variable: "SC0", time_level: "Pre" } },
      }),
    ).rejects.toThrow(EditError);
  });
});

describe("interview store", () => {
  it("walks the steps with pre-filled answers and applies them as undoable edits", async () => {
    await importMessy();
    await useInterview.getState().start();
    const s = useInterview.getState();
    expect(s.status).toBe("ready");
    expect(s.step).toBe("intro");
    const steps = s.steps();
    expect(steps[0]).toBe("intro");
    expect(steps[steps.length - 1]).toBe("summary");
    expect(steps).toContain("scales");
    expect(s.units.find((u) => u.id === "scale:scale_Q5")?.names).toEqual(["Q5_1", "Q5_2", "Q5_3", "Q5_4", "Q5_5", "Q5_6"]);

    // Changing a role re-derives the level and changes the later steps.
    const q1 = s.units.find((u) => u.names.includes("Q1"))!;
    s.setAnswer(q1.id, { role: "ignore" });
    expect(useInterview.getState().steps()).not.toContain(`level:${q1.id}`);
    s.setAnswer(q1.id, { role: "group" });
    expect(useInterview.getState().draft!.answers[q1.id].level).toBe("nominal");

    s.setDraft({ reverse: { Q5_4: true } });
    let n = 0;
    while (useInterview.getState().step !== "summary" && n++ < 100) {
      expect(useInterview.getState().problem()).toBeNull();
      useInterview.getState().next();
    }
    useInterview.getState().back();
    expect(useInterview.getState().step).not.toBe("summary");
    useInterview.getState().goTo("summary");

    expect(await useInterview.getState().finish()).toBe(true);
    expect(useInterview.getState().status).toBe("done");
    const scale = meta().scales.find((x) => x.id === "scale_Q5")!;
    expect(scale.score_variable).toBeTruthy();
    expect(scale.min_items).toBe(3);
    expect(variable("Q5_4").reverse_coded).toBe(true);
    expect(variable("Q1").role).toBe("group");
    const labels = useHistory.getState().entries.map((e) => e.label);
    expect(labels[0]).toBe("Imported data");
    expect(labels).toContain("Variable interview answers");

    // Each applied part is one undo step.
    expect(await undoEdit()).toBe(true);
    expect(meta().variables.some((v) => v.name === scale.score_variable)).toBe(false);
  });
});
