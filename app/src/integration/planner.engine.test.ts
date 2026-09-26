// @vitest-environment node
/**
 * Real-engine test for the Study Planner (SPEC §11.2): design interview with no dataset ->
 * power.t_test a priori (null dataset ids) -> plan saved in a project -> reopened in a fresh
 * engine -> plan present; plus the DOCX export.
 */
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rpc, setTransport } from "@/lib/rpc";
import { resolveEngineCommand, StdioTransport } from "@/lib/transports/stdio";
import { usePlanner } from "@/stores/planner";
import { useProjectStore } from "@/stores/project";

const REPO = path.resolve(import.meta.dirname, "../../..");
let docxPath = "";
vi.mock("@/lib/planner/planIo", async (orig) => ({
  ...(await orig<typeof import("@/lib/planner/planIo")>()),
  pickPlanDocxPath: vi.fn(async () => docxPath),
}));

let engine: StdioTransport;
let tmp: string;
const start = () => StdioTransport.start(resolveEngineCommand(REPO), { timeoutMs: 120_000 });

beforeAll(async () => {
  engine = start();
  setTransport(engine);
  expect((await rpc.ping()).pong).toBe(true);
  tmp = mkdtempSync(path.join(os.tmpdir(), "statly-planner-"));
  docxPath = path.join(tmp, "plan.docx");
}, 120_000);

afterAll(async () => {
  await engine?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("Study Planner against the real engine", () => {
  it("interview -> power.t_test -> plan saved, exported and reopened", async () => {
    const p = usePlanner.getState();
    p.reset();
    p.setTitle("Math attitude study");
    p.setResearchQuestion("Do students in the new program feel better about math?");
    await usePlanner.getState().beginInterview();
    const answers: [string, string][] = [
      ["q_intent", "compare"],
      ["q_compare_outcome_level", "continuous"],
      ["q_compare_design", "independent_groups"],
      ["q_compare_between_factors", "one"],
      ["q_compare_between_groups_count", "two"],
      ["q_compare_covariate_two", "no"],
    ];
    for (const [q, v] of answers) {
      expect(usePlanner.getState().error).toBeNull();
      expect(usePlanner.getState().advisorStep?.next_question?.id).toBe(q);
      await usePlanner.getState().answer(q, v);
    }
    const step = usePlanner.getState().advisorStep!;
    expect(step.recommendation?.primary_test).toBe("t_test.independent");
    expect(step.path.every((x) => x.source === "user")).toBe(true);

    usePlanner.getState().toPower();
    expect(usePlanner.getState().powerPlan?.powerId).toBe("power.t_test");
    expect(await usePlanner.getState().runPower()).toBe(true);
    const res = usePlanner.getState().apriori!;
    expect(res.statistics.find((s) => s.key === "n_required")?.value).toBe(64);
    expect(res.statistics.find((s) => s.key === "n_total")?.value).toBe(128);
    usePlanner.getState().setSensitivityN(30);
    expect(await usePlanner.getState().runSensitivity()).toBe(true);
    expect(usePlanner.getState().sensitivity!.statistics.find((s) => s.key === "detectable_effect")!.value).toBeCloseTo(0.7356, 3);

    usePlanner.getState().toPlan();
    const plan = usePlanner.getState().plan!;
    expect(plan.power_analyses.map((x) => x.mode)).toEqual(["a_priori", "sensitivity"]);
    expect(plan.power_analyses[0].outputs).toMatchObject({ n_total: 128, n_per_group: [64, 64] });

    // Save into a new project (engine validates ProjectFile incl. study_plan against the contract).
    const projPath = path.join(tmp, "plan.statly");
    useProjectStore.getState().newProject("Math attitude study");
    useProjectStore.setState({ path: projPath });
    expect(await usePlanner.getState().savePlanToProject()).toBe(true);
    expect(existsSync(projPath)).toBe(true);

    // DOCX export
    expect(await usePlanner.getState().exportDocx()).toBe(docxPath);
    expect(statSync(docxPath).size).toBeGreaterThan(5000);

    // Reopen in a fresh engine
    await engine.close();
    engine = start();
    setTransport(engine);
    useProjectStore.getState().close();
    usePlanner.getState().reset();
    const reopened = await useProjectStore.getState().open(projPath);
    expect(reopened.study_plan).toEqual(plan);
    await usePlanner.getState().loadPlan(reopened.study_plan!);
    expect(usePlanner.getState().advisorStep?.recommendation?.primary_test).toBe("t_test.independent");
    expect(usePlanner.getState().plan?.power_analyses[0].outputs?.n_total).toBe(128);
  }, 180_000);
});
