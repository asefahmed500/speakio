import { expect, type Page } from "@playwright/test";

/**
 * Navigate to an authenticated app route, tolerating a transient backend
 * blip. The app deliberately renders a "Service unavailable" state when the
 * session cannot be verified; a QA run should retry rather than report a
 * false feature failure.
 */
export async function gotoApp(page: Page, route: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(route);
    const unavailable = page.getByRole("heading", { name: "Service unavailable" });
    if (!(await unavailable.isVisible().catch(() => false))) return;
    console.log(`[gotoApp] ${route}: service unavailable, retry ${attempt}/3`);
    await page.waitForTimeout(3000);
  }
  await expect(
    page.getByRole("heading", { name: "Service unavailable" }),
    `${route} never recovered from the service-unavailable state`
  ).toBeHidden();
}
