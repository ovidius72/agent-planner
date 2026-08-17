import { test, expect, type BrowserPlanner } from "./fixtures";

async function prepareTaskGovernance(planner: BrowserPlanner, featureId: string, phaseId: string) {
  const feature = (await planner.request(`/features/${featureId}`)).body as Record<string, unknown>;
  await planner.request(`/features/${featureId}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...feature, contextReady: true, contextReadyReason: "Browser handoff scenario." }), expectStatus: 200,
  });
  const phase = (await planner.request(`/phases/${phaseId}`)).body as Record<string, unknown>;
  await planner.request(`/phases/${phaseId}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...phase, contextReady: true, contextReadyReason: "Browser handoff scenario." }), expectStatus: 200,
  });
}

test("a pending handoff is browser-visible, then completing the final task archives it", async ({ page, planner }) => {
  await planner.seed("minimal");
  const phase = ((await planner.request("/phases")).body as Array<{ id: string; featureId: string; tasks: Array<{ id: string }> }>)[0]!;
  await prepareTaskGovernance(planner, phase.featureId, phase.id);
  await planner.request(`/phases/${phase.id}/handoff`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "# Resume checkout work\n\nVerify final browser flow." }), expectStatus: 200,
  });

  await page.goto(`${planner.url}/handoff`);
  const pending = page.locator("summary").filter({ hasText: "Resume checkout work" });
  await expect(pending).toBeVisible();
  await pending.click();
  await expect(page.getByText("Verify final browser flow.")).toBeVisible();
  await page.reload();
  await expect(page.locator("summary").filter({ hasText: "Resume checkout work" })).toBeVisible();

  await page.goto(`${planner.url}/features/${phase.featureId}/phases/${phase.id}`);
  await page.locator('select[name="status"]').last().selectOption("done");
  await expect(page.getByText(/Completed /)).toBeVisible();

  await page.goto(`${planner.url}/handoff`);
  await expect(page.getByText("No pending phase handoffs.")).toBeVisible();
  await page.getByRole("link", { name: "View archive →" }).click();
  const archived = page.locator("summary").filter({ hasText: "Resume checkout work" });
  await expect(archived).toBeVisible();
  await archived.click();
  await expect(page.getByText("Reason: phase-done")).toBeVisible();
  await expect(page.getByText("Verify final browser flow.")).toBeVisible();
});

test("replacement archives superseded content and browser clear archives the active handoff", async ({ page, planner }) => {
  await planner.seed("minimal");
  const phase = ((await planner.request("/phases")).body as Array<{ id: string }>)[0]!;
  const put = (content: string) => planner.request(`/phases/${phase.id}/handoff`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }), expectStatus: 200,
  });
  await put("# First handoff\n\nThis is superseded.");
  await put("# Current handoff\n\nClear this from the UI.");

  await page.goto(`${planner.url}/handoff`);
  await expect(page.locator("summary").filter({ hasText: "Current handoff" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByText("No pending phase handoffs.")).toBeVisible();

  await page.getByRole("link", { name: "View archive →" }).click();
  const first = page.locator("summary").filter({ hasText: "First handoff" });
  const current = page.locator("summary").filter({ hasText: "Current handoff" });
  await expect(first).toBeVisible();
  await expect(current).toBeVisible();
  await first.click();
  await expect(page.getByText("Reason: superseded")).toBeVisible();
  await current.click();
  await expect(page.getByText("Reason: manual")).toBeVisible();
});
