import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { bootstrapStoreSchema, createDocument, getDocument, openNodeSqliteDriver, updateDocument } from "../packages/plan-core/dist/persistence/index.js";
import { connectRegisteredPlannerService } from "../packages/plan-server/dist/index.js";

test("the board starts a task through the same scoped SQLite authority", async ({ page }) => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "registered-board-")));
  const projectId = randomUUID();
  const workspaceId = randomUUID();
  const featureId = randomUUID();
  const phaseId = randomUUID();
  const taskId = randomUUID();
  const documentId = randomUUID();
  const dir = join(home, ".agent-plan", "projects", projectId);
  await mkdir(dir, { recursive: true });
  const driver = openNodeSqliteDriver({ path: join(dir, "planner.sqlite") });
  let close: (() => Promise<void>) | undefined;
  try {
    bootstrapStoreSchema(driver);
    const now = new Date().toISOString();
    driver.prepare("INSERT INTO projects(id, descriptor_project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(projectId, projectId, "Registered Board", now, now);
    const grant = driver.prepare("INSERT INTO project_principals(project_id, principal_id) VALUES (?, ?)");
    grant.run(projectId, "loopback:agent");
    grant.run(projectId, "loopback:web-ui");
    driver.prepare("INSERT INTO project_workspaces(project_id, id, source_path, clone_key) VALUES (?, ?, ?, ?)")
      .run(projectId, workspaceId, home, home);
    driver.prepare("INSERT INTO features(id, project_id, number, status, name, created_at, updated_at) VALUES (?, ?, 1, 'planned', ?, ?, ?)")
      .run(featureId, projectId, "Workspace feature", now, now);
    driver.prepare("INSERT INTO phases(id, project_id, feature_id, number, status, title, created_at, updated_at) VALUES (?, ?, ?, 1, 'planned', ?, ?, ?)")
      .run(phaseId, projectId, featureId, "Workspace phase", now, now);
    driver.prepare("INSERT INTO tasks(id, project_id, phase_id, number, status, title, created_at, updated_at) VALUES (?, ?, ?, 1, 'planned', ?, ?, ?)")
      .run(taskId, projectId, phaseId, "Workspace task", now, now);
    createDocument(driver, { projectId, id: documentId, folder: "work", name: "notes.md", content: "# Workspace notes" });

    const service = await connectRegisteredPlannerService({ home });
    if (service.reused) throw new Error("Expected an isolated registered service.");
    close = service.close;
    const route = `/board/${projectId}/${workspaceId}/features/${featureId}/phases/${phaseId}/tasks/${taskId}`;
    const stream = page.waitForEvent("websocket", (websocket) => websocket.url().includes("/events/stream"));
    await page.goto(service.url + route);
    await expect(page.getByRole("heading", { name: /Workspace task/ })).toBeVisible();
    await stream;
    await page.getByRole("button", { name: "Start task" }).click();
    await expect(page.getByText("Active tasks (1)")).toBeVisible();
    await expect(page).toHaveURL(service.url + route);
    const state = driver.prepare("SELECT status, active_owner_session FROM tasks WHERE id = ?").get(taskId);
    expect(state?.status).toBe("in-progress");
    expect(driver.prepare("SELECT client_kind FROM project_sessions WHERE id = ?").get(String(state?.active_owner_session))?.client_kind).toBe("web");
    driver.prepare("UPDATE tasks SET metadata = json_set(metadata, '$.executionActivityAt', ?) WHERE id = ?")
      .run("2000-01-01T00:00:00.000Z", taskId);
    await page.reload();
    await expect(page.getByText("Owner idle")).toBeVisible();
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Release task" }).click();
    expect(driver.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId)?.status).toBe("in-progress");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Release task" }).click();
    await expect(page.getByRole("button", { name: "Start task" })).toBeVisible();
    expect(driver.prepare("SELECT active_owner_session FROM tasks WHERE id = ?").get(taskId)?.active_owner_session).toBe("");
    await page.goto(`${service.url}/board/${projectId}/${workspaceId}/features`);
    await page.getByRole("link", { name: "Create feature" }).click();
    await page.getByLabel("Feature name").fill("Browser feature");
    await page.getByRole("dialog", { name: "Create feature" }).getByRole("button", { name: /^Create feature/ }).click();
    await expect(page.getByRole("link", { name: "Browser feature", exact: true })).toBeVisible();
    expect(driver.prepare("SELECT name FROM features WHERE project_id = ? AND number = 2").get(projectId)?.name).toBe("Browser feature");
    await page.goto(`${service.url}/board/${projectId}/${workspaceId}/requirements`);
    await page.getByRole("button", { name: "Create requirement" }).click();
    await page.getByLabel("Requirement title").fill("Browser requirement");
    await page.getByRole("checkbox", { name: /Workspace phase/ }).check();
    await page.getByRole("dialog", { name: "Create requirement" }).getByRole("button", { name: /^Create requirement/ }).click();
    await expect(page.getByRole("heading", { name: /^Browser requirement/ })).toBeVisible();
    expect(driver.prepare(`
      SELECT r.title FROM requirements r JOIN entity_requirements l ON l.requirement_id = r.id WHERE l.entity_id = ?
    `).get(phaseId)?.title).toBe("Browser requirement");
    const documentRoute = `${service.url}/board/${projectId}/${workspaceId}/docs/view?path=${encodeURIComponent(".planner/docs/work/notes.md")}`;
    await page.goto(documentRoute);
    await expect(page.getByText("Workspace notes", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("textbox", { name: /Markdown source/ }).fill("# Updated from the board");
    await page.getByRole("checkbox", { name: /I confirm overwriting/ }).check();
    await page.getByRole("button", { name: "Save document" }).click();
    await expect.poll(() => getDocument(driver, documentId)?.revision).toBe(2);
    await page.goto(documentRoute);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("textbox", { name: /Markdown source/ }).fill("# Stale editor draft");
    updateDocument(driver, documentId, { content: "# Concurrent update" });
    await page.getByRole("checkbox", { name: /I confirm overwriting/ }).check();
    await page.getByRole("button", { name: "Save document" }).click();
    await expect(page.getByRole("alert")).toContainText("This document changed after it was opened.");
    expect(getDocument(driver, documentId)?.content).toBe("# Concurrent update");
    const disposableTaskId = randomUUID();
    driver.prepare("INSERT INTO tasks(id, project_id, phase_id, number, status, title, created_at, updated_at) VALUES (?, ?, ?, 2, 'planned', ?, ?, ?)")
      .run(disposableTaskId, projectId, phaseId, "Disposable browser task", now, now);
    const phaseRoute = `${service.url}/board/${projectId}/${workspaceId}/features/${featureId}/phases/${phaseId}`;
    await page.goto(`${phaseRoute}/tasks/${disposableTaskId}`);
    await expect(page.getByRole("heading", { name: /Disposable browser task/ })).toBeVisible();
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: /^Delete task/ }).click();
    expect(driver.prepare("SELECT id FROM tasks WHERE id = ?").get(disposableTaskId)?.id).toBe(disposableTaskId);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: /^Delete task/ }).click();
    await expect(page).toHaveURL(phaseRoute);
    expect(driver.prepare("SELECT id FROM tasks WHERE id = ?").get(disposableTaskId)).toBeUndefined();
  } finally {
    await page.close();
    await close?.();
    driver.close();
    await rm(home, { recursive: true, force: true });
  }
});
