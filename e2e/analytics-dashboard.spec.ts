import { test, expect } from "./fixtures";

test("dashboard analytics supports keyboard drill-down, exact-table selection, and reversible Work Tree filtering", async ({ page, planner }) => {
  await planner.seed("full");
  await page.goto(planner.url);

  await expect(page.getByRole("heading", { name: "Flow & Backlog" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Added vs Closed" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Scope vs Completion" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Open-task aging" })).toBeVisible();

  const treeRows = page.locator('[id^="task-row-"]');
  const initialCount = await treeRows.count();
  expect(initialCount).toBeGreaterThan(1);
  const initialUrl = page.url();

  const openNow = page.getByRole("button", { name: "Filter Work Tree by Open now" });
  await openNow.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-analytics-work-tree-filter]")).toContainText("currently open");
  expect(await treeRows.count()).toBeLessThan(initialCount);
  expect(page.url()).toBe(initialUrl);

  await page.locator("[data-analytics-work-tree-filter]").getByRole("button", { name: "Clear analytics filter" }).click();
  await expect(page.locator("[data-analytics-work-tree-filter]")).toHaveCount(0);
  await expect(treeRows).toHaveCount(initialCount);

  const addedPoint = page.getByRole("button", { name: /^Filter Work Tree to \d+ tasks added on 2026-01-01$/ });
  await addedPoint.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-analytics-work-tree-filter]")).toContainText("added on 2026-01-01");
  expect(page.url()).toBe(initialUrl);
  await page.locator("[data-analytics-work-tree-filter]").getByRole("button", { name: "Clear analytics filter" }).click();

  await page.getByText("View exact flow data", { exact: true }).click();
  const exactTable = page.getByRole("table", { name: "Exact added, closed, reopened, and net backlog values by active UTC day" });
  await expect(exactTable).toBeVisible();
  const addedCellButton = exactTable.locator("tbody tr").first().locator("td").nth(0).getByRole("button");
  await addedCellButton.click();
  await expect(page.locator("[data-analytics-work-tree-filter]")).toContainText("added on 2026-01-01");
});

test("dashboard analytics remains horizontally contained on desktop and 390px touch viewports", async ({ page, planner }) => {
  await planner.seed("full");
  await page.goto(planner.url);
  await expect(page.getByRole("heading", { name: "Flow & Backlog" })).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  await expect(page.locator('[data-responsive-chart="horizontal-scroll"]')).toHaveCount(2);
});

test("empty analytics and active/resume dashboard surfaces coexist without false precision", async ({ page, planner }) => {
  await page.goto(planner.url);
  await expect(page.getByText("No task-flow activity is recorded for this period.")).toBeVisible();
  await expect(page.getByText("No active-day flow data.")).toBeVisible();
  await expect(page.getByText("No cumulative flow data.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Filter Work Tree by Open now" })).toHaveCount(0);

  await planner.seed("resume-needed");
  await page.reload();
  await expect(page.getByText("Active tasks (1)")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Flow & Backlog" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Work Tree" })).toBeVisible();
});
