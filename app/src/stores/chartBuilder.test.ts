import { beforeEach, describe, expect, it } from "vitest";
import type { MockEngine } from "@/mocks/engine";
import { MOCK_EXAMPLE_PROJECT_PATH } from "@/mocks/shapes";
import { useFreshMock } from "@/test/mockTransport";
import { useChartBuilder } from "@/stores/chartBuilder";
import { useProjectStore } from "@/stores/project";

let engine: MockEngine;
const cb = () => useChartBuilder.getState();

beforeEach(async () => {
  engine = useFreshMock();
  cb().close();
  await useProjectStore.getState().open(MOCK_EXAMPLE_PROJECT_PATH);
});

describe("chart builder store", () => {
  it("builds a bar chart from shelves, fetches engine data, and only refetches for data changes", async () => {
    cb().startNew("bar");
    await cb().refresh();
    expect(cb().data).toBeNull(); // nothing on the shelves yet: no engine call
    expect(engine.calls.some((c) => c.method === "charts.data")).toBe(false);

    cb().addField("x", "SC0_band");
    cb().addField("y", "math_attitude");
    expect(cb().draft!.shelves.y).toEqual([{ variable: "math_attitude", aggregate: "mean" }]);
    await cb().refresh();
    expect(cb().error).toBeNull();
    expect(cb().data!.meta.error_bars).toBe("ci95");
    expect(cb().data!.rows.filter((r) => Number(r.n) > 1).every((r) => typeof r.lower === "number")).toBe(true);
    const calls = () => engine.calls.filter((c) => c.method === "charts.data").length;
    expect(calls()).toBe(1);

    cb().customize({ title: "Attitude" }); // styling only
    await cb().refresh();
    expect(calls()).toBe(1);
    cb().setErrorBars("se");
    await cb().refresh();
    expect(calls()).toBe(2);
    expect(cb().data!.meta.error_bars).toBe("se");
  });

  it("moves a variable between shelves and caps single-variable shelves", () => {
    cb().startNew("grouped_bar");
    cb().addField("x", "Time");
    cb().addField("color", "SC0_band");
    cb().addField("color", "Time"); // replaces, and leaves X
    expect(cb().draft!.shelves.color.map((f) => f.variable)).toEqual(["Time"]);
    expect(cb().draft!.shelves.x).toEqual([]);
    cb().removeField("color", "Time");
    expect(cb().draft!.shelves.color).toEqual([]);
  });

  it("suggests shelves from variable roles when a chart type is picked from the helper", () => {
    cb().startNew("bar");
    cb().setType("likert_diverging", true);
    expect(cb().draft!.shelves.y.map((f) => f.variable)).toEqual(["Q5_1", "Q5_2"]);
    expect(cb().draft!.shelves.facet.map((f) => f.variable)).toEqual(["Time"]);
    cb().startNew("bar");
    cb().setType("line", true);
    expect(cb().draft!.shelves.x.map((f) => f.variable)).toEqual(["Time"]);
    expect(cb().draft!.error_bars).not.toBe("none");
  });

  it("reports the engine's plain-language error for an impossible chart", async () => {
    cb().startNew("histogram");
    cb().addField("x", "SC0_band"); // text
    await cb().refresh();
    expect(cb().error).toMatch(/text, not numbers/);
  });

  it("saves specs in the project, duplicates, deletes, and reopens them after save/load", async () => {
    const before = useProjectStore.getState().project!.chart_specs.length;
    cb().startNew("box");
    cb().addField("x", "Time");
    cb().addField("y", "math_attitude");
    cb().setPreset("apa");
    cb().customize({ greyscale: true, figure_note: "Boxes show the middle 50%." });
    const saved = cb().save()!;
    expect(cb().unsaved).toBe(false);
    expect(useProjectStore.getState().dirty).toBe(true);
    expect(saved.customization).toMatchObject({ figure_number: 2, gridlines: false, greyscale: true });
    const copy = cb().duplicate(saved.id)!;
    expect(useProjectStore.getState().project!.chart_specs).toHaveLength(before + 2);
    cb().remove(copy.id);

    await useProjectStore.getState().saveTo("/mock/projects/Charts.statly");
    cb().close();
    useProjectStore.getState().newProject("Other");
    await useProjectStore.getState().open("/mock/projects/Charts.statly");
    const specs = useProjectStore.getState().project!.chart_specs;
    expect(specs).toHaveLength(before + 1);
    expect(specs.find((s) => s.id === saved.id)).toEqual(saved);

    cb().open(saved.id);
    expect(cb().isSaved).toBe(true);
    expect(cb().draft!.theme_preset).toBe("apa");
    await cb().refresh();
    expect(cb().data!.rows.some((r) => r.kind === "box")).toBe(true);
  });
});
