import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FeatureCreateModalRoute } from "../src/routes/feature-create-modal.route";
import { FeatureEditModalRoute } from "../src/routes/feature-edit-modal.route";
import { PhaseEditModalRoute } from "../src/routes/phase-edit-modal.route";
import { TaskEditModalRoute } from "../src/routes/task-edit-modal.route";
import { RequirementCreateModalRoute } from "../src/routes/requirement-create-modal.route";
import { RequirementEditModalRoute } from "../src/routes/requirement-edit-modal.route";
import { MacroTaskEditor } from "../src/components/requirements/macro-task-editor";
import { installFetchMock, jsonResponse, makeFeature, makePhase, makeRequirement, makeTask, renderRoute } from "./fixtures";

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

  it("keeps Requirement lifecycle status out of create and edit surfaces", async () => {
    const phase = makePhase();
    const createView = renderRoute([{
      id: "requirements",
      path: "/",
      loader: () => ({ phases: [phase], requirements: [] }),
      element: <RequirementCreateModalRoute />,
    }]);
    expect(await screen.findByRole("dialog", { name: "Create requirement" })).toHaveTextContent("Coding standards and process rules belong in Project Guidelines");
    expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
    createView.unmount();
    await createView.router.dispose();

    const requirement = makeRequirement();
    renderRoute([{
      id: "requirements",
      path: "/requirements/:requirementId",
      loader: () => ({ phases: [phase], requirements: [requirement] }),
      element: <RequirementEditModalRoute />,
    }], `/requirements/${requirement.id}`);
    expect(await screen.findByRole("dialog", { name: "Edit requirement" })).toHaveTextContent("Coding standards and process rules belong in Project Guidelines");
    expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
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

  it("exposes canonical context fields while keeping derived parent statuses read-only", async () => {
    const feature = makeFeature({ descriptionRef: ".planner/docs/features/feature.md" });
    const featureView = renderRoute([{
      id: "feature-detail",
      path: "/",
      loader: () => ({ feature, phases: [] }),
      element: <FeatureEditModalRoute />,
    }]);
    expect(await screen.findByLabelText("Description reference")).toHaveValue(".planner/docs/features/feature.md");
    expect(screen.getByLabelText("Status")).toBeDisabled();
    featureView.unmount();
    await featureView.router.dispose();

    const targetFeature = makeFeature({ id: "feature-2", number: 2, name: "Target feature" });
    const phase = makePhase({ descriptionRef: ".planner/docs/phases/phase.md", decisions: ["Preserve parity"] });
    const phaseView = renderRoute([{
      id: "phase-detail",
      path: "/",
      loader: () => ({ feature, features: [feature, targetFeature], phase }),
      element: <PhaseEditModalRoute />,
    }]);
    expect(await screen.findByLabelText("Feature")).toHaveValue(feature.id);
    expect(screen.getByRole("option", { name: "F002 — Target feature" })).toBeInTheDocument();
    expect(screen.getByLabelText("Description reference")).toHaveValue(".planner/docs/phases/phase.md");
    expect(screen.getByLabelText("Decisions (one per line)")).toHaveValue("Preserve parity");
    expect(screen.getByLabelText("Status")).toBeDisabled();
    phaseView.unmount();
    await phaseView.router.dispose();

    const task = makeTask({ descriptionRef: ".planner/docs/tasks/task.md", notes: "Implementation context", decisions: ["Use semantic fields"] });
    renderRoute([{
      id: "task-detail",
      path: "/",
      loader: () => ({ feature, phase, task }),
      element: <TaskEditModalRoute />,
    }]);
    expect(await screen.findByLabelText("Description reference")).toHaveValue(".planner/docs/tasks/task.md");
    expect(screen.getByLabelText("Implementation notes")).toHaveValue("Implementation context");
    expect(screen.getByLabelText("Decisions (one per line)")).toHaveValue("Use semantic fields");
    expect(screen.getByLabelText("Status change motivation")).toBeInTheDocument();
  });
});
