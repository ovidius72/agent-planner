/**
 * T306 (P072/F005) — pagination helpers for Pi list commands.
 *
 * Pure-logic unit tests: the helpers only depend on the `ctx.ui` surface
 * (select / notify / input), so a controllable fake context is enough — no
 * real Pi host, no real .planner. Verifies the scroll-containment contract:
 * every page stays within `pageSize` (default 10) and long lists page forward
 * and backward, while short lists fall through to a single call (no regression).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { paginatedSelect, paginatedNotify } from "../dist/ui/paginate.js";

const NEXT = "› Next page";
const PREV = "‹ Prev page";

function makeCtx(overrides = {}) {
  const calls = { selects: [], notifies: [], inputs: [] };
  const ctx = {
    calls,
    ui: {
      select: async (title, options) => {
        calls.selects.push({ title, options });
        return overrides.select ? overrides.select(title, options) : options[0];
      },
      notify: (message, type) => {
        calls.notifies.push({ message, type });
      },
      input: async (prompt) => {
        calls.inputs.push({ prompt });
        return overrides.input ? overrides.input(prompt) : "";
      },
    },
  };
  return ctx;
}

test("short list (<= pageSize) uses a single select and returns the chosen item", async () => {
  const items = [1, 2, 3, 4, 5].map((n) => ({ n }));
  const ctx = makeCtx({ select: (_title, opts) => opts[2] }); // pick the 3rd label
  const chosen = await paginatedSelect(ctx, { title: "T", items, render: (i) => `i${i.n}`, pageSize: 10 });
  assert.equal(ctx.calls.selects.length, 1);
  assert.equal(chosen.n, 3);
});

test("long list paginates forward and returns an item on a later page", async () => {
  const items = Array.from({ length: 25 }, (_, i) => ({ n: i + 1 }));
  const ctx = makeCtx({
    select: (_title, opts) =>
      opts.some((o) => o.startsWith(NEXT)) ? opts.find((o) => o.startsWith(NEXT)) : opts[0],
  });
  const chosen = await paginatedSelect(ctx, { title: "T", items, render: (i) => `i${i.n}`, pageSize: 10 });
  assert.equal(ctx.calls.selects.length, 3); // page 1 (Next), page 2 (Next), page 3 (pick)
  assert.equal(chosen.n, 21); // first item of the 3rd page
});

test("long list navigates backward via Prev", async () => {
  const items = Array.from({ length: 25 }, (_, i) => ({ n: i + 1 }));
  const seq = ["next", "prev", "pick"];
  let k = 0;
  const ctx = makeCtx({
    select: (_title, opts) => {
      const act = seq[k++] ?? "pickFirst";
      if (act === "next") return opts.find((o) => o.startsWith(NEXT));
      if (act === "prev") return opts.find((o) => o === PREV);
      return opts[2]; // pick 3rd label of the current page
    },
  });
  const chosen = await paginatedSelect(ctx, { title: "T", items, render: (i) => `i${i.n}`, pageSize: 10 });
  assert.equal(ctx.calls.selects.length, 3); // next, prev, pick
  assert.equal(chosen.n, 3); // 3rd label of page 1
});

test("every page never exceeds pageSize", async () => {
  const items = Array.from({ length: 23 }, (_, i) => ({ n: i + 1 }));
  const ctx = makeCtx({
    select: (_title, opts) => (opts.some((o) => o.startsWith(NEXT)) ? opts.find((o) => o.startsWith(NEXT)) : opts[0]),
  });
  await paginatedSelect(ctx, { title: "T", items, render: (i) => `i${i.n}`, pageSize: 10 });
  for (const { options } of ctx.calls.selects) {
    // options include at most one navigation sentinel, so real items per page <= pageSize
    const navSentinels = options.filter((o) => o.startsWith(NEXT) || o === PREV).length;
    assert.ok(options.length - navSentinels <= 10, `page had ${options.length - navSentinels} items`);
  }
});

test("empty items return null with no select call", async () => {
  const ctx = makeCtx();
  const r = await paginatedSelect(ctx, { title: "T", items: [], render: (i) => `${i}`, pageSize: 10 });
  assert.equal(r, null);
  assert.equal(ctx.calls.selects.length, 0);
});

test("paginatedNotify short list emits a single notify", async () => {
  const ctx = makeCtx();
  await paginatedNotify(ctx, { title: "features", lines: ["a", "b", "c"], pageSize: 10 });
  assert.equal(ctx.calls.notifies.length, 1);
  assert.equal(ctx.calls.inputs.length, 0);
});

test("paginatedNotify long list pages with input prompts and stops at the end", async () => {
  const lines = Array.from({ length: 25 }, (_, i) => `L${i + 1}`);
  let n = 0;
  const ctx = makeCtx({ input: () => (++n >= 3 ? "q" : "") }); // advance twice, quit on 3rd
  await paginatedNotify(ctx, { title: "features", lines, pageSize: 10 });
  assert.equal(ctx.calls.notifies.length, 3); // 3 pages, each notified once
  assert.equal(ctx.calls.inputs.length, 2); // prompt only before pages 1 and 2
  assert.match(ctx.calls.notifies[0].message, /page 1\/3/);
  assert.match(ctx.calls.notifies[2].message, /page 3\/3/);
});

test("paginatedNotify empty list emits a single no-op notify", async () => {
  const ctx = makeCtx();
  await paginatedNotify(ctx, { title: "features", lines: [], pageSize: 10 });
  assert.equal(ctx.calls.notifies.length, 1);
  assert.match(ctx.calls.notifies[0].message, /no features/);
});
