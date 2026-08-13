import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getFeatures } from "../src/lib/api";
import { installFetchMock, jsonResponse, makeFeature, renderRoute } from "./fixtures";

describe("Web UI test environment", () => {
  it("runs browser-route loaders against deterministic API fixtures", async () => {
    const feature = makeFeature({ name: "Fixture feature" });
    const fetchMock = installFetchMock((path) => {
      expect(path).toBe("/api/features");
      return jsonResponse([feature]);
    });

    renderRoute([
      {
        path: "/",
        loader: getFeatures,
        element: <p>Route fixture loaded</p>,
      },
    ]);

    expect(await screen.findByText("Route fixture loaded")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
