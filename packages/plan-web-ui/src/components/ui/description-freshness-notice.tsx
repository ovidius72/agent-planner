import { Accordion } from "./accordion";
import type { HierarchicalDescriptionFreshness } from "../../lib/types";

export function DescriptionFreshnessNotice({
  freshness,
  ownerIds,
}: {
  freshness?: HierarchicalDescriptionFreshness;
  ownerIds: string[];
}) {
  const relevant = freshness?.reconciliationPreview.filter((step) => ownerIds.includes(step.ownerId));
  if (!relevant || relevant.length === 0) return null;

  return (
    <Accordion title="Description freshness" defaultOpen={false}>
      <div className="space-y-2 text-sm">
        <div className="font-medium">Parent description review required</div>
        <p className="text-muted-foreground">
          Child context changed after its parent description. Review this preview and explicitly edit the parent only when its prose is stale; authored descriptions remain unchanged.
        </p>
        <ul className="space-y-2">
          {relevant.map((step) => (
            <li key={`${step.ownerKind}:${step.ownerId}`}>
              <span className="font-mono text-xs">{step.ownerRef}</span>
              <span className="text-muted-foreground"> after </span>
              <span className="font-mono text-xs">{step.causedByRef}</span>
              <div className="text-muted-foreground">{step.action}</div>
            </li>
          ))}
        </ul>
      </div>
    </Accordion>
  );
}
