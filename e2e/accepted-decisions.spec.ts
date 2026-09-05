import { test, expect } from "./fixtures";

test("feature Accepted Decisions can be created, updated, and confirmed-deleted", async ({ page, planner }) => {
  await planner.seed("minimal");
  const feature = ((await planner.request("/features")).body as Array<{ id: string }>)[0]!;
  await page.goto(`${planner.url}/features/${feature.id}`);

  await page.getByText("Accepted decisions (0)", { exact: true }).click();
  await page.locator("summary").filter({ hasText: "Add accepted decision" }).click();
  const createForm = page.getByRole("button", { name: "Add decision" }).locator("xpath=ancestor::form");
  await createForm.getByLabel("Title").fill("Keep lifecycle explicit");
  await createForm.getByLabel("Decision").fill("Use semantic decision operations.");
  await createForm.getByLabel("Rationale").fill("Preserve planner-owned metadata.");
  await createForm.getByLabel("Implementation notes").fill("Do not replace the owning array.");
  await createForm.getByRole("button", { name: "Add decision" }).click();

  await page.waitForTimeout(1_000);
  const acceptedDecisions = page.getByText("Accepted decisions (1)", { exact: true });
  await acceptedDecisions.click();
  expect(await acceptedDecisions.evaluate((element) => (element.closest("details") as HTMLDetailsElement).open)).toBe(true);
  await expect(page.getByText("Keep lifecycle explicit")).toBeVisible();
  await page.locator("summary").filter({ hasText: "Manage decision" }).click();
  const updateForm = page.getByRole("button", { name: "Save decision" }).locator("xpath=ancestor::form");
  await updateForm.getByLabel("Rationale").fill("Preserve identity and acceptance time.");
  await updateForm.getByRole("button", { name: "Save decision" }).click();

  await page.waitForTimeout(1_000);
  await page.getByText("Accepted decisions (1)", { exact: true }).click();
  await expect(page.locator("p").filter({ hasText: "Preserve identity and acceptance time." })).toBeVisible();
  await page.locator("summary").filter({ hasText: "Manage decision" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete decision" }).click();

  await expect(page.getByText("Accepted decisions (0)", { exact: true })).toBeVisible();
  await expect(page.getByText("Keep lifecycle explicit")).toHaveCount(0);
});
