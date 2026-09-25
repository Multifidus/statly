import { setTransport } from "@/lib/rpc";

/** True when the app runs against the in-browser MockEngine (VITE_STATLY_MOCK=1). */
export const IS_MOCK = import.meta.env.VITE_STATLY_MOCK === "1";

/**
 * Install the RPC transport. In mock mode the MockEngine is loaded dynamically; because the
 * condition is a build-time constant, production builds drop the mock chunk entirely.
 */
export async function initEngineTransport(): Promise<void> {
  if (import.meta.env.VITE_STATLY_MOCK === "1") {
    const { MockEngine } = await import("@/mocks/engine");
    const seedAutosave = new URLSearchParams(window.location.search).has("mock-recover");
    setTransport(new MockEngine({ seedAutosave }));
  }
}
