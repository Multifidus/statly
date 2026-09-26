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

// Plain-language descriptions for an `EngineError` live in `@/lib/errors` (`describeError`),
// the single mapper every user-facing error goes through. `EngineStartup.tsx` uses it directly.
