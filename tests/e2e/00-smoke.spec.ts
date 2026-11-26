import { expect, test } from "@playwright/test";
import { monitorPage } from "../helpers/monitor";
import { logIssues, shot } from "../helpers/report";

test("browser launches and landing page renders with no critical errors", async ({ page }) => {
  const monitor = monitorPage(page);
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/Speakio/i);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await shot(page, "smoke-landing-full", true);
  logIssues("smoke", monitor.issues);
  expect(monitor.serious()).toEqual([]);
});
