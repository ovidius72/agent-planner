import { test, expect, type BrowserPlanner } from "./fixtures";

async function prepareTaskGovernance(planner: BrowserPlanner, featureId: string, phaseId: string) {
  const feature = (await planner.request(`/features/${featureId}`)).body as Record<string, unknown>;
  await planner.request(`/features/${featureId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...feature, contextReady: true, contextReadyReason: "Browser status scenario." }),
    expectStatus: 200,
  });
  const phase = (await planner.request(`/phases/${phaseId}`)).body as Record<string, unknown>;
  await planner.request(`/phases/${phaseId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...phase, contextReady: true, contextReadyReason: "Browser status scenario." }),
    expectStatus: 200,
  });
}

test("task status changes update active work, derived parents, and persisted lifecycle history", async ({ page, planner }) => {
  await planner.seed("minimal");
  const phase = ((await planner.request("/phases")).body as Array<{ id: string; featureId: string; tasks: Array<{ id: string }> }>)[0]!;
  const taskId = phase.tasks[0]!.id;
  await prepareTaskGovernance(planner, phase.featureId, phase.id);

  await page.goto(`${planner.url}/features/${phase.featureId}/phases/${phase.id}/tasks/${taskId}`);
  await page.getByRole("button", { name: "Start task" }).click();
  await expect(page.getByText("Active tasks (1)")).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: "Implement login", exact: true })).toHaveCount(1);

  const started = await planner.request(`/tasks/${taskId}`);
  expect(started.body).toMatchObject({ status: "in-progress" });
  expect((started.body as { startedAt: string }).startedAt).not.toBe("");

  await page.getByRole("link", { name: "Back to phase" }).click();
  const status = page.locator('select[name="status"]').last();
  await status.selectOption("done");
  await expect(page.getByText(/Completed /)).toBeVisible();
  await expect(page.getByText("Active tasks (1)")).toHaveCount(0);

  await page.reload();
  const completed = await planner.request(`/tasks/${taskId}`);
  expect(completed.body).toMatchObject({ status: "done" });
  expect((completed.body as { completedAt: string }).completedAt).not.toBe("");
  await expect(page.getByText(/Completed /)).toBeVisible();
});

test("the Web UI supervisor can apply a motivated status without an agent motivation field", async ({ page, planner }) => {
  await planner.seed("minimal");
  const phase = ((await planner.request("/phases")).body as Array<{ id: string; featureId: string; tasks: Array<{ id: string }> }>)[0]!;
  const taskId = phase.tasks[0]!.id;

  await page.goto(`${planner.url}/features/${phase.featureId}/phases/${phase.id}`);
  const status = page.locator('select[name="status"]').last();
  await status.selectOption("blocked");

  await expect(status).toHaveValue("blocked");
  await expect.poll(async () => {
    const task = (await planner.request(`/tasks/${taskId}`)).body as { status: string };
    return task.status;
  }).toBe("blocked");
  await expect(page.getByRole("heading", { name: /Request failed/ })).toHaveCount(0);
});

test("the Web UI supervisor can move a waiting task back to planned", async ({ page, planner }) => {
  await planner.seed("minimal");
  const phase = ((await planner.request("/phases")).body as Array<{ id: string; featureId: string; tasks: Array<{ id: string }> }>)[0]!;
  const taskId = phase.tasks[0]!.id;

  await planner.request(`/tasks/${taskId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phaseId: phase.id, status: "waiting", motivation: "Waiting on an external dependency." }),
    expectStatus: 200,
  });
  await expect.poll(async () => {
    const task = (await planner.request(`/tasks/${taskId}`)).body as { status: string };
    return task.status;
  }).toBe("waiting");

  await page.goto(`${planner.url}/features/${phase.featureId}/phases/${phase.id}`);
  const status = page.locator('select[name="status"]').last();
  await expect(status).toHaveValue("waiting");
  await status.selectOption("planned");

  await expect(status).toHaveValue("planned");
  await expect.poll(async () => {
    const task = (await planner.request(`/tasks/${taskId}`)).body as { status: string };
    return task.status;
  }).toBe("planned");
  await expect(page.getByRole("heading", { name: /Request failed/ })).toHaveCount(0);
});

test("dashboard filtering, expansion, and requirement grouping work against a populated real plan", async ({ page, planner }) => {
  await planner.seed("full");
  await page.goto(planner.url);

  const treeTasks = page.locator('[id^="task-row-"]');
  await expect(page.getByRole("button", { name: /Expand all|Collapse all/ })).toBeVisible();
  await expect(treeTasks.getByRole("link", { name: "Task 1", exact: true })).toBeVisible();
  await expect(treeTasks.getByRole("link", { name: "Task 4", exact: true })).toBeVisible();

  await page.locator('[contenteditable="true"]').fill("status:in-progress");
  await expect(treeTasks.getByRole("link", { name: "Task 1", exact: true })).toBeVisible();
  await expect(treeTasks.getByRole("link", { name: "Task 4", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(treeTasks.getByRole("link", { name: "Task 4", exact: true })).toBeVisible();

  await page.goto(`${planner.url}/requirements`);
  await expect(page.getByRole("link", { name: "P001 — Auth — design" })).toBeVisible();
  await expect(page.getByText("Users authenticate with email")).toBeVisible();
});
