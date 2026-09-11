import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DescriptionFreshnessNotice } from "../src/components/ui/description-freshness-notice";
import type { HierarchicalDescriptionFreshness } from "../src/lib/types";

const freshness: HierarchicalDescriptionFreshness = {
  diagnostics: [],
  staleParentRefs: ["P001(F001)", "F001"],
  reconciliationRequired: true,
  reconciliationPreview: [
    {
      ownerKind: "phase",
      ownerId: "phase-1",
      ownerRef: "P001(F001)",
      causedByRef: "P001(F001)/T001",
      reason: "The phase description is stale.",
      action: "Read P001(F001)/T001, review P001(F001), then explicitly update P001(F001)'s description or descriptionRef if the parent prose is stale.",
    },
    {
      ownerKind: "feature",
      ownerId: "feature-1",
      ownerRef: "F001",
      causedByRef: "P001(F001)/T001",
      reason: "The feature description is stale.",
      action: "Read P001(F001)/T001, review F001, then explicitly update F001's description or descriptionRef if the parent prose is stale.",
    },
  ],
};

describe("DescriptionFreshnessNotice", () => {
  it("shows only relevant parent reconciliation steps and promises no silent overwrite", () => {
    render(<DescriptionFreshnessNotice freshness={freshness} ownerIds={["phase-1"]} />);
    expect(screen.getByText("Description freshness")).toBeInTheDocument();
    expect(screen.getByText("Parent description review required")).toBeInTheDocument();
    expect(screen.getByText(/authored descriptions remain unchanged/)).toBeInTheDocument();
    expect(screen.getByText("P001(F001)")).toBeInTheDocument();
    expect(screen.queryByText("F001")).not.toBeInTheDocument();
  });

  it("renders nothing when the current surface has no stale parent", () => {
    const { container } = render(<DescriptionFreshnessNotice freshness={freshness} ownerIds={["unrelated"]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
