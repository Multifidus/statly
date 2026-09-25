/** Window-close hook for the unsaved-changes guard (Tauri window, or beforeunload in a browser). */
import { IS_MOCK } from "@/lib/engineMode";

const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * `shouldBlock` is called when the user tries to close the window. If it returns true the
 * close is cancelled and `onBlocked` runs (e.g. to show the unsaved-changes dialog).
 * Returns an unsubscribe function.
 */
export function guardWindowClose(shouldBlock: () => boolean, onBlocked: () => void): () => void {
  if (!IS_MOCK && inTauri()) {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow()
        .onCloseRequested((event) => {
          if (shouldBlock()) {
            event.preventDefault();
            onBlocked();
          }
        })
        .then((fn) => {
          if (disposed) fn();
          else unlisten = fn;
        }),
    );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }
  const handler = (e: BeforeUnloadEvent) => {
    if (shouldBlock()) {
      e.preventDefault();
      e.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", handler);
  return () => window.removeEventListener("beforeunload", handler);
}

/** Close the window for real (after the user chose to discard or saved). */
export async function closeWindowNow(): Promise<void> {
  if (!IS_MOCK && inTauri()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().destroy();
  } else {
    window.close();
  }
}
