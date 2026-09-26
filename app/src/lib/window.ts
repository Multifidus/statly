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

/**
 * macOS Cmd+Q / the app menu's Quit (and other whole-app-exit requests) fire Tauri's
 * `RunEvent::ExitRequested` in Rust, which does not go through the window's close-requested
 * event, so `guardWindowClose` alone can't catch it. Rust blocks the exit and emits
 * "quit-requested" instead; this listens for that so the same unsaved-changes flow can run.
 * No-op outside Tauri (there's no app-level quit to intercept in the browser/mock).
 * Returns an unsubscribe function.
 */
export function onQuitRequested(handler: () => void): () => void {
  if (IS_MOCK || !inTauri()) return () => {};
  let unlisten: (() => void) | null = null;
  let disposed = false;
  import("@tauri-apps/api/event").then(({ listen }) =>
    listen("quit-requested", handler).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    }),
  );
  return () => {
    disposed = true;
    unlisten?.();
  };
}

/** Actually exit the app (after the user chose to discard or saved) in response to a quit request. */
export async function quitNow(): Promise<void> {
  if (!IS_MOCK && inTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("quit");
  } else {
    window.close();
  }
}
