import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, uniqueTag } from "../helpers/constants";
import { assertAuthenticated, authMe, loginViaUI, logoutViaUI, registerViaUI } from "../helpers/auth";
import { monitorPage } from "../helpers/monitor";
import { logIssues, shot } from "../helpers/report";
import { userInDb } from "../helpers/db";

const password = "QaTestPass123!";

test.describe("AUTH — registration, login, session, logout", () => {
  test("protected routes redirect anonymous visitors to login with next parameter", async ({ page }) => {
    const monitor = monitorPage(page);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    // Deep link preserved so the user lands back where they intended.
    await expect(page).toHaveURL(/next=%2Fdashboard/);
    logIssues("auth-protected", monitor.issues);
    expect(monitor.serious()).toEqual([]);
  });

  test("registration empty-field and weak-password validation is enforced in browser", async ({ page }) => {
    await page.goto("/register");
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByText("Full name must be at least 2 characters")).toBeVisible();
    await expect(page.getByText("Email address is required")).toBeVisible();
    await expect(page.getByText("Password must be at least 8 characters long")).toBeVisible();

    await page.locator("#reg-name").fill("QA Validator");
    await page.locator("#reg-email").fill("not-an-email");
    await page.locator("#reg-password").fill("short");
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByText("Please enter a valid email address")).toBeVisible();
    await expect(page.getByText("Password must be at least 8 characters long")).toBeVisible();
    await shot(page, "auth-register-validation");
  });

  test("full registration creates a real user in DB and signs them in", async ({ page }) => {
    const monitor = monitorPage(page);
    const email = `${uniqueTag("qa-register")}@speakio.test`;
    await registerViaUI(page, { email, password, name: "QA Registered User" }, "7.5");

    await expect(page.getByRole("heading", { name: "Candidate Dashboard" })).toBeVisible();
    await assertAuthenticated(page.request, "USER");
    const row = userInDb(email);
    expect(row, "user must exist in PostgreSQL").toBeTruthy();
    expect(row!.email).toBe(email);
    expect(row!.role).toBe("USER");
    expect(row!.status).toBe("ACTIVE");
    expect(Number(row!.targetBand)).toBe(7.5);
    await shot(page, "auth-dashboard-after-register");
    logIssues("auth-register", monitor.issues);
    expect(monitor.serious()).toEqual([]);
  });

  test("login rejects invalid credentials and empty fields", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Email address is required")).toBeVisible();
    await expect(page.getByText("Password is required")).toBeVisible();

    await page.locator("#login-email").fill("admin@speakio.com");
    await page.locator("#login-password").fill("DefinitelyWrong123!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/login/);
    await shot(page, "auth-login-invalid");
  });

  test("session persists after refresh and logout invalidates it", async ({ page }) => {
    const email = `${uniqueTag("qa-session")}@speakio.test`;
    await registerViaUI(page, { email, password, name: "QA Session User" });

    await page.reload();
    await expect(page).toHaveURL(/\/dashboard$/);
    await assertAuthenticated(page.request, "USER");

    // Cancel keeps the session.
    await page.getByRole("button", { name: "Sign out" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Stay signed in" }).click();
    await expect(dialog).toBeHidden();
    await assertAuthenticated(page.request, "USER");

    await logoutViaUI(page);
    const me = await authMe(page.request);
    expect(me.status).toBe(401);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("duplicate email registration surfaces a server conflict error", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const email = `${uniqueTag("qa-duplicate")}@speakio.test`;
    await registerViaUI(page, { email, password, name: "QA Duplicate" });
    await logoutViaUI(page);

    await page.goto("/register");
    await page.locator("#reg-name").fill("QA Duplicate Two");
    await page.locator("#reg-email").fill(email);
    await page.locator("#reg-password").fill(password);
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/register/);
    await shot(page, "auth-duplicate-error");
    await context.close();
  });

  test("admin credentials sign in and land on the admin overview", async ({ page }) => {
    const monitor = monitorPage(page);
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page).toHaveURL(/\/overview$/);
    await assertAuthenticated(page.request, "ADMIN");
    logIssues("auth-admin", monitor.issues);
    expect(monitor.serious()).toEqual([]);
  });

  test("forgot-password flow accepts a request without revealing account existence", async ({ page }) => {
    await page.goto("/forgot-password");
    await expect(page.getByRole("heading", { name: /reset|forgot/i }).first()).toBeVisible();
    const emailInput = page.locator("input[type=email]").first();
    await emailInput.fill(`${uniqueTag("qa-nobody")}@speakio.test`);
    await page.getByRole("button", { name: /send|reset|continue/i }).first().click();
    await expect(page.getByText(/if an account exists/i)).toBeVisible({ timeout: 30_000 });
  });
});
