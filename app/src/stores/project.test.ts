import { beforeEach, describe, expect, it } from "vitest";
import { MOCK_EXAMPLE_PROJECT_PATH } from "@/mocks/shapes";
import { useFreshMock, MESSY } from "@/test/mockTransport";
import { useDatasetStore } from "@/stores/dataset";
import { useImportFlow } from "@/stores/importFlow";
import { makeProject, projectNameFromPath, useProjectStore } from "@/stores/project";
import type { MockEngine } from "@/mocks/engine";

const DIR = "/mock/autosave";
let engine: MockEngine;

async function importMessy() {
  const flow = useImportFlow.getState();
  flow.addFiles([MESSY]);
  await useImportFlow.getState().runPreview();
  const d = useImportFlow.getState().decisions!;
  const ack = Object.fromEntries(Object.keys(d.noncontiguousAck).map((k) => [k, true]));
  useImportFlow.getState().update({ noncontiguousAck: { ...ack, Q6: true } });
  expect(await useImportFlow.getState().commit()).toBe(true);
}

beforeEach(() => {
  engine = useFreshMock();
});

describe("project store", () => {
  it("makeProject builds a schema-v1 ProjectFile with no data", () => {
    const p = makeProject("Thesis", "2026-01-01T00:00:00Z");
    expect(p).toMatchObject({ schema_version: 1, name: "Thesis", dataset_meta: null, data_path: null, test_log: [] });
    expect(p.project_id).toBeTruthy();
    expect(projectNameFromPath("/a/b/My study.statly")).toBe("My study");
  });

  it("marks dirty after import and clears it on save; save sends the dataset meta", async () => {
    useProjectStore.getState().newProject();
    await importMessy();
    expect(useProjectStore.getState().dirty).toBe(true);
    await useProjectStore.getState().saveTo("/mock/projects/Study.statly");
    const s = useProjectStore.getState();
    expect(s.dirty).toBe(false);
    expect(s.path).toBe("/mock/projects/Study.statly");
    expect(s.project?.name).toBe("Study");
    const saveCall = engine.calls.find((c) => c.method === "project.save")!;
    expect((saveCall.params as { project: { dataset_meta: unknown } }).project.dataset_meta).not.toBeNull();
  });

  it("open loads the project and puts its dataset in the dataset store", async () => {
    await useProjectStore.getState().open(MOCK_EXAMPLE_PROJECT_PATH);
    expect(useProjectStore.getState().path).toBe(MOCK_EXAMPLE_PROJECT_PATH);
    expect(useProjectStore.getState().dirty).toBe(false);
    expect(useDatasetStore.getState().meta?.n_rows).toBe(84);
  });

  it("autosaves only when dirty, then offers and recovers the autosave", async () => {
    useProjectStore.getState().newProject();
    await useProjectStore.getState().autosaveNow(DIR);
    expect(engine.calls.some((c) => c.method === "project.autosave")).toBe(false);

    await importMessy();
    await useProjectStore.getState().autosaveNow(DIR);
    expect(useProjectStore.getState().autosave.status).toBe("saved");

    // Simulate a relaunch.
    const projectId = useProjectStore.getState().project!.project_id;
    useProjectStore.getState().close();
    await useProjectStore.getState().loadRecoverable(DIR);
    const [item] = useProjectStore.getState().recoverable;
    expect(item.marker.project_id).toBe(projectId);
    expect(item.marker.original_path).toBeNull();

    await useProjectStore.getState().recover(item);
    const s = useProjectStore.getState();
    expect(s.recovered).toBe(true);
    expect(s.dirty).toBe(true);
    expect(s.recoverable).toHaveLength(0);
    expect(useDatasetStore.getState().meta).not.toBeNull();
  });

  it("saving deletes the project's autosave; discard removes one", async () => {
    engine = useFreshMock({ seedAutosave: true });
    await useProjectStore.getState().loadRecoverable(DIR);
    expect(useProjectStore.getState().recoverable).toHaveLength(1);
    await useProjectStore.getState().discardRecoverable(useProjectStore.getState().recoverable[0]);
    expect(useProjectStore.getState().recoverable).toHaveLength(0);
    await useProjectStore.getState().loadRecoverable(DIR);
    expect(useProjectStore.getState().recoverable).toHaveLength(0);
  });

  it("confirmUnsaved resolves immediately when clean and waits for an answer when dirty", async () => {
    useProjectStore.getState().newProject();
    await expect(useProjectStore.getState().confirmUnsaved("x")).resolves.toBe("discard");
    useProjectStore.getState().markDirty();
    const pending = useProjectStore.getState().confirmUnsaved("Close");
    expect(useProjectStore.getState().guard?.reason).toBe("Close");
    useProjectStore.getState().answerGuard("cancel");
    await expect(pending).resolves.toBe("cancel");
    expect(useProjectStore.getState().guard).toBeNull();
  });

  it("exposes undo/redo hooks as no-ops for Phase 2", () => {
    expect(useProjectStore.getState().canUndo()).toBe(false);
    expect(useProjectStore.getState().canRedo()).toBe(false);
  });
});
