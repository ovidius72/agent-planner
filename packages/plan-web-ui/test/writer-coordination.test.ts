import { describe, expect, it } from "vitest";
import { responseErrorMessage } from "../src/app/root";

describe("planner writer coordination diagnostics", () => {
  it("extracts the typed PLAN_WRITER_BUSY message returned by the plan server", () => {
    const message = "PLAN_WRITER_BUSY: another process is mutating this planner root. Read-only operations remain available.";
    expect(responseErrorMessage(JSON.stringify({
      error: "PLAN_WRITER_BUSY",
      message,
      details: { errorCode: "PLAN_WRITER_BUSY" },
    }), "Locked")).toBe(message);
  });

  it("preserves plain server diagnostics and falls back for empty payloads", () => {
    expect(responseErrorMessage("Validation failed", "Request failed")).toBe("Validation failed");
    expect(responseErrorMessage(undefined, "Request failed")).toBe("Request failed");
  });
});
