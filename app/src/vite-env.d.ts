/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" = use the in-browser MockEngine instead of the Tauri sidecar. */
  readonly VITE_STATLY_MOCK?: string;
  /** Dev only: "1" runs lib/devSelfTest against the real engine (see that file). */
  readonly VITE_STATLY_SELFTEST?: string;
  readonly VITE_STATLY_SELFTEST_ROOT?: string;
  /** Dev only: directory for the self-test's .statly file (default: repo root). */
  readonly VITE_STATLY_SELFTEST_OUT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
