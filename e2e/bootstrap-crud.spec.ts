import { test, expect } from "./fixtures";

test("empty project opens the real dashboard and exposes the bootstrap routes", async ({ page, planner }, testInfo) => {
  await page.goto(planner.url);

  await expect(page.getByRole("heading", { name: "Project Goal" })).toBeVisible();
  await expect(page.getByText("No work items match the current filters.")).toBeVisible();
  const compact = testInfo.project.name.startsWith("mobile");
  if (compact) await page.getByRole("button", { name: "Open menu" }).click();
  const featuresLink = compact
    ? page.getByRole("menu").getByRole("link", { name: "Features" })
    : page.getByRole("navigation").getByRole("link", { name: "Features" });
  await expect(featuresLink).toBeVisible();

  await featuresLink.click();
  await expect(page.getByRole("link", { name: "Create your first feature" })).toBeVisible();
});

test("creates feature, phase, task and linked requirement through the browser and persists after reload", async ({ page, planner }) => {
  await page.goto(`${planner.url}/features`);
  await page.getByRole("link", { name: "Create feature" }).click();
  await page.getByLabel("Feature name").fill("Checkout");
  await page.getByLabel("Description").fill("Browser-created checkout flow.");
  await page.getByRole("dialog", { name: "Create feature" }).getByRole("button", { name: /^Create feature/ }).click();

  const checkout = page.getByRole("link", { name: "Checkout", exact: true });
  await expect(checkout).toBeVisible();
  const feature = await planner.request("/features");
  const createdFeature = (feature.body as Array<{ id: string; name: string }>).find(({ name }) => name === "Checkout");
  expect(createdFeature).toBeTruthy();
  await checkout.click();
  await expect(page.getByText("F001")).toBeVisible();

  await page.getByRole("link", { name: "Create phase" }).click();
  await page.getByLabel("Phase title").fill("Payment capture");
  await page.getByLabel("Summary").fill("Confirm and capture a checkout payment.");
  await page.getByLabel("Description").fill("Real browser E2E phase.");
  await page.getByRole("dialog", { name: "Create phase" }).getByRole("button", { name: /^Create phase/ }).click();

  const paymentCapture = page.getByRole("link", { name: "Payment capture", exact: true });
  await expect(paymentCapture).toBeVisible();
  const phases = await planner.request(`/phases?featureId=${createdFeature!.id}`);
  const createdPhase = (phases.body as Array<{ id: string; title: string }>).find(({ title }) => title === "Payment capture");
  expect(createdPhase).toBeTruthy();
  await paymentCapture.click();
  await expect(page.getByText("F001/P001")).toBeVisible();

  await page.getByRole("link", { name: "Create task" }).click();
  await page.getByLabel("Task title").fill("Capture card payment");
  await page.getByLabel("Description").fill("Persist the charge result.");
  await page.getByLabel("Checklist (one per line)").fill("Authorize card\nStore receipt");
  await page.getByRole("dialog", { name: "Create task" }).getByRole("button", { name: /^Create task/ }).click();
  await expect(page.getByText("Capture card payment")).toBeVisible();

  const phase = await planner.request(`/phases/${createdPhase!.id}`);
  const persistedPhase = phase.body as { tasks: Array<{ title: string; checklist: Array<{ title: string }> }> };
  expect(persistedPhase.tasks).toEqual(expect.arrayContaining([
    expect.objectContaining({
      title: "Capture card payment",
      checklist: [expect.objectContaining({ title: "Authorize card" }), expect.objectContaining({ title: "Store receipt" })],
    }),
  ]));

  await page.goto(`${planner.url}/requirements`);
  await page.getByRole("link", { name: "Create requirement" }).click();
  await page.getByLabel("Requirement title").fill("Payments complete reliably");
  await page.getByLabel("Description").fill("Customers receive a persistent payment result.");
  await page.getByLabel("P001 — Payment capture").check();
  await page.getByRole("dialog", { name: "Create requirement" }).getByRole("button", { name: /^Create requirement/ }).click();
  await expect(page.getByText("Payments complete reliably")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Payments complete reliably")).toBeVisible();
});

test("renders server validation failures and preserves the prior state", async ({ page, planner }) => {
  await page.goto(`${planner.url}/features`);
  await page.getByRole("link", { name: "Create feature" }).click();
  await page.getByLabel("Feature name").fill("   ");
  await page.getByRole("dialog", { name: "Create feature" }).getByRole("button", { name: /^Create feature/ }).click();

  await expect(page.getByRole("heading", { name: /Request failed \(400\)/ })).toBeVisible();
  await expect(page.getByText("Missing field: name")).toBeVisible();
  expect((await planner.request("/features")).body).toEqual([]);
});

test("edits and deletes an entity through its browser confirmation flow", async ({ page, planner }) => {
  await planner.seed("minimal");
  const feature = ((await planner.request("/features")).body as Array<{ id: string }>)[0]!;

  await page.goto(`${planner.url}/features/${feature.id}`);
  await page.getByRole("link", { name: "Edit feature" }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit feature" });
  await editDialog.getByLabel("Name").fill("Authentication renamed");
  await editDialog.getByRole("button", { name: /^Save feature/ }).click();
  await expect(page.getByRole("heading", { name: "Authentication renamed" })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete feature" }).click();
  await expect(page).toHaveURL(/\/features$/);
  await expect(page.getByRole("link", { name: "Create your first feature" })).toBeVisible();
});
