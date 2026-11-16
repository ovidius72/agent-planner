/**
 * Service authentication seam (P128(F025)/T490, architecture.md §6).
 *
 * One middleware with pluggable strategies resolves a principal for every
 * request; permissions come from the principal, never from the request
 * being local or from a caller-supplied header. Today's strategy is the
 * loopback strategy: the service binds 127.0.0.1 only, the Host header
 * must name the loopback interface (DNS rebinding defense), and writes and
 * WebSocket upgrades are accepted only from the Agent Plan UI and Heca
 * origins. Per-device token pairing slots into AuthStrategy later without
 * touching handlers.
 *
 * Honest boundary (recorded on T490): on loopback a request's Origin
 * header is evidence, not a credential — a local process can forge it.
 * Structural impersonation resistance arrives with pairing tokens; the
 * strategy seam is where that lands.
 */

export type PrincipalKind = "agent" | "web-ui" | "heca";

export interface Principal {
  principalId: string;
  kind: PrincipalKind;
  /** The verified Origin that produced a browser-kind principal, if any. */
  origin?: string | undefined;
}

/** Everything a strategy may look at. The request already passed Host/Origin checks. */
export interface RequestIdentity {
  method: string;
  path: string;
  origin: string | undefined;
  serviceOrigin: string | undefined;
  allowedOrigins: readonly string[];
}

export interface AuthStrategy {
  /** The principal for this request, or null to refuse it (401). */
  resolvePrincipal(identity: RequestIdentity): Principal | null;
}

/** Methods that can change state — the ones the Origin allow-list guards. */
export const MUTATION_METHODS: readonly string[] = ["POST", "PUT", "PATCH", "DELETE"];

export function isLoopbackHostname(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return name === "localhost" || name === "127.0.0.1";
}

/**
 * HTTP/1.1 requires Host; it must name the loopback interface, with or
 * without port, or the request is refused (DNS rebinding defense).
 */
export function hostHeaderIsLoopback(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const hostname = hostHeader.replace(/:\d+$/, "");
  return isLoopbackHostname(hostname);
}

function originParts(origin: string): { hostname: string; port: string } | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return { hostname: url.hostname, port: url.port };
  } catch {
    return null;
  }
}

/**
 * The Agent Plan UI may address the service as 127.0.0.1 or localhost; both
 * name the same service when they resolve to it (same host, or same port
 * across the two loopback names).
 */
function isServiceOriginVariant(origin: string, serviceOrigin: string | undefined): boolean {
  const candidate = originParts(origin);
  if (!candidate || !isLoopbackHostname(candidate.hostname)) return false;
  if (!serviceOrigin) return true; // port not yet known: the loopback name is the evidence
  const service = originParts(serviceOrigin);
  if (!service) return false;
  return candidate.hostname === service.hostname || (candidate.port !== "" && candidate.port === service.port);
}

/** Whether an Origin header is acceptable. Absent Origin = non-browser client (agents, curl). */
export function originIsAllowed(
  origin: string | undefined,
  serviceOrigin: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  return isServiceOriginVariant(origin, serviceOrigin);
}

/**
 * The default loopback strategy: every request that survived Host/Origin
 * checks resolves to a local principal. Browser-originated requests (the
 * Agent Plan UI, Heca) keep their kind; header-less clients are agents.
 */
export function loopbackAuthStrategy(): AuthStrategy {
  return {
    resolvePrincipal(identity) {
      let kind: PrincipalKind = "agent";
      if (identity.origin && isServiceOriginVariant(identity.origin, identity.serviceOrigin)) kind = "web-ui";
      else if (identity.origin && identity.allowedOrigins.includes(identity.origin)) kind = "heca";
      return { principalId: `loopback:${kind}`, kind, origin: identity.origin };
    },
  };
}
