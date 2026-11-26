import { expect, test } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  ADMIN_ROUTES,
  PUBLIC_ROUTES,
  STUDENT_ROUTES,
  uniqueTag,
} from "../helpers/constants";
import { loginViaUI, registerViaUI } from "../helpers/auth";
import { monitorPage, type BrowserIssue } from "../helpers/monitor";
import { logIssues, shot } from "../helpers/report";

const password = "QaTestPass123!";

/** Visit each route directly and assert the RSC + client app really render. */
async function visitRoute(
  page: import("@playwright/test").Page,
  route: string,
  issues: BrowserIssue[]
): Promise<void> {
  const before = issues.length;
  const response = await page.goto(route, { waitUntil: "domcontentloaded" });
  expect(response?.status(), `${route} returned ${response?.status()}`).toBeLessThan(500);
  await expect(page.locator("body")).not.toBeEmpty();
  await expect(page.locator("h1").first()).toBeVisible({ timeout: 30_000 });
  if (issues.length > before) {
    logIssues(`route ${route}`, issues.slice(before));
  }
}

test.describe("NAVIGATION — every discovered route", () => {
  test("all public routes render without critical browser errors", async ({ page }) => {
    const monitor = monitorPage(page);
    for (const route of PUBLIC_ROUTES) await visitRoute(page, route, monitor.issues);
    await shot(page, "nav-public-last", true);
    expect(monitor.serious()).toEqual([]);
  });

  test("all student routes render and sidebar links navigate", async ({ page }) => {
    const monitor = monitorPage(page);
    const email = `${uniqueTag("qa-nav-student")}@speakio.test`;
    await registerViaUI(page, { email, password, name: "QA Nav Student" });

    for (const route of STUDENT_ROUTES) await visitRoute(page, route, monitor.issues);

    // Every student nav item is present and clickable.
    const navNames = ["Dashboard", "My Results", "Study Planner", "Vocabulary Studio", "Listening", "Reading", "Writing AI", "Speaking", "Certificates", "Profile"];
    for (const name of navNames) {
      await expect(page.getByRole("link", { name, exact: true }).first()).toBeVisible();
    }
    await page.getByRole("link", { name: "Vocabulary Studio", exact: true }).first().click();
    await expect(page).toHaveURL(/\/vocabulary$/);

    // No admin navigation for a USER.
    await expect(page.getByRole("link", { name: "User Management", exact: true })).toHaveCount(0);
    await expect(page.getByText("Administration", { exact: true })).toHaveCount(0);
    logIssues("nav-student", monitor.issues);
    expect(monitor.serious()).toEqual([]);
  });

  test("student is blocked from every admin route by server-side layout", async ({ page }) => {
    const email = `${uniqueTag("qa-nav-rbac")}@speakio.test`;
    await registerViaUI(page, { email, password, name: "QA RBAC Student" });
    for (const route of ADMIN_ROUTES) {
      await page.goto(route);
      await expect(page, `${route} must redirect a USER`).toHaveURL(/\/dashboard$/);
    }
  });

  test("all admin routes render for an ADMIN with real data", async ({ page }) => {
    const monitor = monitorPage(page);
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page).toHaveURL(/\/overview$/);

    for (const route of ADMIN_ROUTES) await visitRoute(page, route, monitor.issues);

    await expect(page.getByText("Administration", { exact: true })).toBeVisible();
    for (const name of ["Overview", "AI Reviews", "Agent Ops", "Students", "Users", "Question Bank"]) {
      await expect(page.getByRole("link", { name, exact: true }).first()).toBeVisible();
    }
    await shot(page, "nav-admin-question-bank", true);
    logIssues("nav-admin", monitor.issues);
    expect(monitor.serious()).toEqual([]);
  });

  test("authenticated visitor is redirected away from login", async ({ page }) => {
    const email = `${uniqueTag("qa-nav-auth-redirect")}@speakio.test`;
    await registerViaUI(page, { email, password, name: "QA Auth Redirect" });
    await page.goto("/login");
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
