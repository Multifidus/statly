import { ChevronDown, FilePlus, FolderOpen, Save, SaveAll } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { newProject, openProject, saveProject, saveProjectAs } from "@/lib/projectActions";
import { useProjectStore } from "@/stores/project";

const mod = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl+";

export function AutosaveIndicator() {
  const project = useProjectStore((s) => s.project);
  const dirty = useProjectStore((s) => s.dirty);
  const path = useProjectStore((s) => s.path);
  const a = useProjectStore((s) => s.autosave);
  if (!project) return null;
  let text: string;
  if (!dirty) text = path ? "All changes saved" : "Not saved yet";
  else if (a.status === "saving") text = "Saving a backup…";
  else if (a.status === "error") text = "Backup failed. Save your project soon.";
  else if (a.status === "saved" && a.at)
    text = `Unsaved changes · backup at ${new Date(a.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  else text = "Unsaved changes";
  return (
    <span role="status" aria-live="polite" className="text-xs text-muted-foreground" data-testid="autosave-status">
      {text}
    </span>
  );
}

export function ProjectMenu() {
  const project = useProjectStore((s) => s.project);
  const dirty = useProjectStore((s) => s.dirty);
  return (
    <div className="flex shrink-0 items-center gap-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" data-testid="project-menu">
            <span className="max-w-56 truncate">{project ? project.name : "Project"}</span>
            {dirty && (
              <span className="size-2 rounded-full bg-amber-500" aria-label="unsaved changes" role="img" />
            )}
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => void newProject()}>
            <FilePlus aria-hidden /> New project
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void openProject()}>
            <FolderOpen aria-hidden /> Open…
            <DropdownMenuShortcut>{mod}O</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!project} onSelect={() => void saveProject()}>
            <Save aria-hidden /> Save
            <DropdownMenuShortcut>{mod}S</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!project} onSelect={() => void saveProjectAs()}>
            <SaveAll aria-hidden /> Save As…
            <DropdownMenuShortcut>⇧{mod}S</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AutosaveIndicator />
    </div>
  );
}
