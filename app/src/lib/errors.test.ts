import { describe, expect, it } from "vitest";
import { DescribedException, describeError, RpcErrorCode } from "@/lib/errors";

describe("describeError", () => {
  it.each([
    [
      "RPC: FileUnreadable",
      { kind: "rpc", code: RpcErrorCode.FileUnreadable, message: "boom" },
      /couldn't read that file/i,
      /csv or excel/i,
    ],
    [
      "RPC: StaleOrUnknown",
      { kind: "rpc", code: RpcErrorCode.StaleOrUnknown, message: "boom" },
      /your data changed/i,
      /try that step again/i,
    ],
    [
      "RPC: InvalidParams",
      { kind: "rpc", code: RpcErrorCode.InvalidParams, message: "boom" },
      /something didn't match up/i,
      /didn't expect/i,
    ],
    [
      "RPC: ProjectIncompatible",
      { kind: "rpc", code: RpcErrorCode.ProjectIncompatible, message: "boom" },
      /newer statly/i,
      /newer version of statly/i,
    ],
    [
      "RPC: unknown code",
      { kind: "rpc", code: -32099, message: "boom" },
      /engine reported a problem/i,
      /ran into a problem/i,
    ],
    [
      "Transport: timeout",
      { kind: "timeout", method: "ping", seconds: 30 },
      /took too long/i,
      /too long to respond/i,
    ],
    [
      "Transport: spawn failure",
      { kind: "spawn", message: "no such executable" },
      /couldn't start the engine/i,
      /reinstalling statly/i,
    ],
    [
      "Transport: exited",
      { kind: "exited", message: "process exited" },
      /engine stopped/i,
      /stopped unexpectedly/i,
    ],
    [
      "Transport: protocol",
      { kind: "protocol", message: "bad frame" },
      /unexpected response/i,
      /didn't understand/i,
    ],
    [
      "Transport: ipc",
      { kind: "ipc", message: "pipe closed" },
      /couldn't reach the engine/i,
      /couldn't talk to its statistics engine/i,
    ],
    [
      "File system: permission denied",
      new Error("Error: Permission denied (os error 13)"),
      /permission denied/i,
      /doesn't have permission/i,
    ],
    [
      "File system: disk full",
      new Error("write failed: No space left on device (os error 28)"),
      /not enough disk space/i,
      /free up some space/i,
    ],
    [
      "File system: not found",
      new Error("open failed: No such file or directory (os error 2)"),
      /location not found/i,
      /doesn't exist any more/i,
    ],
    [
      "File system: read-only",
      new Error("failed: Read-only file system (os error 30)"),
      /can't save there/i,
      /read-only/i,
    ],
    [
      "Unknown: plain Error",
      new Error("TypeError: x.map is not a function"),
      /something went wrong/i,
      /please try again/i,
    ],
    [
      "Unknown: thrown string",
      "some raw thrown string",
      /something went wrong/i,
      /please try again/i,
    ],
    [
      "Unknown: undefined",
      undefined,
      /something went wrong/i,
      /please try again/i,
    ],
  ] as const)("%s -> title/body", (_label, input, titlePattern, bodyPattern) => {
    const d = describeError(input);
    expect(d.title).toMatch(titlePattern);
    expect(d.body).toMatch(bodyPattern);
    expect(d.details.length).toBeGreaterThan(0);
  });

  it("passes through a DescribedException unchanged (already user-facing)", () => {
    const described = { title: "Chart not ready", body: "Wait a moment and try again.", details: "view is null" };
    const e = new DescribedException(described);
    expect(describeError(e)).toEqual(described);
  });

  it("never drops the technical detail, even for a generic fallback", () => {
    const e = new Error("something very specific broke");
    expect(describeError(e).details).toMatch(/something very specific broke/);
  });
});
