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
export * from "./snapshot.js";
