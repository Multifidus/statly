import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CheckboxField, Input } from "@/components/ui/form";
import { useMockDialog } from "./dialogStore";
import { MOCK_EXAMPLE_PROJECT_PATH, MOCK_FILES, MOCK_TEST_LOG_PROJECT_PATH } from "./shapes";

const base = (p: string) => p.split("/").pop() ?? p;

/** Stand-in for the OS file dialogs in mock mode (a browser can't hand out real paths). */
export function MockDialogHost() {
  const pending = useMockDialog((s) => s.pending);
  const finish = useMockDialog((s) => s.finish);
  const saved = useMockDialog((s) => s.savedPaths);
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");

  useEffect(() => {
    setPicked([]);
    setName(pending?.defaultName ?? "Untitled project");
  }, [pending]);

  const groups = [...new Set(MOCK_FILES.map((f) => f.group))];
  const seeded = [MOCK_EXAMPLE_PROJECT_PATH, MOCK_TEST_LOG_PROJECT_PATH];
  const projects = [...seeded, ...saved.filter((p) => !seeded.includes(p))];

  return (
    <Dialog open={!!pending} onOpenChange={(o) => !o && finish(null)}>
      <DialogContent aria-describedby="mock-dialog-desc" data-testid="mock-dialog">
        <DialogTitle>
          {pending?.kind === "import" ? "Choose data files (mock)" : pending?.kind === "open" ? "Open project (mock)" : "Save project (mock)"}
        </DialogTitle>
        <DialogDescription id="mock-dialog-desc">
          Mock engine mode: these stand in for the practice datasets. No real files are read.
        </DialogDescription>
        {pending?.kind === "import" && (
          <div className="grid gap-4">
            {groups.map((g) => (
              <fieldset key={g} className="grid gap-1.5">
                <legend className="mb-1 text-sm font-semibold">{g}</legend>
                {MOCK_FILES.filter((f) => f.group === g).map((f) => (
                  <CheckboxField
                    key={f.path}
                    label={base(f.path)}
                    checked={picked.includes(f.path)}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, f.path] : picked.filter((p) => p !== f.path))}
                  />
                ))}
              </fieldset>
            ))}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => finish(null)}>Cancel</Button>
              <Button disabled={!picked.length} onClick={() => finish(picked)}>Open</Button>
            </div>
          </div>
        )}
        {pending?.kind === "open" && (
          <ul className="grid gap-2">
            {projects.map((p) => (
              <li key={p}>
                <Button variant="outline" className="w-full justify-start" onClick={() => finish(p)}>
                  {base(p)}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {pending?.kind === "save" && (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) finish(`/mock/projects/${name.trim().replace(/\.statly$/i, "")}.statly`);
            }}
          >
            <label htmlFor="mock-save-name" className="text-sm font-medium">File name</label>
            <Input id="mock-save-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => finish(null)}>Cancel</Button>
              <Button type="submit">Save</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
