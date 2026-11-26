import { z } from "zod";
import { createIdeaId, createShortId, formatFeatureRef, formatIdeaRef, formatPhaseRef, taskCompositeRef } from "../naming.js";
import { findIdeaByRef, findPhaseByRef, findTaskByRef, resolveFeatureRefStrict } from "../refs.js";
import { IdeaPromotionTargetTypeSchema, IdeasDocumentSchema, IdeaSchema } from "../schema.js";
import { CommandRefusal, executeCommand, publishEvent } from "./command-authority.js";
import type { PersistenceDriver } from "./driver.js";
import { readProjectLists } from "./overview.js";
import type { ProjectCaller } from "./project-access.js";

const fields = z.object({
  title: z.string().trim().optional(), description: z.string().trim().optional(),
  targetType: IdeaPromotionTargetTypeSchema.optional(), targetRef: z.string().trim().min(1).optional(),
  discussionCompleted: z.boolean().optional(), confirmed: z.boolean().optional(),
});

export function readRegisteredIdeas(driver: PersistenceDriver, projectId: string) {
  const row = driver.prepare("SELECT json_extract(metadata, '$.ideasInbox') AS document FROM projects WHERE id = ?").get(projectId);
  return IdeasDocumentSchema.parse(JSON.parse(String(row?.document ?? "{}")));
}

export interface RegisteredIdeaCommand {
  action: "create" | "update" | "delete" | "promote";
  ref?: string | undefined;
  fields: unknown;
  requestId: string;
}

export function mutateRegisteredIdea(driver: PersistenceDriver, caller: ProjectCaller, input: RegisteredIdeaCommand) {
  const { projectId } = caller;
  return executeCommand(driver, { projectId, requestId: input.requestId, operation: `idea.${input.action}`, payload: input }, ({ recordRevision }) => {
    const parsed = fields.safeParse(input.fields);
    if (!parsed.success) throw new CommandRefusal("IDEA_FIELDS_INVALID", "Provide valid idea fields.");
    const { title, description, confirmed, discussionCompleted, targetType, targetRef } = parsed.data;
    if (title === "") throw new CommandRefusal("IDEA_TITLE_REQUIRED", "An idea title is required.");
    const document = readRegisteredIdeas(driver, projectId);
    const current = input.ref ? findIdeaByRef(document.ideas, input.ref) : undefined;
    const now = new Date().toISOString();
    const save = () => {
      driver.prepare("UPDATE projects SET metadata = json_set(metadata, '$.ideasInbox', json(?)) WHERE id = ?")
        .run(JSON.stringify(document), projectId);
      recordRevision();
    };
    if (input.action === "create") {
      if (!title) throw new CommandRefusal("IDEA_TITLE_REQUIRED", "An idea title is required.");
      const model = readProjectLists(driver, projectId);
      const taken = new Set([
        ...document.ideas.map(({ shortId }) => shortId), ...model.features.map(({ shortId }) => shortId),
        ...model.phases.flatMap(({ shortId, tasks }) => [shortId, ...tasks.map((task) => task.shortId)]),
      ]);
      const number = document.ideas.reduce((next, idea) => Math.max(next, idea.number + 1), document.nextIdeaNumber);
      const id = createIdeaId();
      const idea = IdeaSchema.parse({ id, title, description, number, shortId: createShortId(taken, `idea:${id}`), createdAt: now, updatedAt: now });
      document.ideas.push(idea);
      document.nextIdeaNumber = number + 1;
      save();
      publishEvent(driver, projectId, "idea.created", { ideaId: idea.id });
      return { idea, created: true };
    }
    if (!current) throw new CommandRefusal("IDEA_NOT_FOUND", "The idea could not be resolved.");
    if (input.action === "delete") {
      if (!confirmed) throw new CommandRefusal("IDEA_DELETE_CONFIRMATION_REQUIRED", "Confirm deletion of the selected idea.");
      document.ideas = document.ideas.filter(({ id }) => id !== current.id);
      save();
      publishEvent(driver, projectId, "idea.deleted", { ideaId: current.id });
      return { deleted: true, ideaId: current.id, ideaRef: formatIdeaRef(current.number) };
    }
    if (input.action === "update") {
      const updatedFields = [...(title === undefined ? [] : ["title"]), ...(description === undefined ? [] : ["description"])];
      if (!updatedFields.length) throw new CommandRefusal("IDEA_NO_MUTABLE_FIELDS", "Provide an idea title or description.");
      const idea = { ...current, title: title ?? current.title, description: description ?? current.description, updatedAt: now };
      document.ideas = document.ideas.map((entry) => entry.id === idea.id ? idea : entry);
      save();
      publishEvent(driver, projectId, "idea.updated", { ideaId: idea.id });
      return { idea, updatedFields };
    }
    if (!discussionCompleted || !confirmed) {
      throw new CommandRefusal("IDEA_PROMOTION_CONFIRMATION_REQUIRED", "Complete the discussion and confirm the existing target.");
    }
    const target = targetType && targetRef ? resolveTarget(driver, projectId, targetType, targetRef) : undefined;
    if (!target || !targetType) throw new CommandRefusal("IDEA_PROMOTION_TARGET_NOT_FOUND", "The selected promotion target could not be resolved.");
    if (current.promotion) {
      if (current.promotion.targetType !== targetType || current.promotion.targetId !== target.id) {
        throw new CommandRefusal("IDEA_ALREADY_PROMOTED", "The idea already has a different promotion target.");
      }
      return { promoted: true, idea: current, targetRef: current.promotion.targetRef };
    }
    const idea = { ...current, promotion: { targetType, targetId: target.id, targetRef: target.ref, promotedAt: now }, updatedAt: now };
    document.ideas = document.ideas.map((entry) => entry.id === idea.id ? idea : entry);
    save();
    publishEvent(driver, projectId, "idea.promoted", { ideaId: idea.id, targetId: target.id });
    return { promoted: true, idea, targetRef: target.ref };
  }, caller);
}

function resolveTarget(driver: PersistenceDriver, projectId: string, kind: "feature" | "phase" | "task", ref: string) {
  const model = readProjectLists(driver, projectId);
  if (kind === "feature") {
    const owner = resolveFeatureRefStrict(model.features, ref);
    return owner.ok ? { id: owner.feature.id, ref: formatFeatureRef(owner.feature.number) } : undefined;
  }
  if (kind === "phase") {
    const phase = findPhaseByRef(model.phases, model.features, ref);
    return phase ? { id: phase.id, ref: formatPhaseRef(phase.number, model.features.find(({ id }) => id === phase.featureId)?.number) } : undefined;
  }
  const found = findTaskByRef(model.phases, model.features, ref);
  return found ? { id: found.task.id, ref: taskCompositeRef(found.task, found.phase, model.features) } : undefined;
}
