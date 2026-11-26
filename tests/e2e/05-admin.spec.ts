import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, API_URL, uniqueTag } from "../helpers/constants";
import { loginViaUI, registerViaUI } from "../helpers/auth";
import { monitorPage } from "../helpers/monitor";
import { logIssues, shot } from "../helpers/report";
import { userInDb } from "../helpers/db";

const password = "QaAdminPass123!";

test.describe("ADMIN — staff workflows, RBAC and content controls", () => {
  test("user management: search, role change, suspend and reactivate persist to DB", async ({ page, browser }) => {
    const monitor = monitorPage(page);
    const email = `${uniqueTag("qa-manage")}@speakio.test`;

    // Create the target user through the real UI in an isolated context.
    const userContext = await browser.newContext();
    const userPage = await userContext.newPage();
    await registerViaUI(userPage, { email, password, name: "QA Managed User" });
    await userContext.close();

    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/users");
    await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();

    await page.getByRole("textbox", { name: "Search users by name or email" }).fill(email);
    const row = page.locator("tr").filter({ hasText: email });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await shot(page, "admin-users-search");

    // Grant admin -> DB role changes.
    await row.getByRole("combobox", { name: /Change role for/ }).selectOption("ADMIN");
    const roleDialog = page.getByRole("dialog", { name: /Grant administrator access/ });
    await expect(roleDialog).toBeVisible();
    await roleDialog.getByRole("button", { name: "Grant admin access" }).click();
    await expect.poll(() => userInDb(email)?.role).toBe("ADMIN");

    // Remove admin access again.
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("combobox", { name: /Change role for/ }).selectOption("USER");
    const removeDialog = page.getByRole("dialog", { name: /Remove administrator access/ });
    await expect(removeDialog).toBeVisible();
    await removeDialog.getByRole("button", { name: "Remove admin access" }).click();
    await expect.poll(() => userInDb(email)?.role).toBe("USER");

    // Suspend -> account is blocked; reactivate restores it.
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: "Suspend" }).click();
    const suspendDialog = page.getByRole("dialog", { name: /Suspend this account/ });
    await expect(suspendDialog).toBeVisible();
    await suspendDialog.getByRole("button", { name: "Suspend account" }).click();
    await expect.poll(() => userInDb(email)?.status).toBe("SUSPENDED");

    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: "Reactivate" }).click();
    const reactivateDialog = page.getByRole("dialog", { name: /Reactivate this account/ });
    await expect(reactivateDialog).toBeVisible();
    await reactivateDialog.getByRole("button", { name: "Reactivate account" }).click();
    await expect.poll(() => userInDb(email)?.status).toBe("ACTIVE");

    // Invalid filter value is rejected rather than returning raw data.
    const bad = await page.request.get(`${API_URL}/users?role=NOPE`);
    expect(bad.status()).toBe(400);
    logIssues("admin-users", monitor.issues);
    expect(monitor.serious()).toEqual([]);
  });

  test("question bank loads real sets and exposes answer keys only to admin", async ({ page }) => {
    const monitor = monitorPage(page);
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/question-bank");
    await expect(page.getByRole("heading", { name: /question bank/i })).toBeVisible();
    const firstRow = page.locator("button").filter({ hasText: /questions/ }).first();
    await expect(firstRow).toBeVisible({ timeout: 30_000 });
    const fullResponsePromise = page.waitForResponse(
      (r) => /\/tests\/[^/]+\/full(\?|$)/.test(r.url()) && r.status() === 200,
      { timeout: 30_000 }
    );
    await firstRow.click();
    const fullResponse = await fullResponsePromise;
    const setId = fullResponse.url().match(/\/tests\/([^/]+)\/full/)?.[1];
    expect(setId, "a real test set id must be returned").toBeTruthy();
    const full = await fullResponse.json();
    expect(Array.isArray(full.questions) && full.questions.length > 0).toBe(true);
    expect(
      "correctAnswer" in full.questions[0] || "acceptedAnswers" in full.questions[0],
      "admin full view must include the answer key"
    ).toBe(true);
    await shot(page, "admin-question-bank-expanded", true);

    // A USER must not see answer keys in the student-facing detail endpoint.
    const studentContext = await page.context().browser()!.newContext();
    const studentEmail = `${uniqueTag("qa-answer-leak")}@speakio.test`;
    const studentPage = await studentContext.newPage();
    await registerViaUI(studentPage, { email: studentEmail, password, name: "QA Content Student" });
    const detail = await studentPage.request.get(`${API_URL}/tests/${setId}`);
    expect(detail.status()).toBe(200);
    const detailText = await detail.text();
    expect(detailText).not.toContain("correctAnswer");
    expect(detailText).not.toContain("acceptedAnswers");
    await studentContext.close();
    logIssues("admin-content", monitor.issues);
    expect(monitor.serious()).toEqual([]);
  });

  test("review queue and agent ops filters load real agent data", async ({ page }) => {
    const monitor = monitorPage(page);
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    await page.goto("/review-queue");
    await expect(page.locator("h1").first()).toBeVisible();
    await shot(page, "admin-review-queue", true);

    await page.goto("/agent-ops");
    await expect(page.locator("h1").first()).toBeVisible();
    await shot(page, "admin-agent-ops", true);

    for (const endpoint of ["/scoring/runs", "/scoring/review-queue", "/users/stats", "/admin/students"]) {
      const res = await page.request.get(`${API_URL}${endpoint}`);
      expect(res.status(), `${endpoint} returned ${res.status()}`).toBe(200);
    }
    logIssues("admin-ops", monitor.issues);
    expect(monitor.serious()).toEqual([]);
  });
});
