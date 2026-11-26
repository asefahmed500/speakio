import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, VIEWPORTS, uniqueTag } from "../helpers/constants";
import { loginViaUI, registerViaUI } from "../helpers/auth";
import { monitorPage } from "../helpers/monitor";
import { logIssues, shot } from "../helpers/report";

const password = "QaResponsive123!";

test.describe("RESPONSIVE — 1440x1000, 1366x768, 768x1024, 390x844", () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name} ${vp.width}x${vp.height}: no horizontal overflow on public pages`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await context.newPage();
      const monitor = monitorPage(page);
      for (const route of ["/", "/login", "/register", "/verify"]) {
        await page.goto(route);
        await expect(page.locator("h1").first()).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth
        );
        expect(overflow, `${route} overflows by ${overflow}px`).toBeLessThanOrEqual(1);
      }
      await shot(page, `responsive-${vp.name}-public`, true);
      logIssues(`responsive-${vp.name}`, monitor.issues);
      expect(monitor.serious()).toEqual([]);
      await context.close();
    });

    test(`${vp.name} ${vp.width}x${vp.height}: student shell navigation works`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await context.newPage();
      const monitor = monitorPage(page);
      await registerViaUI(page, {
        email: `${uniqueTag(`qa-rwd-${vp.name}`)}@speakio.test`,
        password,
        name: "QA Responsive User",
      });

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `dashboard overflows by ${overflow}px`).toBeLessThanOrEqual(1);

      if (vp.width < 768) {
        const toggle = page.getByRole("button", { name: /Open navigation sidebar/ }).first();
        await expect(toggle).toBeVisible();
        await toggle.click();
        await expect(page.getByRole("link", { name: "Vocabulary Studio", exact: true })).toBeVisible();
        await page.getByRole("link", { name: "Vocabulary Studio", exact: true }).click();
        await expect(page).toHaveURL(/\/vocabulary$/);
      } else {
        await expect(page.getByRole("link", { name: "Dashboard", exact: true }).first()).toBeVisible();
      }
      await shot(page, `responsive-${vp.name}-dashboard`, true);
      logIssues(`responsive-${vp.name}-app`, monitor.issues);
      expect(monitor.serious()).toEqual([]);
      await context.close();
    });
  }

  test("admin pages render at laptop viewport", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/users");
    await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await shot(page, "responsive-laptop-admin-users", true);
    await context.close();
  });
});
