/**
 * DEV ONLY. Drives the import wizard's stores through the real Tauri engine transport
 * (webview -> Rust engine_call -> sidecar) when the dev server is started with
 * VITE_STATLY_SELFTEST=1 and VITE_STATLY_SELFTEST_ROOT=<repo root>. There is no devtools
 * protocol for the macOS WebView, so progress is made visible in the terminal through the
 * engine's own `[engine] <method> id=.. ok` stderr lines: each step is announced by calling
 * the (unknown, harmless) method `selftest.<step>`, and the run ends with `selftest.passed`
 * or `selftest.failed.<step>`. Never loaded in production builds (import.meta.env.DEV guard).
 */
import type { DatasetMeta } from "@/contracts";
import { findNoncontiguous, findResponseSets } from "@/lib/importLogic";
import { getTransport, rpc } from "@/lib/rpc";
import { useDatasetStore } from "@/stores/dataset";
import { useImportFlow } from "@/stores/importFlow";
import { useNav } from "@/stores/nav";
import { useProjectStore } from "@/stores/project";

const mark = (name: string) => getTransport().call(`selftest.${name}`, {}).catch(() => undefined);

function check(cond: unknown, what: string) {
  if (!cond) throw new Error(what);
}

async function importFiles(paths: string[], tweak?: () => void): Promise<DatasetMeta> {
  const flow = useImportFlow.getState();
  flow.reset();
  flow.addFiles(paths);
  check(await useImportFlow.getState().runPreview(), `preview ${useImportFlow.getState().error}`);
  const { preview, update } = useImportFlow.getState();
  update({
    responseConfirmed: Object.fromEntries(findResponseSets(preview!.files).map((s) => [s.key, true])),
    noncontiguousAck: Object.fromEntries(findNoncontiguous(preview!.files).map((v) => [v.variable, true])),
    matchDecisions: Object.fromEntries(
      (preview!.stack_proposal ?? []).filter((m) => m.status === "possibly_renamed").map((m) => [m.variable, "accept" as const]),
    ),
  });
  tweak?.();
  check(await useImportFlow.getState().commit(), `commit ${useImportFlow.getState().error}`);
  useNav.getState().go("data"); // the grid fetches its first page via dataset.rows
  return useDatasetStore.getState().meta!;
}

async function q6Values(meta: DatasetMeta): Promise<number[]> {
  const page = await rpc.rows({ dataset_id: meta.dataset_id, snapshot_id: meta.snapshot_id, offset: 0, limit: 2000, columns: ["Q6"], sort: null });
  return [...new Set(page.rows.map((r) => r[0]).filter((v): v is number => typeof v === "number" && v !== -99))].sort((a, b) => a - b);
}

export async function runDevSelfTest(root: string, saveDir: string): Promise<void> {
  const fx = (...p: string[]) => [root, "fixtures", "practice", ...p].join("/");
  let step = "start";
  const results: Record<string, unknown> = {};
  (window as unknown as { __statly: Record<string, unknown> }).__statly.selftest = results;
  try {
    step = "messy_3header";
    await mark(step);
    const messy = await importFiles([fx("messy_qualtrics", "messy_3header.csv")]);
    check(messy.n_rows === 108, `messy rows ${messy.n_rows}`);
    check(messy.variables.some((v) => v.name === "Q7_Online_videos"), "Q7 indicators");
    results[step] = messy.n_rows;

    step = "save_close_reopen";
    await mark(step);
    const before = JSON.stringify(messy);
    const file = `${saveDir}/selftest.statly`;
    await useProjectStore.getState().saveTo(file);
    useProjectStore.getState().close();
    await useProjectStore.getState().open(file);
    const reopened = useDatasetStore.getState().meta!;
    check(JSON.stringify(reopened) === before, "meta changed across save/load");
    check(reopened.n_rows === 108, `reopened rows ${reopened.n_rows}`);
    results[step] = reopened.n_rows;

    step = "text_choices_default";
    await mark(step);
    const tDefault = await importFiles([fx("messy_qualtrics", "messy_text_choices.csv")]);
    check(JSON.stringify(await q6Values(tDefault)) === "[1,2,3,4,5]", "Q6 default codes");

    step = "text_choices_1_2_4_5_7";
    await mark(step);
    const tCodes = await importFiles([fx("messy_qualtrics", "messy_text_choices.csv")], () => {
      const s = useImportFlow.getState();
      const set = findResponseSets(s.preview!.files).find((x) => x.variables.includes("Q6"))!;
      s.update({ responseCodes: { [set.key]: [1, 2, 4, 5, 7] } });
    });
    check(JSON.stringify(await q6Values(tCodes)) === "[1,2,4,5,7]", "Q6 user codes");

    step = "three_groups_stacked";
    await mark(step);
    const three = await importFiles(["pre", "post", "followup"].map((t) => fx("three_groups_prepost_followup", `${t}.csv`)));
    check(three.n_rows === 135 + 119 + 98 && three.link.mode === "aggregate", `three rows ${three.n_rows}`);

    step = "linked_id";
    await mark(step);
    const linked = await importFiles(["pre", "post"].map((t) => fx("linked_id_prepost", `${t}.csv`)), () =>
      useImportFlow.getState().update({ linkMode: "linked", idVariable: "Q1" }),
    );
    check(linked.link.mode === "linked" && linked.link.counts?.matched === 75, `link ${JSON.stringify(linked.link.counts)}`);

    await mark("passed");
    results.passed = true;
  } catch (e) {
    results.error = `${step}: ${String((e as Error)?.message ?? JSON.stringify(e))}`;
    await mark(`failed.${step}`);
  }
}
