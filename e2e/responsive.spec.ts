import { test, expect } from "./fixtures";

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus || page.isClosed()) return;
  const diagnostics = await page.evaluate(() => ({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    document: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
    body: { scrollWidth: document.body.scrollWidth, clientWidth: document.body.clientWidth },
    overflowing: Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 12)
      .map((element) => ({ tag: element.tagName, className: element.className, text: element.innerText.slice(0, 100) })),
  }));
  await testInfo.attach("layout-diagnostics.json", { body: JSON.stringify(diagnostics, null, 2), contentType: "application/json" });
});

test("desktop and mobile layouts keep core navigation, work tree controls, IDs, and dialogs reachable", async ({ page, planner }, testInfo) => {
  await planner.seed("full");
  const compact = testInfo.project.name.startsWith("mobile");
  const viewport = compact ? { width: 390, height: 480 } : { width: 1280, height: 720 };
  await page.setViewportSize(viewport);
  await page.goto(planner.url);

  await expect(page.getByRole("navigation").getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("navigation").getByRole("link", { name: "Features" })).toBeVisible();
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
  expect(dialogBox!.height).toBeLessThanOrEqual(viewport.height - 32);

  const modalSize = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollableModal: Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] *')).some((element) => element.scrollHeight > element.clientHeight),
  }));
  expect(modalSize.scrollWidth).toBeLessThanOrEqual(modalSize.clientWidth + 1);
  if (compact) expect(modalSize.scrollableModal).toBe(true);
});

test("handoff archive stays navigable and horizontally contained", async ({ page, planner }, testInfo) => {
  await planner.seed("full");
  await page.setViewportSize(testInfo.project.name.startsWith("mobile") ? { width: 390, height: 480 } : { width: 1280, height: 720 });
  await page.goto(`${planner.url}/handoff/archive`);

  await expect(page.getByRole("heading", { name: "Archived handoffs" })).toBeVisible();
  await expect(page.getByRole("link", { name: "← Pending handoffs" })).toBeVisible();
  await expect(page.locator("summary").filter({ hasText: "Payments implement handoff" })).toBeVisible();

  const size = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(size.scrollWidth).toBeLessThanOrEqual(size.clientWidth + 1);
});
