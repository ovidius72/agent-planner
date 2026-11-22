/**
 * HTTP client for the versioned planner application API (P128(F025)/T490 C3).
 *
 * Every adapter — MCP, Pi, CLI, Web UI — talks to the local planner service
 * through this client instead of opening the plan store itself. The client is
 * transport only: it builds the URL, attaches the issued session header,
 * validates the envelope and turns an error reply into a typed
 * `PlannerApiError` carrying the stable `code` the flows define. Rendering,
 * approval text and tool-specific fallbacks stay in the adapter.
 *
 * Harness-agnostic by design: it depends on no server or Pi type, so a new
 * harness reuses it unchanged.
 */

import { PLANNER_SESSION_HEADER, type SessionRegistrationInput } from "./session-registry.js";
import type { PlannerSessionRecord } from "./index.js";

/** Mount point of the versioned application API. */
export const PLANNER_API_V2_BASE_PATH = "/api/v2";
/** Envelope version every reply must state. */
export const PLANNER_API_V2_VERSION = "2";

export type PlannerApiMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface PlannerApiClientOptions {
  /** Service origin, e.g. `http://127.0.0.1:51234`. A trailing slash is ignored. */
  baseUrl: string;
  /** Issued session id sent as `x-planner-session`; omitted until registered. */
  sessionId?: string | undefined;
  /** Per-request timeout in milliseconds. Default 15s. */
  timeoutMs?: number | undefined;
}

/**
 * A refused or failed API call. `status` is the HTTP status (0 for a transport
 * failure) and `code` is the flow's stable refusal code, so an adapter maps
 * codes — never messages — to its own output.
 */
export class PlannerApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "PlannerApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * The service failed to complete a call — a persistence/verification failure or
 * a transient writer lock. Deliberately NOT a `PlannerApiError`: adapters treat
 * a `PlannerApiError` as a domain refusal to render, while a service failure is
 * an unexpected fault that must propagate (the same thing a thrown store error
 * did before the call went over HTTP). The 5xx status is the boundary: the API
 * reserves 4xx for refusals.
 */
export class PlannerServiceFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "PlannerServiceFailure";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const ERROR_ENVELOPE_RESERVED_KEYS = new Set(["code", "message"]);
const DEFAULT_TIMEOUT_MS = 15_000;

export class PlannerApiClient {
  readonly baseUrl: string;
  #sessionId: string | undefined;
  readonly #timeoutMs: number;

  constructor(options: PlannerApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#sessionId = options.sessionId;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** The session id this client sends, when one has been issued. */
  get sessionId(): string | undefined {
    return this.#sessionId;
  }

  /** Adopt an issued session id (or clear it with `undefined`). */
  useSession(sessionId: string | undefined): void {
    this.#sessionId = sessionId;
  }

  /**
   * Register one adapter session and adopt its id. The service chooses the id;
   * the client never invents one.
   */
  async registerSession(input: SessionRegistrationInput): Promise<PlannerSessionRecord> {
    const data = await this.request<{ session: PlannerSessionRecord }>("POST", "/sessions", input);
    this.useSession(data.session.sessionId);
    return data.session;
  }

  /**
   * Perform one application call and return the envelope's `data`.
   * `path` is either absolute (`/api/v2/...`) or relative to the v2 mount.
   */
  async request<T = unknown>(method: PlannerApiMethod, path: string, body?: unknown): Promise<T> {
    const url = this.baseUrl + (path.startsWith("/api/") ? path : `${PLANNER_API_V2_BASE_PATH}${path.startsWith("/") ? "" : "/"}${path}`);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.#sessionId) headers[PLANNER_SESSION_HEADER] = this.#sessionId;

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      throw new PlannerApiError(
        0,
        "SERVICE_UNAVAILABLE",
        `Planner service is unreachable at ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const raw = await response.text();
    let parsed: unknown = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
    }
    const envelope = (parsed ?? {}) as { apiVersion?: unknown; data?: unknown; error?: unknown };
    if (envelope.apiVersion !== PLANNER_API_V2_VERSION) {
      throw new PlannerApiError(
        response.status,
        "API_VERSION_MISMATCH",
        `Planner service replied without API version ${PLANNER_API_V2_VERSION} (received ${String(envelope.apiVersion)}).`,
        { expectedApiVersion: PLANNER_API_V2_VERSION, receivedApiVersion: envelope.apiVersion ?? null },
      );
    }
    if (!response.ok || envelope.error !== undefined) {
      const refusal = plannerApiErrorFrom(response.status, envelope.error);
      // 4xx is a refusal the adapter renders; 5xx is a fault the service could
      // not complete, so it keeps propagating as an unexpected failure.
      if (response.status >= 500) {
        throw new PlannerServiceFailure(refusal.status, refusal.code, refusal.message, refusal.details);
      }
      throw refusal;
    }
    return envelope.data as T;
  }
}

function plannerApiErrorFrom(status: number, rawError: unknown): PlannerApiError {
  const error = (rawError ?? {}) as Record<string, unknown>;
  const code = typeof error.code === "string" && error.code ? error.code : "PLANNER_API_ERROR";
  const message = typeof error.message === "string" && error.message
    ? error.message
    : `Planner API request failed with status ${status}.`;
  const details: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(error)) {
    if (!ERROR_ENVELOPE_RESERVED_KEYS.has(key)) details[key] = value;
  }
  return new PlannerApiError(status, code, message, details);
}

/** True when the failure is the named flow refusal. */
export function isPlannerApiRefusal(error: unknown, code: string): error is PlannerApiError {
  return error instanceof PlannerApiError && error.code === code;
}
