/** User-level project commands shared by the Home screen, the Project menu and shortcuts. */
import { autosaveDir, pickProjectToOpen, pickSavePath } from "@/lib/dialogs";
import { describeRpcError } from "@/lib/rpc";
import { useImportFlow } from "@/stores/importFlow";
import { useNav } from "@/stores/nav";
import { useNotify } from "@/stores/notify";
import { useProjectStore } from "@/stores/project";

const notifyError = (e: unknown) => useNotify.getState().show(describeRpcError(e), "error");

/** Resolve unsaved changes before a destructive action. Returns false if the user cancelled. */
export async function resolveUnsaved(reason: string): Promise<boolean> {
  const choice = await useProjectStore.getState().confirmUnsaved(reason);
  if (choice === "cancel") return false;
  if (choice === "save") return saveProject();
  return true;
}

export async function newProject(): Promise<void> {
  if (!(await resolveUnsaved("Start a new project"))) return;
  useImportFlow.getState().reset();
  useProjectStore.getState().newProject();
  useNav.getState().go("import");
}

export async function openProject(): Promise<void> {
  if (!(await resolveUnsaved("Open another project"))) return;
  const path = await pickProjectToOpen();
  if (!path) return;
  try {
    const p = await useProjectStore.getState().open(path);
    useImportFlow.getState().reset();
    useNav.getState().go(p.dataset_meta ? "data" : "import");
  } catch (e) {
    notifyError(e);
  }
}

export async function saveProjectAs(): Promise<boolean> {
  const { project } = useProjectStore.getState();
  if (!project) return false;
  const path = await pickSavePath(project.name || "Untitled project");
  if (!path) return false;
  try {
    await useProjectStore.getState().saveTo(path);
    useNotify.getState().show("Project saved.");
    return true;
  } catch (e) {
    notifyError(e);
    return false;
  }
}

export async function saveProject(): Promise<boolean> {
  const { project, path } = useProjectStore.getState();
  if (!project) return false;
  if (!path) return saveProjectAs();
  try {
    await useProjectStore.getState().saveTo(path);
    useNotify.getState().show("Project saved.");
    return true;
  } catch (e) {
    notifyError(e);
    return false;
  }
}

export async function recoverAutosave(autosavePath: string): Promise<void> {
  const item = useProjectStore.getState().recoverable.find((r) => r.autosave_path === autosavePath);
  if (!item) return;
  try {
    const p = await useProjectStore.getState().recover(item);
    useNav.getState().go(p.dataset_meta ? "data" : "import");
    useNotify.getState().show("Recovered your unsaved work. Save it to keep it.");
  } catch (e) {
    notifyError(e);
  }
}

export async function runAutosave(): Promise<void> {
  const s = useProjectStore.getState();
  if (!s.project || !s.dirty) return;
  await s.autosaveNow(await autosaveDir());
}

export async function loadRecoverable(): Promise<void> {
  await useProjectStore.getState().loadRecoverable(await autosaveDir());
}
