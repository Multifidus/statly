import { afterEach, describe, expect, it, vi } from "vitest";
import { describeRpcError, rpc, RpcErrorCode, setTransport, tauriTransport, type Transport } from "@/lib/rpc";

function spyTransport(result: unknown = { ok: true }) {
  const call = vi.fn(async () => result);
  const t: Transport = { call: call as Transport["call"] };
  setTransport(t);
  return call;
}

afterEach(() => setTransport(tauriTransport));

describe("rpc wrappers", () => {
  it.each([
    ["importPreview", "dataset.import_preview"],
    ["importDataset", "dataset.import"],
    ["stack", "dataset.stack"],
    ["link", "dataset.link"],
    ["rows", "dataset.rows"],
    ["missingSummary", "dataset.missing_summary"],
    ["saveProject", "project.save"],
    ["loadProject", "project.load"],
    ["autosave", "project.autosave"],
    ["recoverable", "project.recoverable"],
    ["discardAutosave", "project.discard_autosave"],
  ] as const)("%s calls %s with its params unchanged", async (fn, method) => {
    const call = spyTransport({ ok: true });
    const params = { marker: fn };
    const res = await (rpc[fn] as (p: unknown) => Promise<unknown>)(params);
    expect(call).toHaveBeenCalledWith(method, params);
    expect(res).toEqual({ ok: true });
  });

  it("ping and engine.info send empty params", async () => {
    const call = spyTransport({ pong: true });
    await rpc.ping();
    await rpc.engineInfo();
    expect(call.mock.calls).toEqual([
      ["ping", {}],
      ["engine.info", {}],
    ]);
  });

  it("propagates transport errors", async () => {
    const err = { kind: "rpc", code: RpcErrorCode.FileUnreadable, message: "nope" };
    setTransport({ call: async () => Promise.reject(err) });
    await expect(rpc.rows({ dataset_id: "d", snapshot_id: null, offset: 0, limit: 10, columns: null, sort: null })).rejects.toBe(err);
  });
});

describe("describeRpcError", () => {
  it("maps Phase 1 error codes to plain language", () => {
    expect(describeRpcError({ kind: "rpc", code: -32001, message: "" })).toMatch(/couldn't read that file/);
    expect(describeRpcError({ kind: "rpc", code: -32002, message: "" })).toMatch(/changed/);
    expect(describeRpcError({ kind: "rpc", code: -32004, message: "" })).toMatch(/newer version/);
    expect(describeRpcError({ kind: "timeout", method: "x", seconds: 1 })).toMatch(/too long/);
    expect(describeRpcError(new Error("x"))).toMatch(/Something went wrong/);
  });
});
