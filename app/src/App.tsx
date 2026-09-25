import { lazy, Suspense, useEffect } from "react";
import { X } from "lucide-react";
import { EngineStartup } from "@/components/EngineStartup";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { Button } from "@/components/ui/button";
import { ProjectMenu } from "@/components/project/ProjectMenu";
import { UnsavedChangesDialog } from "@/components/project/UnsavedChangesDialog";
import { IS_MOCK } from "@/lib/engineMode";
import { openProject, runAutosave, saveProject, saveProjectAs } from "@/lib/projectActions";
import { closeWindowNow, guardWindowClose } from "@/lib/window";
import { DataScreen } from "@/screens/DataScreen";
import { Home } from "@/screens/Home";
import { ImportWizard } from "@/screens/ImportWizard";
import { useNav } from "@/stores/nav";
import { useNotify } from "@/stores/notify";
import { AUTOSAVE_INTERVAL_MS, useProjectStore } from "@/stores/project";

// Inline env check (not IS_MOCK) so production builds drop the mock chunk.
const MockDialogHost =
  import.meta.env.VITE_STATLY_MOCK === "1"
    ? lazy(() => import("@/mocks/MockDialogHost").then((m) => ({ default: m.MockDialogHost })))
    : null;

function useAppEffects() {
  // Periodic crash-recovery autosave while there are unsaved changes.
  useEffect(() => {
    const t = window.setInterval(() => void runAutosave(), AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(t);
  }, []);

  // Unsaved-changes guard on window close.
  useEffect(
    () =>
      guardWindowClose(
        () => useProjectStore.getState().dirty,
        async () => {
          const choice = await useProjectStore.getState().confirmUnsaved("Close Statly");
          if (choice === "cancel") return;
          if (choice === "save" && !(await saveProject())) return;
          useProjectStore.setState({ dirty: false });
          await closeWindowNow();
        },
      ),
    [],
  );

  // Keyboard shortcuts: Cmd/Ctrl+S, Shift+Cmd/Ctrl+S, Cmd/Ctrl+O.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        void (e.shiftKey ? saveProjectAs() : saveProject());
      } else if (k === "o" && !e.shiftKey) {
        e.preventDefault();
        void openProject();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function Notification() {
  const note = useNotify((s) => s.note);
  const dismiss = useNotify((s) => s.dismiss);
  useEffect(() => {
    if (!note || note.tone === "error") return;
    const t = window.setTimeout(dismiss, 5000);
    return () => window.clearTimeout(t);
  }, [note, dismiss]);
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-40">
      {note && (
        <div
          role={note.tone === "error" ? "alert" : "status"}
          className={
            "pointer-events-auto flex max-w-sm items-start gap-3 rounded-md border p-3 text-sm shadow-md " +
            (note.tone === "error" ? "border-red-300 bg-red-50 text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-50" : "bg-background")
          }
        >
          <span className="flex-1">{note.text}</span>
          <Button variant="ghost" size="icon-xs" onClick={dismiss} aria-label="Dismiss">
            <X aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const view = useNav((s) => s.view);
  useAppEffects();
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-background focus:p-2">
        Skip to content
      </a>
      <header className="flex items-center gap-4 border-b px-4 py-2">
        <span className="text-base font-semibold tracking-tight">Statly</span>
        <ProjectMenu />
        {IS_MOCK && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Mock engine
          </span>
        )}
        <div className="ml-auto">
          <ThemeSwitcher />
        </div>
      </header>
      <main id="main" className="flex min-h-0 flex-1 flex-col overflow-auto p-6">
        <EngineStartup>
          {view === "home" && <Home />}
          {view === "import" && <ImportWizard />}
          {view === "data" && <DataScreen />}
        </EngineStartup>
      </main>
      <UnsavedChangesDialog />
      <Notification />
      {MockDialogHost && (
        <Suspense fallback={null}>
          <MockDialogHost />
        </Suspense>
      )}
    </div>
  );
}
