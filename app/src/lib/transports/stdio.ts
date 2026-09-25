/**
 * Node-only NDJSON transport that talks to a real engine process over stdin/stdout
 * (docs/PROTOCOL.md). DEV/TEST ONLY: it imports node:child_process and must never be
 * imported from app code; the vitest engine suite (`npm run test:engine`) uses it to run the
 * exact requests the wizard builds against the source engine or a packaged binary.
 *
 * Engine selection (first match):
 *   STATLY_ENGINE_BIN     path to a packaged `statly-engine` executable
 *   STATLY_ENGINE_PYTHON  python interpreter with statly_engine importable
 *   <repo>/engine/.venv/bin/python (Windows: Scripts\python.exe)
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import type { EngineError } from "@/lib/engine";
import type { Transport } from "@/lib/rpc";

export interface EngineCommand {
  command: string;
  args: string[];
  cwd: string;
  source: "bin" | "python" | "venv";
}

export function resolveEngineCommand(repoRoot: string, env: NodeJS.ProcessEnv = process.env): EngineCommand {
  const engineDir = path.join(repoRoot, "engine");
  if (env.STATLY_ENGINE_BIN) {
    return { command: env.STATLY_ENGINE_BIN, args: [], cwd: path.dirname(env.STATLY_ENGINE_BIN), source: "bin" };
  }
  if (env.STATLY_ENGINE_PYTHON) {
    return { command: env.STATLY_ENGINE_PYTHON, args: ["-m", "statly_engine"], cwd: engineDir, source: "python" };
  }
  const venv =
    process.platform === "win32"
      ? path.join(engineDir, ".venv", "Scripts", "python.exe")
      : path.join(engineDir, ".venv", "bin", "python");
  if (!existsSync(venv)) throw new Error(`No engine found: set STATLY_ENGINE_BIN or STATLY_ENGINE_PYTHON, or create ${venv}`);
  return { command: venv, args: ["-m", "statly_engine"], cwd: engineDir, source: "venv" };
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: EngineError) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
}

export class StdioTransport implements Transport {
  readonly stderr: string[] = [];
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private exited: string | null = null;
  private readonly exitPromise: Promise<number | null>;

  private constructor(
    private readonly proc: ChildProcessWithoutNullStreams,
    readonly timeoutMs: number,
  ) {
    createInterface({ input: proc.stdout }).on("line", (line) => this.onLine(line));
    createInterface({ input: proc.stderr }).on("line", (line) => this.stderr.push(line));
    this.exitPromise = new Promise((resolve) => {
      proc.on("exit", (code) => {
        this.exited = `engine exited with code ${code}`;
        for (const [, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject({ kind: "exited", message: this.exited });
        }
        this.pending.clear();
        resolve(code);
      });
    });
  }

  static start(cmd: EngineCommand, opts: { timeoutMs?: number } = {}): StdioTransport {
    const proc = spawn(cmd.command, cmd.args, { cwd: cmd.cwd, stdio: ["pipe", "pipe", "pipe"] });
    return new StdioTransport(proc, opts.timeoutMs ?? 60_000);
  }

  private onLine(line: string) {
    if (!line.trim()) return;
    let msg: { id?: number | null; result?: unknown; error?: { code: number; message: string; data?: unknown } };
    try {
      msg = JSON.parse(line);
    } catch {
      this.stderr.push(`[stdio-transport] non-JSON stdout line: ${line.slice(0, 200)}`);
      return;
    }
    if (typeof msg.id !== "number") return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject({ kind: "rpc", code: msg.error.code, message: msg.error.message, data: msg.error.data });
    else p.resolve(msg.result);
  }

  call<T>(method: string, params: object = {}): Promise<T> {
    if (this.exited) return Promise.reject({ kind: "exited", message: this.exited } satisfies EngineError);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject({ kind: "timeout", method, seconds: this.timeoutMs / 1000 } satisfies EngineError);
      }, this.timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer, method });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  /** Graceful `shutdown`, then wait for exit (kills after 5 s). Returns the exit code. */
  async close(): Promise<number | null> {
    if (!this.exited) {
      await this.call("shutdown").catch(() => undefined);
      this.proc.stdin.end();
      const kill = setTimeout(() => this.proc.kill(), 5000);
      const code = await this.exitPromise;
      clearTimeout(kill);
      return code;
    }
    return this.exitPromise;
  }
}
