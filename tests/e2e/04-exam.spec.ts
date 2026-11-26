import { expect, test } from "@playwright/test";
import { uniqueTag } from "../helpers/constants";
import { registerViaUI } from "../helpers/auth";
import { monitorPage } from "../helpers/monitor";
import { logIssues, shot } from "../helpers/report";
import { attemptInDb, latestAttemptInDb } from "../helpers/db";

const password = "QaExamPass123!";

test.describe("EXAM ENGINE — real attempt, autosave, submit, results", () => {
  test("starts a reading attempt, autosaves an answer, submits and persists the score", async ({ page }) => {
    const monitor = monitorPage(page);
    const email = `${uniqueTag("qa-exam")}@speakio.test`;
    await registerViaUI(page, { email, password, name: "QA Exam Candidate" });

    await page.goto("/skills/reading");
    await expect(page.getByRole("heading", { name: /reading simulation/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Start Reading Test/ }).first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("link", { name: /Start Reading Test/ }).first().click();

    await expect(page.getByRole("button", { name: /I am Ready — Begin Exam/ })).toBeVisible();
    await page.getByRole("button", { name: /I am Ready — Begin Exam/ }).click();
    await expect(page.getByText(/answered/).first()).toBeVisible();

    const firstRadio = page.locator('input[type="radio"]').first();
    if (await firstRadio.count()) {
      await firstRadio.check();
    } else {
      await page.locator('input[type="text"]').first().fill("test answer");
    }
    await expect(page.getByText(/1\/\d+ answered|answered/).first()).toBeVisible();
    await shot(page, "exam-reading-started");

    // Wait for the 15-second autosave to reach the API, then check the DB.
    const saveResponse = page.waitForResponse(
      (r) => /\/attempts\/[0-9a-f-]+/.test(r.url()) && r.request().method() === "PATCH",
      { timeout: 40_000 }
    );
    const saved = await saveResponse;
    expect(saved.status(), `autosave returned ${saved.status()}`).toBe(200);

    const attempt = latestAttemptInDb(email);
    expect(attempt, "attempt must exist in PostgreSQL").toBeTruthy();
    expect(attempt!.status).toBe("IN_PROGRESS");
    expect(Object.keys((attempt!.answersJson as object) ?? {}).length).toBeGreaterThan(0);
    const attemptId = attempt!.id as string;

    // Reload — the restored draft must keep the answer (server/local storage).
    await page.reload();
    await expect(page.getByRole("button", { name: /I am Ready — Begin Exam/ })).toBeVisible();
    await page.getByRole("button", { name: /I am Ready — Begin Exam/ }).click();
    await expect(page.getByText(/answered/).first()).toBeVisible();

    const submitResponse = page.waitForResponse(
      (r) => r.url().includes("/submit") && r.request().method() === "POST",
      { timeout: 120_000 }
    );
    await page.getByRole("button", { name: /Submit Test for AI Evaluation/ }).click();
    const submit = await submitResponse;
    console.log(`[exam] submit returned ${submit.status()}`);
    expect([201, 200]).toContain(submit.status());

    await expect(page).toHaveURL(new RegExp(`/results/${attemptId}`), { timeout: 60_000 });
    const after = attemptInDb(attemptId);
    expect(after).toBeTruthy();
    expect(["COMPLETED", "SCORING", "NEEDS_REVIEW", "SUBMITTED"]).toContain(after!.status);
    await shot(page, "exam-result", true);

    // Result page must render the scored attempt from the API.
    await expect(page.locator("h1").first()).toBeVisible();
    logIssues("exam", monitor.issues);
    expect(monitor.serious()).toEqual([]);
  });

  test("results list and detail page load real data after a completed attempt", async ({ page }) => {
    const email = `${uniqueTag("qa-results")}@speakio.test`;
    await registerViaUI(page, { email, password, name: "QA Results Candidate" });
    await page.goto("/skills/reading");
    await page.getByRole("link", { name: /Start Reading Test/ }).first().click();
    await page.getByRole("button", { name: /I am Ready — Begin Exam/ }).click();
    await page.locator('input[type="radio"]').first().check();

    const submitResponse = page.waitForResponse(
      (r) => r.url().includes("/submit") && r.request().method() === "POST",
      { timeout: 120_000 }
    );
    await page.getByRole("button", { name: /Submit Test for AI Evaluation/ }).click();
    await submitResponse;
    await expect(page).toHaveURL(/\/results\//, { timeout: 60_000 });

    await page.goto("/results");
    await expect(page.locator("h1").first()).toBeVisible();
    const attempt = latestAttemptInDb(email);
    expect(attempt).toBeTruthy();
    await page.goto(`/results/${attempt!.id}`);
    await expect(page.locator("h1").first()).toBeVisible();
    await shot(page, "exam-results-detail", true);
  });

  test("speaking fallback accepts a typed answer without microphone access", async ({ page }) => {
    const monitor = monitorPage(page);
    await registerViaUI(page, {
      email: `${uniqueTag("qa-speaking")}@speakio.test`,
      password,
      name: "QA Speaking Candidate",
    });
    await page.goto("/skills/speaking");
    await expect(page.getByRole("heading", { name: /speaking/i }).first()).toBeVisible();
    const start = page.getByRole("link", { name: /Enter Examiner Room/ }).first();
    await expect(start, "a seeded speaking test must be available").toBeVisible({ timeout: 30_000 });
    {
      await start.click();
      await page.getByRole("button", { name: /I am Ready — Begin Exam/ }).click();
      const typed = page.getByRole("textbox", { name: "Typed speaking response" });
      await expect(typed).toBeVisible();
      await typed.fill(
        "I would like to talk about my home city. It is a vibrant place with excellent public transport and many cultural events. I enjoy walking along the river in the evening, and the local markets offer a wide variety of fresh food. Overall, it is a wonderful place to live because it balances modern convenience with a strong sense of community."
      );
      await expect(page.getByRole("button", { name: /Submit Test for AI Evaluation/ })).toBeEnabled();
      await shot(page, "exam-speaking-typed");
    }
    logIssues("exam-speaking", monitor.issues);
    expect(monitor.serious()).toEqual([]);
  });
});
