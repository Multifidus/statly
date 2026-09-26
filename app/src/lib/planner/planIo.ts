/**
 * Study Planner I/O: `export.plan` (docs/PROTOCOL.md "Study Planner") and its save dialog.
 * Calls go through the shared rpc transport so tests and the mock engine can stand in.
 */
import type { StudyPlan } from "@/contracts";
import { pickExportPath } from "@/lib/dialogs";
import { getTransport } from "@/lib/rpc";

export interface ExportPlanParams {
  plan: StudyPlan;
  /** id -> readable label for analyses, assumptions and effect sizes. */
  labels?: Record<string, string>;
  /** The design interview as the student saw it. */
  interview?: { question: string; answer: string }[];
  format: "docx";
  path: string;
  overwrite?: boolean;
}

export const exportPlanRpc = (p: ExportPlanParams) => getTransport().call<{ path: string; bytes: number }>("export.plan", p);

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Study plan";

/** Ask where to save the plan DOCX (shared export save dialog). Resolves null if cancelled. */
export async function pickPlanDocxPath(title: string): Promise<string | null> {
  return pickExportPath(`${safeName(title)} - study plan`, "docx");
}
