import { invoke } from "@tauri-apps/api/core";

/** Mirrors `EngineError` in src-tauri/src/engine.rs (serde tag = "kind"). */
export type EngineError =
  | { kind: "spawn"; message: string }
  | { kind: "exited"; message: string }
  | { kind: "timeout"; method: string; seconds: number }
  | { kind: "rpc"; code: number; message: string; data?: unknown }
  | { kind: "protocol"; message: string }
  | { kind: "ipc"; message: string };

export interface EngineStatus {
  state: "not_started" | "running" | "exited" | "failed" | "stopped";
  source: "env" | "bundled" | "dev" | null;
  command: string | null;
  pid: number | null;
  spawn_count: number;
  last_error: string | null;
}

export interface PingResult {
  pong: true;
  engine_version: string;
  python_version: string;
  platform: string;
}

export interface EngineInfo {
  engine_version: string;
  python_version: string;
  platform: string;
  libraries: Record<string, string>;
}

function normalizeError(e: unknown): EngineError {
  if (e && typeof e === "object" && "kind" in e) return e as EngineError;
  return { kind: "ipc", message: typeof e === "string" ? e : String(e) };
}

/** Call a JSON-RPC method on the engine. Rejects with a normalized `EngineError`. */
export async function engineCall<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  try {
    return await invoke<T>("engine_call", { method, params });
  } catch (e) {
    throw normalizeError(e);
  }
}

export const ping = () => engineCall<PingResult>("ping");
export const engineInfo = () => engineCall<EngineInfo>("engine.info");
export const engineStatus = () => invoke<EngineStatus>("engine_status");

/** One-sentence, non-technical explanation for students. */
export function describeEngineError(e: EngineError): string {
  switch (e.kind) {
    case "timeout":
      return "The statistics engine is taking too long to start. This can happen the first time Statly runs on a slow or busy computer.";
    case "spawn":
      return "Statly couldn't find or start its statistics engine. Reinstalling Statly usually fixes this.";
    case "exited":
      return "The statistics engine stopped unexpectedly.";
    case "rpc":
    case "protocol":
      return "The statistics engine reported a problem while starting up.";
    case "ipc":
      return "Statly couldn't talk to its statistics engine.";
  }
}

export function technicalDetail(e: EngineError): string {
  switch (e.kind) {
    case "timeout":
      return `${e.method} timed out after ${e.seconds}s`;
    case "rpc":
      return `error ${e.code}: ${e.message}`;
    default:
      return e.message;
  }
}
