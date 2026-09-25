import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initEngineTransport } from "@/lib/engineMode";
import { initTheme } from "@/stores/theme";
import "./index.css";

initTheme();

void initEngineTransport().then(async () => {
  if (import.meta.env.DEV) {
    // Debug hook for devtools: live store state (never present in production builds).
    const [{ useDatasetStore }, { useImportFlow }, { useProjectStore }] = await Promise.all([
      import("@/stores/dataset"),
      import("@/stores/importFlow"),
      import("@/stores/project"),
    ]);
    (window as unknown as { __statly: object }).__statly = {
      dataset: () => useDatasetStore.getState(),
      importFlow: () => useImportFlow.getState(),
      project: () => useProjectStore.getState(),
    };
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  if (import.meta.env.DEV && import.meta.env.VITE_STATLY_SELFTEST === "1" && import.meta.env.VITE_STATLY_SELFTEST_ROOT) {
    const { runDevSelfTest } = await import("@/lib/devSelfTest");
    const root = import.meta.env.VITE_STATLY_SELFTEST_ROOT;
    await runDevSelfTest(root, import.meta.env.VITE_STATLY_SELFTEST_OUT ?? root);
  }
});
