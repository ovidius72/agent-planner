import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FeatureCreateModalRoute } from "../src/routes/feature-create-modal.route";
import { MacroTaskEditor } from "../src/components/requirements/macro-task-editor";
import { installFetchMock, jsonResponse, renderRoute } from "./fixtures";

describe("entity form modal contracts", () => {
  it("edits, removes, and reorders semantic macro-task values without exposing planner metadata", () => {
    render(<form><MacroTaskEditor initialTasks={[
      { id: "MT-001", title: "First", description: "First detail", status: "planned" },
      { id: "MT-002", title: "Second", description: "Second detail", status: "done" },
    ]} /></form>);

    fireEvent.click(screen.getByRole("button", { name: "Move macro task 2 up" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove macro task 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Add macro task" }));
    fireEvent.change(screen.getByLabelText("Macro task 2 title"), { target: { value: "New macro task" } });
    const payload = JSON.parse((document.querySelector('input[name="macroTasks"]') as HTMLInputElement).value);

    expect(payload).toEqual([
      { id: "MT-002", title: "Second", description: "Second detail", status: "done" },
      { title: "New macro task", description: "", status: "planned" },
    ]);
    expect(screen.queryByText("createdAt")).not.toBeInTheDocument();
    expect(screen.queryByText("updatedAt")).not.toBeInTheDocument();
  });

  it("keeps required feature submission in the browser until a name is present", async () => {
    const fetchMock = installFetchMock(() => jsonResponse({}));
    renderRoute([{ path: "/", element: <FeatureCreateModalRoute /> }]);

    const name = await screen.findByLabelText("Feature name");
    const form = name.closest("form");
    expect(form).not.toBeNull();
    expect(form).not.toBeValid();
    fireEvent.submit(form!);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(name, { target: { value: "A very long valid feature name that remains editable in the modal" } });
    expect(form).toBeValid();
  });

  it("provides an accessible, scrollable mobile-safe dialog shell", async () => {
    renderRoute([{ path: "/", element: <FeatureCreateModalRoute /> }]);

    const dialog = await screen.findByRole("dialog", { name: "Create feature" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveClass("max-h-[calc(100vh-2rem)]", "overflow-hidden");
    expect(screen.getByLabelText("Close modal")).toBeInTheDocument();
    expect(dialog.querySelector(".overflow-y-auto")).not.toBeNull();
  });
});
