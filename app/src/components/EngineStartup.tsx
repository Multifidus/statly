import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  describeEngineError,
  type EngineError,
  type EngineInfo,
  engineInfo,
  ping,
  technicalDetail,
} from "@/lib/engine";

/** Overall startup budget (PROTOCOL.md: 30 s). */
const STARTUP_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 1_000;

type Phase =
  | { status: "warming" }
  | { status: "ready"; info: EngineInfo }
  | { status: "error"; error: EngineError };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForEngine(isCancelled: () => boolean): Promise<EngineInfo> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastError: EngineError | null = null;
  while (Date.now() < deadline && !isCancelled()) {
    try {
      await ping();
      return await engineInfo();
    } catch (e) {
      const err = e as EngineError;
      lastError = err;
      // Missing executable or a hard timeout will not fix itself by retrying.
      if (err.kind === "spawn" || err.kind === "timeout") throw err;
      await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastError ?? { kind: "timeout", method: "ping", seconds: STARTUP_TIMEOUT_MS / 1000 };
}

export function EngineStartup() {
  const [phase, setPhase] = useState<Phase>({ status: "warming" });
  const attempt = useRef(0);

  const start = useCallback(() => {
    const mine = ++attempt.current;
    const cancelled = () => attempt.current !== mine;
    setPhase({ status: "warming" });
    waitForEngine(cancelled)
      .then((info) => {
        if (cancelled()) return;
        console.info("[statly] engine ready", info);
        setPhase({ status: "ready", info });
      })
      .catch((error: EngineError) => {
        if (cancelled()) return;
        console.error("[statly] engine startup failed", error);
        setPhase({ status: "error", error });
      });
  }, []);

  useEffect(() => {
    start();
    return () => {
      attempt.current++;
    };
  }, [start]);

  if (phase.status === "warming") {
    return (
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-4 text-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />
        <p className="text-lg font-medium">Warming up the statistics engine…</p>
        <p className="text-sm text-muted-foreground">This usually takes a few seconds.</p>
      </div>
    );
  }

  if (phase.status === "error") {
    return (
      <Card className="w-full max-w-md" role="alert">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-destructive" aria-hidden />
            The statistics engine didn't start
          </CardTitle>
          <CardDescription>{describeEngineError(phase.error)}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">Technical details</summary>
            <code className="mt-2 block break-words font-mono">{technicalDetail(phase.error)}</code>
          </details>
          <Button onClick={start} className="self-start">
            <RotateCw aria-hidden /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { info } = phase;
  const rows: [string, string][] = [
    ["Engine", info.engine_version],
    ["Python", info.python_version],
    ["Platform", info.platform],
    ...Object.entries(info.libraries ?? {}).map(([k, v]) => [k, v] as [string, string]),
  ];
  return (
    <Card className="w-full max-w-md" data-testid="engine-ready">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
          Engine ready
        </CardTitle>
        <CardDescription>The statistics engine is running.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-mono break-all">{v}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
