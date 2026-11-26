/**
 * SQLite persistence family (P128(F025)/T502).
 *
 * Exposed as the package subpath `@agent-plan/core/persistence` so the main
 * entry stays dependency-free: this module is the only place that loads
 * `node:sqlite`. Consumers: T496 (consistency) and T490 (application
 * service); no client opens a database directly.
 */

export * from "./driver.js";
export * from "./node-sqlite-driver.js";
export * from "./schema.js";
export * from "./command-authority.js";
export * from "./documents.js";
export * from "./reconciliation.js";
export * from "./snapshot.js";
export * from "./project-access.js";
export * from "./project-session.js";
export * from "./overview.js";
export * from "./project-context.js";
export * from "./task-execution.js";
export * from "./board.js";
export * from "./entity-create.js";
export * from "./entity-update.js";
export * from "./entity-delete.js";
export * from "./entity-reorder.js";
export * from "./requirements.js";
export * from "./decisions.js";
export * from "./task-dependencies.js";
export * from "./project-settings.js";
export * from "./task-move.js";
export * from "./recommendation.js";
export * from "./handoffs.js";
export * from "./handoff-write.js";
export * from "./ideas.js";
