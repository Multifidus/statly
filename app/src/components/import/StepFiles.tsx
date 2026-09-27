import { ClipboardList, FileSpreadsheet, FolderOpen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect, Notice } from "@/components/ui/form";
import { WhyItMatters } from "@/components/ui/why";
import type { QualtricsMode } from "@/contracts";
import { pickImportFiles, pickSurveyFile } from "@/lib/dialogs";
import { useImportFlow } from "@/stores/importFlow";

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export function StepFiles() {
  const files = useImportFlow((s) => s.files);
  const addFiles = useImportFlow((s) => s.addFiles);
  const removeFile = useImportFlow((s) => s.removeFile);
  const mode = useImportFlow((s) => s.qualtricsMode);
  const setMode = useImportFlow((s) => s.setQualtricsMode);
  const survey = useImportFlow((s) => s.survey);
  const surveyError = useImportFlow((s) => s.surveyError);
  const busy = useImportFlow((s) => s.busy);
  const addSurvey = useImportFlow((s) => s.addSurvey);
  const removeSurvey = useImportFlow((s) => s.removeSurvey);

  const choose = async () => {
    const paths = await pickImportFiles();
    if (paths?.length) addFiles(paths);
  };

  const chooseSurvey = async () => {
    const path = await pickSurveyFile();
    if (path) await addSurvey(path);
  };

  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground">
        Pick one file, or several files from the same survey given at different times (for example Pre, Post
        and Follow-up). Statly reads CSV files and Excel workbooks (.xlsx). Your original files are never changed.
      </p>
      <WhyItMatters>
        <p>
          If you gave the same survey more than once, choose all of those files now. Statly will stack them into
          one table and add a <strong>Time</strong> column, so you can compare time points later.
        </p>
        <p>Statly keeps an untouched copy of every file inside your project, so you can always see where your numbers came from.</p>
      </WhyItMatters>
      <div>
        <Button onClick={choose} data-testid="choose-files">
          <FolderOpen aria-hidden /> Choose files…
        </Button>
      </div>
      {files.length > 0 && (
        <ul className="grid gap-2" aria-label="Files to import">
          {files.map((f) => (
            <li key={f.path} className="flex items-center gap-3 rounded-md border px-3 py-2">
              <FileSpreadsheet className="size-4 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm" title={f.path}>
                {baseName(f.path)}
              </span>
              <Button variant="ghost" size="icon-sm" onClick={() => removeFile(f.path)} aria-label={`Remove ${baseName(f.path)}`}>
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <section className="grid gap-2" aria-labelledby="survey-file-heading" data-testid="survey-file">
        <h3 id="survey-file-heading" className="text-sm font-medium">
          Add your survey file (.qsf)
        </h3>
        <p className="text-sm text-muted-foreground">
          Optional. Qualtrics can export your survey design as a .qsf file (Tools → Import/Export → Export Survey).
          Statly uses it to fill in question wording and answer choices for you.
        </p>
        {survey ? (
          <div className="flex items-center gap-3 rounded-md border px-3 py-2" data-testid="survey-file-chosen">
            <ClipboardList className="size-4 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm" title={survey.path}>
              <strong>{survey.survey.name}</strong>{" "}
              <span className="text-muted-foreground">
                ({survey.fileName}, {survey.nQuestions} {survey.nQuestions === 1 ? "question" : "questions"})
              </span>
            </span>
            <Button variant="ghost" size="icon-sm" onClick={removeSurvey} aria-label={`Remove ${survey.fileName}`}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        ) : (
          <div>
            <Button variant="outline" onClick={() => void chooseSurvey()} disabled={busy} data-testid="choose-survey">
              <ClipboardList aria-hidden /> Choose survey file…
            </Button>
          </div>
        )}
        {surveyError && (
          <Notice tone="error" role="alert">
            {surveyError}
          </Notice>
        )}
      </section>
      <div className="grid max-w-md gap-1.5">
        <label htmlFor="qualtrics-mode" className="text-sm font-medium">
          Qualtrics exports
        </label>
        <NativeSelect id="qualtrics-mode" value={mode} onChange={(e) => setMode(e.target.value as QualtricsMode)}>
          <option value="auto">Detect automatically (recommended)</option>
          <option value="on">These are Qualtrics exports</option>
          <option value="off">These are not from Qualtrics</option>
        </NativeSelect>
      </div>
    </div>
  );
}
