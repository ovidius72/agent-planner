import { Form, useLocation } from "react-router-dom";
import { Button } from "./button";
import { FormattedText } from "./formatted-text";
import type { AcceptedDecision } from "../../lib/types";
import type { AcceptedDecisionTargetType } from "../../lib/api";

export interface AcceptedDecisionsListProps {
  decisions: AcceptedDecision[];
  targetType?: AcceptedDecisionTargetType;
  targetRef?: string | undefined;
}

function HiddenTargetFields({ targetType, targetRef, returnTo }: { targetType: AcceptedDecisionTargetType; targetRef?: string | undefined; returnTo: string }) {
  return (
    <>
      <input type="hidden" name="targetType" value={targetType} />
      {targetRef ? <input type="hidden" name="targetRef" value={targetRef} /> : null}
      <input type="hidden" name="returnTo" value={returnTo} />
    </>
  );
}

function DecisionFields({ decision }: { decision?: AcceptedDecision }) {
  return (
    <div className="grid gap-2">
      <label className="grid gap-1 text-sm font-medium text-[var(--text)]">
        Title
        <input name="title" required defaultValue={decision?.title ?? ""} className="field-control" />
      </label>
      <label className="grid gap-1 text-sm font-medium text-[var(--text)]">
        Decision
        <textarea name="decision" defaultValue={decision?.decision ?? ""} className="field-control field-textarea min-h-20" />
      </label>
      <label className="grid gap-1 text-sm font-medium text-[var(--text)]">
        Rationale
        <textarea name="rationale" defaultValue={decision?.rationale ?? ""} className="field-control field-textarea min-h-20" />
      </label>
      <label className="grid gap-1 text-sm font-medium text-[var(--text)]">
        Implementation notes
        <textarea name="implementationNotes" defaultValue={decision?.implementationNotes ?? ""} className="field-control field-textarea min-h-20" />
      </label>
    </div>
  );
}

function AcceptedDecisionManagement({ targetType, targetRef, returnTo }: { targetType: AcceptedDecisionTargetType; targetRef?: string | undefined; returnTo: string }) {
  return (
    <details className="surface-card px-4 py-3">
      <summary className="cursor-pointer select-none text-sm font-semibold text-[var(--text)]">Add accepted decision</summary>
      <Form method="post" action="/accepted-decisions" className="mt-3 grid gap-3">
        <HiddenTargetFields targetType={targetType} targetRef={targetRef} returnTo={returnTo} />
        <input type="hidden" name="intent" value="create" />
        <DecisionFields />
        <Button type="submit" variant="primary" className="justify-self-start">Add decision</Button>
      </Form>
    </details>
  );
}

function AcceptedDecisionActions({ entry, targetType, targetRef, returnTo }: { entry: AcceptedDecision; targetType: AcceptedDecisionTargetType; targetRef?: string | undefined; returnTo: string }) {
  return (
    <details className="mt-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2">
      <summary className="cursor-pointer select-none text-sm font-semibold text-[var(--text)]">Manage decision</summary>
      <div className="mt-3 grid gap-3">
        <Form method="post" action="/accepted-decisions" className="grid gap-3">
          <HiddenTargetFields targetType={targetType} targetRef={targetRef} returnTo={returnTo} />
          <input type="hidden" name="intent" value="update" />
          <input type="hidden" name="decisionId" value={entry.id} />
          <DecisionFields decision={entry} />
          <Button type="submit" variant="secondary" className="justify-self-start">Save decision</Button>
        </Form>
        <Form
          method="post"
          action="/accepted-decisions"
          onSubmit={(event) => {
            if (!window.confirm(`Delete accepted decision “${entry.title}”? This cannot be undone.`)) event.preventDefault();
          }}
        >
          <HiddenTargetFields targetType={targetType} targetRef={targetRef} returnTo={returnTo} />
          <input type="hidden" name="intent" value="delete" />
          <input type="hidden" name="decisionId" value={entry.id} />
          <Button type="submit" variant="danger">Delete decision</Button>
        </Form>
      </div>
    </details>
  );
}

export function AcceptedDecisionsList({ decisions, targetType, targetRef }: AcceptedDecisionsListProps) {
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  const canManage = Boolean(targetType);
  if (decisions.length === 0 && !canManage) return null;

  return (
    <details key={location.key} className="group mt-4">
      <summary className="flex cursor-pointer select-none items-center gap-2 font-semibold text-[var(--text)]">
        <span>Accepted decisions ({decisions.length})</span>
      </summary>
      <div className="mt-2 grid gap-3">
        {canManage && targetType ? <AcceptedDecisionManagement targetType={targetType} targetRef={targetRef} returnTo={returnTo} /> : null}
        {decisions.map((entry) => (
          <div key={entry.id} className="surface-card px-4 py-3">
            <p className="text-sm font-semibold text-[var(--text)]">{entry.title}</p>
            {entry.decision ? (
              <div className="mt-2 text-sm text-[var(--text-muted)]">
                <span className="font-semibold text-[var(--text)]">Decision:</span>
                <FormattedText text={entry.decision} className="mt-1" />
              </div>
            ) : null}
            {entry.rationale ? (
              <div className="mt-1 text-sm text-[var(--text-muted)]">
                <span className="font-semibold text-[var(--text)]">Rationale:</span>
                <FormattedText text={entry.rationale} className="mt-1" />
              </div>
            ) : null}
            {entry.implementationNotes ? (
              <div className="mt-1 text-sm text-[var(--text-muted)]">
                <span className="font-semibold text-[var(--text)]">Implementation:</span>
                <FormattedText text={entry.implementationNotes} className="mt-1" />
              </div>
            ) : null}
            {canManage && targetType ? <AcceptedDecisionActions entry={entry} targetType={targetType} targetRef={targetRef} returnTo={returnTo} /> : null}
          </div>
        ))}
      </div>
    </details>
  );
}
