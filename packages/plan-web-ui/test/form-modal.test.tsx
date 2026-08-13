import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FeatureCreateModalRoute } from "../src/routes/feature-create-modal.route";
import { installFetchMock, jsonResponse, renderRoute } from "./fixtures";

describe("entity form modal contracts", () => {
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
