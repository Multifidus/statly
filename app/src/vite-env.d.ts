/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" = use the in-browser MockEngine instead of the Tauri sidecar. */
  readonly VITE_STATLY_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
