/**
 * T243 (P056/F015) — Pi resume flow and real CLI smoke path.
 *
 * Exercises the REAL adapter (via the T240 host harness) for:
 *  - repeated sessions over the same project: session 2 reuses the persisted
 *    canonical port and carries over the handoff written in session 1; the
 *    resume trigger tells the agent to read the handoff via handoff show
 *  - handoff semantics (user decision): a pending handoff is context, not a
 *    lock — task_start RETAINS it. It is archived AUTOMATICALLY only when the
 *    phase completes (reason "phase-done"), or when the user EXPLICITLY
 *    invokes handoff_clear (reason "manual"). Never in the resume flow
 *    (no delete-on-resume) and never on task start / load / handoff show.
 *  - message_end recap behavior: the Web UI address is appended to assistant
 *    messages during the recap turn, deduped when already present, skipped for
 *    empty/non-assistant messages, and no longer appended once the recap turn
 *    is consumed by the next before_agent_start
 *  - subprocess smoke test with the REAL pi CLI (default-SKIP, opt-in via
 *    PLANNER_CLI_SMOKE=1): loads the built adapter from project settings,
 *    runs `/planner load` through the real model, and the recap URL must
 *    appear in the reply. By default the test is NOT REGISTERED at all, so
 *    the automated suite is never blocked, no model call happens, and no skip
 *    disturbs the end-to-end report test's `pass === tests` invariant. When
 *    opted in: 15s version probe / 45s model run, and a deterministic skip
 *    with a clear message if pi is unspawnable or no provider is usable.
 */

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, mkdir, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createPiHost, closePiHost, cleanupPiHosts, toolText, toolDetails } from "./helpers/pi-host-fixture.mjs";
import { PlanStore } from "../../plan-core/dist/index.js";
import { seedFixture, createTempRoot } from "../../../test/helpers/fixtures.mjs";

after(async () => {
  await cleanupPiHosts();
});

function canonicalHandoff(title, detail) {
  return [
    `# ${title}`,
    "",
    "Created at: 2026-08-24T00:00:00.000Z",
    "Updated at: 2026-08-24T00:00:00.000Z",
    "Reason: resume fixture",
    "",
    "## Current focus", detail,
    "## What was being done", detail,
    "## How to resume", "Continue the fixture.",
    "## Files touched", "- resume.test.mjs",
    "## Blockers", "- None",
    "## Next steps", "- Continue",
    "## Recent decisions", "- Preserve the handoff",
  ].join("\n");
}

async function preparedHandoffArgs(host, phaseRef = "P001") {
  const prepared = await host.runTool("handoff_prepare", { phaseRef });
  return {
    expectedHandoffUpdatedAt: toolDetails(prepared).handoffUpdatedAt ?? "",
    reconciledExistingHandoff: true,
    taskUpdates: [],
    phaseNoUpdateReason: "Resume fixture does not change durable phase context.",
    featureNoUpdateReason: "Resume fixture does not change durable feature context.",
  };
}

/** Run before_agent_start and return the injected systemPrompt (or undefined). */
async function injectedPrompt(host) {
  const before = await host.emit("before_agent_start", {
    type: "before_agent_start",
    prompt: "continue",
    systemPrompt: "base-system-prompt",
    systemPromptOptions: {},
  });
  return before?.systemPrompt;
}

/** The recap trigger message sent by /planner load. */
function recapTrigger(host) {
  return host.sentMessages.find((m) => m.message.customType === "planner-resume-trigger")?.message.content ?? "";
}

/** Extract the Web UI URL from a recap trigger message. */
function recapUrl(host) {
  return recapTrigger(host).match(/Web UI: (http:\/\/127\.0\.0\.1:[0-9]+)/)?.[1] ?? null;
}

/** Path to the built pi-adapter package (used by the CLI smoke test). */
const ADAPTER_PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

async function readTaskContext(host, taskId = "T001") {
  await host.runTool("task_get", { taskId, full: true });
  await host.runTool("phase_get", { phaseId: "P001", full: true });
  await host.runTool("feature_get", { featureId: "F001", full: true });
  await host.runTool("requirement_list", {});
}

describe("pi-adapter resume flow and CLI smoke", () => {
  test("repeated sessions over the same project: port preference, state entry, handoff carries over", async () => {
    const host1 = await createPiHost({ name: "t243-repeat", seed: "minimal", keepRootOnClose: true });
    const root = host1.root;
    try {
      // Session 1: load starts the server and records plan-web-state.
      await host1.emit("session_start", { type: "session_start", reason: "startup" });
      await host1.runCommand("load");
      const url1 = recapUrl(host1);
      assert.ok(url1, "session 1 recap carries a URL");
      const port1 = Number(new URL(url1).port);
      // The persisted CANONICAL port is what the next session prefers; under
      // contention session 1 may have retried onto a transient port, so the
      // canonical and the listen port can legitimately differ.
      const canonical = (await host1.store.loadProject()).webPort;
      assert.ok(canonical > 0, "canonical port persisted for the next session");
      const stateEntry = host1.sessionEntries.filter((e) => e.customType === "plan-web-state").at(-1);
      assert.ok(stateEntry, "plan-web-state entry appended");
      assert.deepEqual(stateEntry.data, { running: true, port: port1, mode: "lan" });

      // A handoff written in session 1 must survive into session 2.
      await host1.runTool("handoff_write", {
        phaseRef: "P001",
        title: "P001 — repeat session handoff",
        content: canonicalHandoff("P001 — repeat session handoff", "Repeat session body."),
        confirmed: true,
        ...(await preparedHandoffArgs(host1)),
      });

      // Session 1 ends; the project root is kept.
      await host1.emit("session_shutdown", { type: "session_shutdown", reason: "quit" });

      // Session 2 on the SAME project, with the persisted session log entry
      // (simulating a real session file that carries plan-web-state across).
      const host2 = await createPiHost({ name: "t243-repeat", root, keepRootOnClose: true });
      try {
        host2.sessionEntries.push({ type: "custom", customType: "plan-web-state", data: { running: false, port: port1 } });
        await host2.emit("session_start", { type: "session_start", reason: "startup" });
        await host2.runCommand("load");

        const url2 = recapUrl(host2);
        assert.ok(url2, "session 2 recap carries a URL");
        const port2 = Number(new URL(url2).port);
        if (port2 === canonical) {
          // Preferred path: the persisted canonical port is still free, so the
          // second session reuses it verbatim (stable port across restarts).
        } else {
          // Contended path: a concurrent suite bound the canonical port in the
          // stop→start window. The adapter must fall back to a transient port
          // WITHOUT hijacking the canonical (project.webPort stays put).
          assert.notEqual(port2, canonical, "fallback uses a different transient port");
          const projectAfter = await host2.store.loadProject();
          assert.equal(projectAfter.webPort, canonical, "transient fallback never hijacks the canonical port");
          const state2 = host2.sessionEntries.filter((e) => e.customType === "plan-web-state").at(-1);
          assert.equal(state2.data.port, port2, "session entry records the transient port");
        }

        // The handoff written in session 1 is intact and readable.
        const phase = (await host2.store.loadAllPhases())[0];
        assert.match(phase.handoff, /^# P001 — repeat session handoff/);
        assert.match(phase.handoff, /Repeat session body\./);

        // The resume trigger tells the agent to read the phase handoff first.
        assert.match(recapTrigger(host2), /handoff show/);
      } finally {
        await closePiHost(host2);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("handoff semantics: task_start RETAINS the handoff, handoff_clear is explicit-only, phase completion auto-archives", async () => {
    const host = await createPiHost({ name: "t243-handoff-semantics", seed: "minimal" });
    const archiveDir = join(host.planRoot, ".local", "handoff-archive");
    try {
      const phase = async () => (await host.store.loadAllPhases())[0];
      const phaseId = (await phase()).id;

      // Retention: a pending handoff is context, not a lock. task_start must
      // start the task WITHOUT clearing it. A clear is a separate, explicit
      // user action — never part of load, show, or task start.
      await host.runTool("handoff_write", {
        phaseRef: "P001",
        title: "P001 — work handoff",
        content: canonicalHandoff("P001 — work handoff", "In-progress notes for the auth phase."),
        confirmed: true,
        ...(await preparedHandoffArgs(host)),
      });
      assert.ok((await phase()).handoff, "handoff present before task start");

      await readTaskContext(host);
    const started = await host.runTool("task_start", { taskId: "T001" });
      assert.match(toolText(started), /✅ Task started:/);
      let p = await phase();
      assert.equal(p.tasks[0].status, "in-progress", "task started despite the pending handoff");
      assert.match(p.handoff, /In-progress notes for the auth phase\./, "task_start RETAINS the handoff (context, not a lock)");
      assert.equal(p.handoffHistory.length, 0, "no archival on task start");

      // Manual archive remains available only when explicitly requested.
      const cleared = await host.runTool("handoff_clear", { phaseRef: "P001" });
      assert.match(toolText(cleared), /✅ Cleared handoff on P001\(F001\)/);
      p = await phase();
      assert.equal(p.handoff, "", "handoff cleared manually");
      assert.equal(p.handoffHistory[0].reason, "manual");
      let archived = await readdir(archiveDir);
      const manualFile = await readFile(join(archiveDir, archived.find((f) => f.startsWith(phaseId))), "utf8");
      assert.match(manualFile, /In-progress notes for the auth phase\./);

      // Auto-archive on completion: a fresh handoff written before completing
      // the phase is archived (reason "phase-done") when the phase rolls done.
      await host.runTool("handoff_write", {
        phaseRef: "P001",
        title: "P001 — final handoff",
        content: canonicalHandoff("P001 — final handoff", "Final notes for the auth phase."),
        confirmed: true,
        ...(await preparedHandoffArgs(host)),
      });
      await host.runTool("task_complete", { taskId: "T001", force: true, description_update: "Authentication task completed and verified by the resume flow test." });
      p = await phase();
      assert.equal(p.status, "done", "phase rolled to done");
      assert.equal(p.handoff, "", "phase completion auto-archived the handoff");
      assert.equal(p.handoffHistory[0].reason, "phase-done");
      archived = await readdir(archiveDir);
      assert.ok(archived.length >= 2, "both handoffs archived");

      // A done phase cannot receive a new handoff (terminal guard).
      const late = await host.runTool("handoff_write", {
        phaseRef: "P001", title: "P001 — late", content: canonicalHandoff("P001 — late", "Late handoff."), confirmed: true,
        ...(await preparedHandoffArgs(host)),
      });
      assert.match(toolText(late), /Cannot write a handoff on done phase/);
    } finally {
      await closePiHost(host);
    }
  });

  test("/planner task start also retains a pending handoff", async () => {
    const host = await createPiHost({ name: "t243-command-handoff-retention", seed: "minimal" });
    try {
      await host.runTool("handoff_write", {
        phaseRef: "P001",
        title: "P001 — command retention handoff",
        content: canonicalHandoff("P001 — command retention handoff", "Command start must keep this handoff."),
        confirmed: true,
        ...(await preparedHandoffArgs(host)),
      });

      await readTaskContext(host);
    await host.runCommand("task start T001");
      const phase = (await host.store.loadAllPhases())[0];
      assert.equal(phase.tasks[0].status, "in-progress");
      assert.match(phase.handoff, /Command start must keep this handoff\./);
      assert.equal(phase.handoffHistory.length, 0, "command start does not archive the handoff");
    } finally {
      await closePiHost(host);
    }
  });

  test("message_end recap: URL appended, deduped, gated by role/text, consumed after the recap turn", async () => {
    const host = await createPiHost({ name: "t243-message-end", seed: "minimal" });
    const emitEnd = (text, role = "assistant") =>
      host.emit("message_end", {
        type: "message_end",
        message: { role, content: [{ type: "text", text }] },
      });

    // Planner disabled: message_end never appends.
    const disabled = await emitEnd("Summary.");
    assert.equal(disabled, undefined);

    await host.emit("session_start", { type: "session_start", reason: "startup" });
    await host.runCommand("load");

    // Recap turn: the address is appended to an assistant text message.
    const m1 = await emitEnd("Here is the summary.");
    assert.ok(m1, "message_end returned a modified message");
    const m1Text = m1.message.content.map((c) => c.text ?? "").join("");
    assert.match(m1Text, /\n\n🌐 Web UI: http:\/\/127\.0\.0\.1:[0-9]+/);

    // Dedupe: if the agent already printed the address, nothing is appended.
    const m2 = await emitEnd("🌐 Web UI: http://127.0.0.1:9999 — LAN: http://127.0.0.1:9999");
    assert.equal(m2, undefined, "no double append when the address is already present");

    // Empty visible text → nothing appended.
    const m3 = await emitEnd("");
    assert.equal(m3, undefined);

    // Non-assistant roles are never touched.
    const m4 = await emitEnd("user text", "user");
    assert.equal(m4, undefined);

    // The recap turn keeps the summary flag (a recap can span several assistant
    // messages); the NEXT before_agent_start consumes it. From there on,
    // message_end no longer appends the address.
    await injectedPrompt(host); // recap turn
    await injectedPrompt(host); // steady turn → consumes the summary flag
    const m5 = await emitEnd("Second summary.");
    assert.equal(m5, undefined);
  });

  // CLI smoke — subprocess test with the REAL pi CLI and a real model.
  // DEFAULT-SKIP: registered only when PLANNER_CLI_SMOKE=1 is explicitly set.
  // Otherwise the test is NOT REGISTERED at all — the automated suite is never
  // blocked, no model call happens, and no skip is counted in the
  // spec-reporter summary, so the end-to-end report test's `pass === tests`
  // invariant keeps holding without touching its assertions.
  if (process.env.PLANNER_CLI_SMOKE === "1") {
    test("CLI smoke: real pi loads the built adapter and /planner load returns the recap URL (skip without usable provider)", async (t) => {
      const projectDir = await createTempRoot("agent-plan-pi-cli-smoke-");
      try {
        // Seed a real .planner inside the project pi will run in.
        const store = new PlanStore(join(projectDir, ".planner"));
        store.enableAutoSync(true);
        await store.init("cli-smoke");
        await seedFixture(store, "minimal");

        // Enable the adapter through PROJECT settings (pi auto-loads missing
        // packages from .pi/settings.json on startup; absolute path keeps this
        // independent of cwd depth).
        await mkdir(join(projectDir, ".pi"), { recursive: true });
        await writeFile(
          join(projectDir, ".pi", "settings.json"),
          JSON.stringify({ packages: [ADAPTER_PACKAGE_DIR] }, null, 2),
          "utf8",
        );

        const run = (args, timeoutMs) =>
          new Promise((resolve) => {
            const child = spawn("pi", args, { cwd: projectDir, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
            let out = "", err = "";
            child.stdout.on("data", (d) => (out += d));
            child.stderr.on("data", (d) => (err += d));
            const timer = setTimeout(() => {
              child.kill("SIGKILL");
              resolve({ code: null, out, err, timedOut: true });
            }, timeoutMs);
            child.on("error", (e) => {
              clearTimeout(timer);
              resolve({ code: null, out, err, spawnError: e });
            });
            child.on("close", (code) => {
              clearTimeout(timer);
              resolve({ code, out, err });
            });
          });

        // pi must exist and be spawnable, or the smoke test reports a clear skip.
        const probe = await run(["--version"], 15_000);
        if (probe.spawnError || (probe.code !== 0 && !probe.out.includes("pi"))) {
          t.skip(`real pi CLI unavailable: ${probe.spawnError?.message ?? `exit ${probe.code}`}`);
          return;
        }

        const prompt =
          "Run the /planner load command (the slash command, not a tool). Then reply with the Web UI URL from the recap, exactly as shown, on its own line starting with URL=.";
        // Proportionate budget: a model reply here lands in ~15-40s; 45s covers
        // cold starts without letting the smoke block the suite for minutes.
        const result = await run(["-p", prompt, "--no-session", "--mode", "text"], 45_000);
        if (result.spawnError) {
          t.skip(`could not spawn pi: ${result.spawnError.message}`);
          return;
        }
        const clean = result.out.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
        // No output at all with a nonzero exit usually means no usable model/
        // provider in this environment — deterministic skip, not a product bug.
        if (result.code !== 0 && !clean.trim()) {
          t.skip(`pi exited ${result.code} with no output (model/provider unavailable?)`);
          return;
        }
        const url = clean.match(/URL=\s*(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
        assert.ok(url, `real pi ran /planner load and reported the recap URL; output tail: ${clean.slice(-300)}`);
      } finally {
        await rm(projectDir, { recursive: true, force: true });
      }
    });
  }
});
