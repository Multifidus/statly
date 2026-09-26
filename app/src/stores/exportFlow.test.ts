import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockEngine } from "@/mocks/engine";
import { MOCK_TEST_LOG_PROJECT_PATH } from "@/mocks/shapes";
import { useFreshMock } from "@/test/mockTransport";
import { useExportFlow } from "@/stores/exportFlow";
import { useProjectStore } from "@/stores/project";
import { useResults } from "@/stores/results";

// The dialog and chart renderer both need a real OS/DOM (native save dialog, vega-embed+canvas)
// that jsdom doesn't provide; stub them so the store's own selection/param-building logic is what's
// under test, matching how the rest of the app keeps dialog/render calls behind small seams.
vi.mock("@/lib/dialogs", () => ({ pickExportPath: vi.fn(async (name: string, fmt: string) => `/mock/exports/${name}.${fmt}`) }));
vi.mock("@/lib/export/figure", () => ({ chartPngDataUrl: vi.fn(async () => "data:image/png;base64,AAA=") }));

let engine: MockEngine;

beforeEach(async () => {
  engine = useFreshMock();
  useResults.getState().clear();
  useExportFlow.getState().reset();
  await useProjectStore.getState().open(MOCK_TEST_LOG_PROJECT_PATH);
});

describe("useExportFlow", () => {
  it("show() seeds the title from the project name and resets prior state", () => {
    useExportFlow.setState({ error: "stale", savedPath: "/old.docx" });
    useExportFlow.getState().show();
    const s = useExportFlow.getState();
    expect(s.open).toBe(true);
    expect(s.title).toBe("Attitude items");
    expect(s.error).toBeNull();
    expect(s.savedPath).toBeNull();
  });

  it("toggleSelected / selectAll / clearSelection manage the checkbox set", () => {
    const f = useExportFlow.getState();
    f.toggleSelected("req_item1");
    f.toggleSelected("req_item2");
    expect(useExportFlow.getState().selectedIds).toEqual(["req_item1", "req_item2"]);
    f.toggleSelected("req_item1");
    expect(useExportFlow.getState().selectedIds).toEqual(["req_item2"]);
    f.selectAll(["req_item1", "req_item2", "req_scale"]);
    expect(useExportFlow.getState().selectedIds).toEqual(["req_item1", "req_item2", "req_scale"]);
    f.clearSelection();
    expect(useExportFlow.getState().selectedIds).toEqual([]);
  });

  it("refuses to run with nothing selected", async () => {
    await useExportFlow.getState().run();
    expect(useExportFlow.getState().error).toMatch(/choose at least one/i);
    expect(engine.calls.some((c) => c.method === "export.report")).toBe(false);
  });

  it("run() reopens each selected result and sends test_log + test_families for adjusted-p display", async () => {
    // Give req_item1/req_item2 a Holm family, like a user would from the Test Log screen (SPEC §9).
    useProjectStore.getState().updateProject((p) => ({
      ...p,
      test_families: [{ id: "fam_1", name: "Attitude items" }],
      test_log: p.test_log.map((e) =>
        ["req_item1", "req_item2"].includes(e.id) ? { ...e, family_id: "fam_1", correction_method: "holm" as const, adjusted_p: 0.048 } : e,
      ),
    }));
    const f = useExportFlow.getState();
    f.setTitle("Family Report");
    f.setInclude("charts", false);
    f.selectAll(["req_item1", "req_item2"]);
    await f.run();

    const call = engine.calls.find((c) => c.method === "export.report");
    expect(call).toBeDefined();
    const params = call!.params as {
      title: string; path: string; format: string; results: { analysis_id: string }[];
      test_log: { id: string; adjusted_p: number | null }[]; test_families: { id: string; name: string }[]; charts: unknown[];
    };
    expect(params.title).toBe("Family Report");
    expect(params.path).toBe("/mock/exports/Family Report.docx");
    expect(params.results).toHaveLength(2);
    expect(params.test_log.map((e) => e.id).sort()).toEqual(["req_item1", "req_item2"]);
    expect(params.test_log.every((e) => e.adjusted_p === 0.048)).toBe(true);
    expect(params.test_families).toEqual([{ id: "fam_1", name: "Attitude items" }]);
    expect(params.charts).toEqual([]); // include.charts was turned off
    expect(useExportFlow.getState().status).toBe("done");
    expect(useExportFlow.getState().savedPath).toBe("/mock/exports/Family Report.docx");
  });

  it("on file_exists, offers a replace confirmation instead of failing, then retries with overwrite", async () => {
    useProjectStore.setState((s) => ({ project: s.project }));
    // Pre-seed a saved path via the mock dialog is not needed: the engine's mock always succeeds,
    // so simulate the refusal directly by making the first export.report call throw file_exists.
    const original = engine.call.bind(engine);
    let calls = 0;
    engine.call = (async (method: string, params: object) => {
      if (method === "export.report") {
        calls++;
        if (calls === 1) {
          const err = { kind: "rpc", code: -32003, message: "exists", data: { reason: "file_exists" } };
          throw err;
        }
      }
      return original(method, params);
    }) as typeof engine.call;

    const f = useExportFlow.getState();
    f.setInclude("charts", false);
    f.selectAll(["req_item1"]);
    await f.run();
    expect(useExportFlow.getState().confirmOverwritePath).toBe("/mock/exports/Report.docx");
    expect(useExportFlow.getState().status).toBe("idle");

    await useExportFlow.getState().confirmReplace();
    expect(useExportFlow.getState().status).toBe("done");
    expect(useExportFlow.getState().confirmOverwritePath).toBeNull();
    expect(calls).toBe(2);
  });
});
