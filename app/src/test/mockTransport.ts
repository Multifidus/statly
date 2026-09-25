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
