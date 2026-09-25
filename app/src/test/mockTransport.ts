import { MockEngine } from "@/mocks/engine";
import { setTransport } from "@/lib/rpc";
import { useDatasetStore } from "@/stores/dataset";
import { useImportFlow } from "@/stores/importFlow";
import { useProjectStore } from "@/stores/project";

export const MESSY = "/mock/fixtures/messy_qualtrics/messy_3header.csv";
export const MESSY_TEXT = "/mock/fixtures/messy_qualtrics/messy_text_choices.csv";
export const THREE = ["pre", "post", "followup"].map((t) => `/mock/fixtures/three_groups_prepost_followup/${t}.csv`);
export const LINKED = ["pre", "post"].map((t) => `/mock/fixtures/linked_id_prepost/${t}.csv`);

/** Fresh zero-latency MockEngine as the RPC transport, and reset stores. */
export function useFreshMock(opts: { seedAutosave?: boolean } = {}): MockEngine {
  const engine = new MockEngine({ latencyMs: 0, ...opts });
  setTransport(engine);
  useImportFlow.getState().reset();
  useDatasetStore.getState().clear();
  useProjectStore.setState({ project: null, path: null, dirty: false, recovered: false, recoverable: [], guard: null });
  return engine;
}

export const ONE_GROUP = ["pre", "post"].map((t) => `/mock/fixtures/one_group_prepost_likert/${t}.csv`);

/** Import the mock one-group pre/post Likert files (aggregate) and score the Q3 matrix as a scale. */
export async function importMockOneGroup(): Promise<import("@/contracts").DatasetMeta> {
  const { findNoncontiguous, findResponseSets } = await import("@/lib/importLogic");
  const { rpc } = await import("@/lib/rpc");
  useProjectStore.getState().newProject("Mock analysis");
  const s = useImportFlow.getState();
  s.addFiles(ONE_GROUP);
  if (!(await s.runPreview())) throw new Error(useImportFlow.getState().error ?? "preview failed");
  const { preview, update } = useImportFlow.getState();
  update({
    responseConfirmed: Object.fromEntries(findResponseSets(preview!.files).map((x) => [x.key, true])),
    noncontiguousAck: Object.fromEntries(findNoncontiguous(preview!.files).map((v) => [v.variable, true])),
  });
  if (!(await useImportFlow.getState().commit())) throw new Error(useImportFlow.getState().error ?? "import failed");
  const meta = useDatasetStore.getState().meta!;
  const items = Array.from({ length: 10 }, (_, i) => `Q3_${i + 1}`);
  const res = await rpc.upsertScale({ dataset_id: meta.dataset_id, scale: { name: "Reading attitude", items, scoring_method: "mean" } });
  useDatasetStore.getState().setMeta(res.dataset_meta);
  return res.dataset_meta;
}
