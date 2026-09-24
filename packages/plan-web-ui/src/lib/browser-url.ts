/**
 * Update the current URL's query string in place, without a React Router
 * navigation.
 *
 * Why: routing the change through `navigate()` / `setSearchParams()` fires a
 * router navigation, which makes `<ScrollRestoration />` reset the page
 * scroll — undoing a scroll that was just done deliberately, or yanking the
 * page out from under someone typing into a filter. `history.replaceState`
 * rewrites the address bar without a router navigation, so scroll position
 * is left alone.
 *
 * Hazard: because this bypasses the router, `useSearchParams()` never
 * observes the change. A param written or cleared through this helper must
 * not be read back through `useSearchParams` — the router keeps returning
 * whatever it saw at the last real navigation for the life of the mount, so
 * that read is stale. This is what made the Work Tree's locate effect wipe
 * the search box on every keystroke (P104(F005)/T418): the effect cleared
 * filters in its body and listed them as dependencies, so the stale
 * `locate` param it kept reading back re-ran the clear on every later
 * render. There is no read-side companion here — none of today's call
 * sites read the param back, so one would ship unused. If a future one
 * needs to, read `window.location.search` directly instead of trusting
 * `useSearchParams`.
 *
 * `mutate` receives the live `URLSearchParams` for the current URL; mutate
 * it in place (`.set`, `.delete`, …). If nothing changes, no history call
 * is made.
 */
export function replaceUrlSearchParams(mutate: (params: URLSearchParams) => void): void {
  const url = new URL(window.location.href);
  const before = `${url.pathname}${url.search}${url.hash}`;
  mutate(url.searchParams);
  const after = `${url.pathname}${url.search}${url.hash}`;
  if (after === before) return;
  window.history.replaceState(window.history.state, "", after);
}
