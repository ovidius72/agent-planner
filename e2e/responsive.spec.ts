import { test, expect } from "./fixtures";

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus || page.isClosed()) return;
  const diagnostics = await page.evaluate(() => ({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    document: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
    body: { scrollWidth: document.body.scrollWidth, clientWidth: document.body.clientWidth },
    overflowing: Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > document.documentElement.clientWidth + 1;
      })
      .slice(0, 12)
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        text: (element.innerText || element.textContent || "").slice(0, 100),
      })),
  }));
  await testInfo.attach("layout-diagnostics.json", { body: JSON.stringify(diagnostics, null, 2), contentType: "application/json" });
});

test("desktop and mobile layouts keep core navigation, work tree controls, IDs, and dialogs reachable", async ({ page, planner }, testInfo) => {
  await planner.seed("full");
  const compact = testInfo.project.name.startsWith("mobile");
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  await page.goto(planner.url);
  await expect(page.getByTestId("agent-plan-version")).toHaveText(/Agent Plan v\d+\.\d+\.\d+/);

  if (compact) {
    await page.getByRole("button", { name: "Open menu" }).click();
    const menu = page.getByRole("menu");
    const featuresLink = menu.getByRole("link", { name: "Features" });
    await expect(featuresLink).toBeVisible();
    await featuresLink.focus();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  } else {
    await expect(page.getByRole("navigation").getByRole("link", { name: "Features" })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Project Goal" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Latest completed tasks" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Expand all|Collapse all/ })).toBeVisible();
  const copyId = page.getByRole("button", { name: "Copy F001" }).first();
  await expect(copyId).toBeVisible();
  await copyId.click();
  await expect(page.getByRole("button", { name: "Copied" }).first()).toBeVisible();

  const dashboardSize = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dashboardSize.scrollWidth).toBeLessThanOrEqual(dashboardSize.clientWidth + 1);

  await page.goto(`${planner.url}/requirements/new`);
  const dialog = page.getByRole("dialog", { name: "Create requirement" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Requirement title")).toBeVisible();
  await expect(dialog.getByLabel("Linked phases")).toBeVisible();
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.height).toBeLessThanOrEqual(viewport!.height - 32);

  const modalSize = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollableModal: Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] *')).some((element) => element.scrollHeight > element.clientHeight),
  }));
  expect(modalSize.scrollWidth).toBeLessThanOrEqual(modalSize.clientWidth + 1);
  if (compact) expect(modalSize.scrollableModal).toBe(true);
});

test("entity detail disclosures start closed on desktop and mobile navigation", async ({ page, planner }) => {
  await planner.seed("full");
  const features = (await planner.request("/features")).body as Array<{ id: string }>;
  const feature = features[0]!;
  const phases = (await planner.request(`/phases?featureId=${feature.id}`)).body as Array<{ id: string; tasks: Array<{ id: string }> }>;
  const phase = phases.find((entry) => entry.tasks.length > 0)!;
  const task = phase.tasks[0]!;

  const expectDetailClosed = async (summary: string) => {
    const details = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: summary }) }).first();
    await expect(details).toBeVisible();
    await expect.poll(async () => details.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(false);
  };

  await page.goto(`${planner.url}/features/${feature.id}`);
  await expectDetailClosed("Description");
  await expectDetailClosed("Status history");

  await page.goto(`${planner.url}/features/${feature.id}/phases/${phase.id}`);
  await expectDetailClosed("Description");
  await expectDetailClosed("Status history");

  await page.goto(`${planner.url}/features/${feature.id}/phases/${phase.id}/tasks/${task.id}`);
  await expectDetailClosed("Description");
  await expectDetailClosed("Status history");
});

test("handoff archive stays navigable and horizontally contained", async ({ page, planner }) => {
  await planner.seed("full");
  await page.goto(`${planner.url}/handoff/archive`);

  await expect(page.getByRole("heading", { name: "Archived handoffs" })).toBeVisible();
  await expect(page.getByRole("link", { name: "← Pending handoffs" })).toBeVisible();
  await expect(page.locator("summary").filter({ hasText: "Payments implement handoff" })).toBeVisible();
  await expect.poll(async () => page.locator("details").filter({ has: page.locator("summary").filter({ hasText: "Payments implement handoff" }) }).first().evaluate((element) => (element as HTMLDetailsElement).open)).toBe(false);

  const size = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(size.scrollWidth).toBeLessThanOrEqual(size.clientWidth + 1);
});

test("planner document references open the viewer in a new tab", async ({ page, planner }) => {
  await planner.seed("minimal");
  await planner.request("/docs/save", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: ".planner/docs/responsive-note.md", content: "# Responsive note\n\nSafe viewer content.\n", confirmed: true }),
    expectStatus: 200,
  });
  await page.goto(`${planner.url}/docs/view?path=${encodeURIComponent(".planner/docs/responsive-note.md")}`);
  await expect(page.getByRole("heading", { name: "Planner document" })).toBeVisible();
  await expect(page.getByText("Safe viewer content.")).toBeVisible();
  const size = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(size.scrollWidth).toBeLessThanOrEqual(size.clientWidth + 1);
});
