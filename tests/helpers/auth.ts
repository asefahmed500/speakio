import { expect, type Page, type APIRequestContext } from "@playwright/test";
import { API_URL } from "./constants";

export interface TestUser {
  email: string;
  password: string;
  name: string;
}

/**
 * Submit the real registration form, retrying only on conditions the app
 * reports itself: the 60s rate-limit window and transient backend/network
 * outages. Any other error is surfaced as a genuine failure.
 */
async function submitRegistration(page: Page): Promise<void> {
  for (let attempt = 1; attempt <= 6; attempt++) {
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await page.waitForFunction(
      () => {
        if (/\/dashboard$/.test(window.location.pathname)) return true;
        const alert = document.querySelector('[role="alert"]');
        return Boolean(alert?.textContent?.trim());
      },
      null,
      { timeout: 45_000 }
    );

    if (/\/dashboard$/.test(new URL(page.url()).pathname)) return;

    const message = (await page.getByRole("alert").first().textContent())?.trim() ?? "";
    if (/too many requests|429/i.test(message)) {
      console.log(`[register] rate limited (attempt ${attempt}); waiting for the 60s window`);
      await page.waitForTimeout(65_000);
      continue;
    }
    if (/unable to reach|timed out|network|service|try again/i.test(message)) {
      console.log(`[register] transient service error (attempt ${attempt}): ${message}`);
      await page.waitForTimeout(4_000);
      continue;
    }
    throw new Error(`registration rejected: ${message}`);
  }
  throw new Error("registration did not succeed after 6 attempts");
}

/** Real UI registration — no direct API shortcut. */
export async function registerViaUI(
  page: Page,
  user: TestUser,
  targetBand = "7.5"
): Promise<void> {
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
  await page.locator("#reg-name").fill(user.name);
  await page.locator("#reg-email").fill(user.email);
  await page.locator("#reg-password").fill(user.password);
  await page.getByRole("button", { name: targetBand, exact: true }).click();
  await submitRegistration(page);
}

/** Real UI login through the sign-in form. */
export async function loginViaUI(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
}

/** Sign out through the sidebar confirmation dialog. */
export async function logoutViaUI(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 });
}

export async function authMe(
  request: APIRequestContext
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await request.get(`${API_URL}/auth/me`);
  let body: Record<string, unknown> | null = null;
  try {
    body = await res.json();
  } catch {
    /* ignore */
  }
  return { status: res.status(), body };
}

/** Verify the browser's cookie jar really authenticates an API call. */
export async function assertAuthenticated(request: APIRequestContext, role?: string): Promise<void> {
  const { status, body } = await authMe(request);
  expect(status, `auth/me expected 200, got ${status}`).toBe(200);
  if (role) expect(body?.role).toBe(role);
}
