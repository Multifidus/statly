import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { findNoncontiguous, findResponseSets } from "@/lib/importLogic";
import { MESSY, useFreshMock } from "@/test/mockTransport";
import { useDatasetStore } from "@/stores/dataset";
import { useImportFlow } from "@/stores/importFlow";
import { useNav } from "@/stores/nav";
import { useProjectStore } from "@/stores/project";
import { ImportReplaceDialog } from "./ImportReplaceDialog";
import { ProjectMenu } from "./ProjectMenu";

async function importMessy() {
  useProjectStore.getState().newProject("Thesis");
  const s = useImportFlow.getState();
  s.addFiles([MESSY]);
  if (!(await s.runPreview())) throw new Error("preview failed");
  const { preview, update } = useImportFlow.getState();
  update({
    responseConfirmed: Object.fromEntries(findResponseSets(preview!.files).map((x) => [x.key, true])),
    noncontiguousAck: Object.fromEntries(findNoncontiguous(preview!.files).map((v) => [v.variable, true])),
  });
  if (!(await useImportFlow.getState().commit())) throw new Error(useImportFlow.getState().error ?? "import failed");
}

beforeEach(() => {
  useFreshMock();
  useNav.setState({ view: "data", prev: null });
});

describe("ProjectMenu: Home and Import data…", () => {
  it("Home navigates to the home screen", async () => {
    const user = userEvent.setup();
    useProjectStore.getState().newProject("Thesis");
    render(<ProjectMenu />);
    await user.click(screen.getByTestId("project-menu"));
    await user.click(screen.getByTestId("project-menu-home"));
    expect(useNav.getState().view).toBe("home");
  });

  it("goes straight to Import when no dataset is loaded", async () => {
    const user = userEvent.setup();
    useProjectStore.getState().newProject("Thesis");
    render(
      <>
        <ProjectMenu />
        <ImportReplaceDialog />
      </>,
    );
    await user.click(screen.getByTestId("project-menu"));
    await user.click(screen.getByTestId("project-menu-import"));
    expect(useNav.getState().view).toBe("import");
    expect(screen.queryByText(/replace this project's data/i)).not.toBeInTheDocument();
  });

  it("confirms before replacing an already-loaded dataset, and only navigates on Continue", async () => {
    const user = userEvent.setup();
    await importMessy();
    render(
      <>
        <ProjectMenu />
        <ImportReplaceDialog />
      </>,
    );
    await user.click(screen.getByTestId("project-menu"));
    await user.click(screen.getByTestId("project-menu-import"));
    expect(await screen.findByText(/replace this project's data/i)).toBeVisible();
    expect(useNav.getState().view).toBe("data");

    await user.click(screen.getByTestId("import-replace-confirm"));
    expect(useNav.getState().view).toBe("import");
  });

  it("cancelling the replace prompt stays put and leaves the dataset alone", async () => {
    const user = userEvent.setup();
    await importMessy();
    render(
      <>
        <ProjectMenu />
        <ImportReplaceDialog />
      </>,
    );
    await user.click(screen.getByTestId("project-menu"));
    await user.click(screen.getByTestId("project-menu-import"));
    await screen.findByText(/replace this project's data/i);
    await user.click(screen.getByTestId("import-replace-cancel"));
    expect(useNav.getState().view).toBe("data");
    expect(useDatasetStore.getState().meta).not.toBeNull();
  });

  it("entering Import through go() always starts the flow clean", async () => {
    await importMessy();
    const s = useImportFlow.getState();
    // Simulate a stale wizard: files/preview left over from the import that just committed.
    expect(s.files.length).toBeGreaterThan(0);
    useNav.getState().go("import");
    expect(useImportFlow.getState().files).toEqual([]);
    expect(useImportFlow.getState().preview).toBeNull();
    expect(useImportFlow.getState().step).toBe("files");
  });
});
