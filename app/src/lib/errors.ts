/**
 * Single place that turns any error a Statly user might see into plain language (grade 8-10)
 * with a next step. Covers: RPC error codes from the engine (docs/PROTOCOL.md), transport
 * failures (sidecar not running / crashed / timed out, mirrors `EngineError` in
 * src-tauri/src/engine.rs), file-system errors surfaced as plain strings by Tauri's fs/dialog
 * plugins, and anything unrecognized. The raw technical detail is always returned in `details`
 * so it's never silently lost, even when the user-facing text is generic.
 */

/** Phase 1 application error codes (contracts/README.md). */
export const RpcErrorCode = {
  FileUnreadable: -32001,
  StaleOrUnknown: -32002,
  InvalidParams: -32003,
  ProjectIncompatible: -32004,
} as const;

export interface DescribedError {
  /** Short label for a heading (a card title, an alert title). */
  title: string;
  /** One or two plain-language sentences: what happened, and what to do next. */
  body: string;
  /** Optional extra nudge shown as a smaller hint under `body`. */
  hint?: string;
  /** Raw technical detail (error code, message, stack) for a collapsed "Details" disclosure. */
  details: string;
}

/** A pre-built, already user-facing error: `describeError` returns `described` unchanged.
 * Lets call sites (e.g. `EditError`) hand back a specific, plain-language error without the
 * generic fallback swallowing a message we already know is good. */
export class DescribedException extends Error {
  described: DescribedError;
  constructor(described: DescribedError) {
    super(described.body);
    this.name = "DescribedException";
    this.described = described;
  }
}

interface EngineErrorLike {
  kind?: unknown;
  code?: unknown;
  message?: unknown;
  method?: unknown;
  seconds?: unknown;
}

function isEngineErrorLike(e: unknown): e is EngineErrorLike {
  return !!e && typeof e === "object" && "kind" in e;
}

function isDescribedException(e: unknown): e is { described: DescribedError } {
  return !!e && typeof e === "object" && "described" in e && !!(e as { described?: unknown }).described;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function rpcTechnicalDetail(e: EngineErrorLike): string {
  if (e.kind === "timeout") return `${str(e.method, "request")} timed out after ${str(e.seconds as unknown as string, String(e.seconds ?? "?"))}s`;
  if (e.kind === "rpc") return `error ${String(e.code)}: ${str(e.message)}`;
  return str(e.message) || `kind: ${String(e.kind)}`;
}

/** Phase 1 RPC codes -> plain-language title/body (docs/PROTOCOL.md). */
const RPC_MESSAGES: Record<number, { title: string; body: string }> = {
  [RpcErrorCode.FileUnreadable]: {
    title: "Couldn't read that file",
    body: "Statly couldn't read that file. Check that it is a CSV or Excel (.xlsx) file and that it isn't open in another program.",
  },
  [RpcErrorCode.StaleOrUnknown]: {
    title: "Your data changed",
    body: "Your data changed while this was loading. Please try that step again.",
  },
  [RpcErrorCode.InvalidParams]: {
    title: "Something didn't match up",
    body: "Statly sent the engine something it didn't expect. Please try again, and report this if it keeps happening.",
  },
  [RpcErrorCode.ProjectIncompatible]: {
    title: "This project needs a newer Statly",
    body: "This project was saved by a newer version of Statly. Update Statly to open it.",
  },
};

/** Plain-text patterns for file-system errors that reach the UI as bare strings (Tauri's
 * fs/dialog plugins reject with an OS message, not a structured error). Order matters: more
 * specific patterns first. */
const FS_PATTERNS: [RegExp, { title: string; body: string }][] = [
  [
    /permission denied|eacces|eperm|access is denied/i,
    {
      title: "Permission denied",
      body: "Statly doesn't have permission to save there. Choose a different folder, or check that file's permissions, and try again.",
    },
  ],
  [
    /no space left|enospc|disk full|not enough space/i,
    {
      title: "Not enough disk space",
      body: "There isn't enough free space to save this file. Free up some space and try again.",
    },
  ],
  [
    /read-only file system|erofs/i,
    {
      title: "Can't save there",
      body: "That location is read-only. Choose a different folder and try again.",
    },
  ],
  [
    /no such file|enoent|not found/i,
    {
      title: "Location not found",
      body: "That folder or file doesn't exist any more. Choose a different location and try again.",
    },
  ],
];

function unknownDetail(e: unknown): string {
  if (e instanceof Error) return e.stack ?? e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e) ?? String(e);
  } catch {
    return String(e);
  }
}

/** Plain-language, one-sentence-or-two description for any error thrown by an `rpc.*` call,
 * an engine startup failure, a file-system write, or anything else a user might see. */
export function describeError(e: unknown): DescribedError {
  if (isDescribedException(e)) return e.described;

  if (isEngineErrorLike(e)) {
    const details = rpcTechnicalDetail(e);
    switch (e.kind) {
      case "rpc": {
        const known = typeof e.code === "number" ? RPC_MESSAGES[e.code] : undefined;
        if (known) return { ...known, details };
        return {
          title: "The engine reported a problem",
          body: "The statistics engine ran into a problem with that request.",
          details,
        };
      }
      case "timeout":
        return {
          title: "That took too long",
          body: "The statistics engine took too long to respond. This can happen the first time Statly runs on a slow or busy computer. Please try again.",
          details,
        };
      case "spawn":
        return {
          title: "Couldn't start the engine",
          body: "Statly couldn't find or start its statistics engine. Reinstalling Statly usually fixes this.",
          details: str(e.message, details),
        };
      case "exited":
        return {
          title: "The engine stopped",
          body: "The statistics engine stopped unexpectedly. Statly will try to restart it.",
          details: str(e.message, details),
        };
      case "protocol":
        return {
          title: "Unexpected response",
          body: "The statistics engine sent back something Statly didn't understand.",
          details: str(e.message, details),
        };
      case "ipc":
      default:
        return {
          title: "Couldn't reach the engine",
          body: "Statly couldn't talk to its statistics engine.",
          details: str(e.message, details),
        };
    }
  }

  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (msg) {
    for (const [pattern, described] of FS_PATTERNS) {
      if (pattern.test(msg)) return { ...described, details: msg };
    }
  }

  return {
    title: "Something went wrong",
    body: "Something went wrong. Please try again.",
    details: unknownDetail(e),
  };
}
