import { useEffect } from "react";
import { ClipboardList, FilePlus, FolderOpen, History, Trash2 } from "lucide-react";
import { useNav } from "@/stores/nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadRecoverable, newProject, openProject, recoverAutosave } from "@/lib/projectActions";
import { useProjectStore } from "@/stores/project";

const fmt = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const base = (p: string) => (p.split(/[\\/]/).pop() ?? p).replace(/\.statly$/i, "");

export function Home() {
  const recoverable = useProjectStore((s) => s.recoverable);
  const discard = useProjectStore((s) => s.discardRecoverable);

  useEffect(() => {
    void loadRecoverable();
  }, []);

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to Statly</h1>
        <p className="text-muted-foreground">Start by bringing in your survey data, or open a project you saved before.</p>
      </div>

      {recoverable.length > 0 && (
        <Card className="border-amber-300 dark:border-amber-800" data-testid="recover-list">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="size-5" aria-hidden /> Recover unsaved work
            </CardTitle>
            <CardDescription>
              Statly closed before these projects were saved. Statly keeps a backup copy every minute while you work.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2">
              {recoverable.map((r) => (
                <li key={r.autosave_path} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{r.marker.original_path ? base(r.marker.original_path) : "Untitled project (never saved)"}</p>
                    <p className="text-sm text-muted-foreground">Backup from {fmt(r.marker.saved_at)}</p>
                  </div>
                  <Button size="sm" onClick={() => void recoverAutosave(r.autosave_path)}>
                    Recover
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void discard(r)} aria-label={`Discard backup from ${fmt(r.marker.saved_at)}`}>
                    <Trash2 aria-hidden /> Discard
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>New project</CardTitle>
            <CardDescription>Import a CSV or Excel file, like a Qualtrics export. You can combine Pre, Post and Follow-up files.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => void newProject()} data-testid="new-project">
              <FilePlus aria-hidden /> New project
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Open project</CardTitle>
            <CardDescription>Continue working on a .statly project file.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => void openProject()} data-testid="open-project">
              <FolderOpen aria-hidden /> Open project…
            </Button>
          </CardContent>
        </Card>
        <Card className="sm:col-span-2">
          <CardHeader>
            <CardTitle>Plan a study</CardTitle>
            <CardDescription>No data yet? Plan your design, find out how many people you need, and get tips for setting up your survey.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => useNav.getState().go("planner")} data-testid="plan-study">
              <ClipboardList aria-hidden /> Plan a study
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
