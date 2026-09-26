import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Upload } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

describe("EmptyState", () => {
  it("shows the icon, title and body", () => {
    render(<EmptyState icon={Upload} title="No data yet" body="Import a file to get started." />);
    expect(screen.getByText("No data yet")).toBeInTheDocument();
    expect(screen.getByText("Import a file to get started.")).toBeInTheDocument();
  });

  it("renders the action button and calls onClick", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<EmptyState icon={Upload} title="No data yet" body="Import a file." action={{ label: "Import a file", onClick }} />);
    await user.click(screen.getByRole("button", { name: /import a file/i }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("omits the button when no action is given", () => {
    render(<EmptyState icon={Upload} title="No data yet" body="Import a file." />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
