import { expect, test } from "@playwright/test";
import { uniqueTag } from "../helpers/constants";
import { loginViaUI, registerViaUI } from "../helpers/auth";
import { monitorPage } from "../helpers/monitor";
import { logIssues, shot } from "../helpers/report";
import { studyPlanInDb, userInDb, vocabInDb } from "../helpers/db";
import { gotoApp } from "../helpers/navigation";

const password = "QaCrudPass123!";

async function newStudent(page: import("@playwright/test").Page, prefix: string) {
  const email = `${uniqueTag(prefix)}@speakio.test`;
  await registerViaUI(page, { email, password, name: "QA CRUD Student" });
  return email;
}

test.describe("STUDENT CRUD — browser → API → PostgreSQL", () => {
  test("vocabulary full lifecycle: validate, create, read, refresh, search, delete", async ({ page }) => {
    const monitor = monitorPage(page);
    await newStudent(page, "qa-vocab");
    await page.goto("/vocabulary");
    await expect(page.getByRole("heading", { name: "Vocabulary", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Add word" }).click();
    const dialog = page.getByRole("dialog", { name: "Add word" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Save word" })).toBeDisabled();

    const word = `qa-token-${uniqueTag("w")}`;
    await dialog.locator("#vw-word").fill(word);
    await dialog.locator("#vw-def").fill("A controlled test definition for end-to-end verification.");
    await dialog.locator("#vw-example").fill("The QA suite verified this example sentence.");
    await dialog.locator("#vw-topic").selectOption("Technology");
    await dialog.locator("#vw-band").selectOption("8.0");
    await dialog.locator("#vw-syn").fill("verify, confirm");
    await dialog.locator("#vw-colloc").fill("verify a result");
    await expect(dialog.getByRole("button", { name: "Save word" })).toBeEnabled();
    await dialog.getByRole("button", { name: "Save word" }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { name: word, exact: true })).toBeVisible();
    const dbRows = vocabInDb(word);
    expect(dbRows.length).toBe(1);
    expect(dbRows[0].topic).toBe("Technology");
    expect(Number(dbRows[0].bandTarget)).toBe(8);
    await shot(page, "crud-vocab-created");

    // Refresh — persistence must come from the API, not client state.
    await page.reload();
    await expect(page.getByRole("heading", { name: word, exact: true })).toBeVisible();

    // Search and topic filters.
    await page.getByRole("searchbox", { name: "Search vocabulary" }).fill(word);
    await expect(page.getByRole("heading", { name: word, exact: true })).toBeVisible();
    await page.getByRole("searchbox", { name: "Search vocabulary" }).fill("no-such-word-zzz");
    await expect(page.getByText("No matches")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByRole("heading", { name: word, exact: true })).toBeVisible();
    await page.getByRole("group", { name: "Filter by topic" }).getByRole("button", { name: "Environment" }).click();
    await expect(page.getByText("No matches")).toBeVisible();
    await page.getByRole("group", { name: "Filter by topic" }).getByRole("button", { name: "All" }).click();

    // Delete: cancel keeps it, confirm removes it from UI and database.
    await page.getByRole("button", { name: `Delete ${word}` }).click();
    const confirm = page.getByRole("dialog", { name: "Delete this word?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Keep it" }).click();
    await expect(page.getByRole("heading", { name: word, exact: true })).toBeVisible();

    await page.getByRole("button", { name: `Delete ${word}` }).click();
    await confirm.getByRole("button", { name: "Delete word" }).click();
    await expect(page.getByRole("heading", { name: word, exact: true })).toHaveCount(0);
    await expect.poll(() => vocabInDb(word).length).toBe(0);

    logIssues("crud-vocab", monitor.issues);
    expect(monitor.serious()).toEqual([]);
  });

  test("profile update persists and password change revokes the old session", async ({ page }) => {
    test.setTimeout(120_000);
    const monitor = monitorPage(page);
    const email = await newStudent(page, "qa-profile");
    await page.goto("/profile");
    // Wait for the server-fed form defaults to hydrate before editing.
    await expect(page.locator("#pr-name")).toHaveValue("QA CRUD Student");

    // Invalid profile data is rejected by the client schema.
    await page.locator("#pr-name").fill("");
    await page.getByRole("button", { name: "Save Profile" }).click();
    await expect(page.getByText("Name must be at least 2 characters")).toBeVisible();

    await page.locator("#pr-name").fill("QA Updated Candidate");
    await page.locator("#pr-band").selectOption("8.5");
    await page.getByRole("button", { name: "Save Profile" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => {
      const row = userInDb(email);
      return row?.name === "QA Updated Candidate" && Number(row.targetBand) === 8.5;
    }).toBe(true);

    // Password mismatch client validation.
    await page.locator("#pr-current").fill(password);
    await page.locator("#pr-new").fill("BrandNewPass456!");
    await page.locator("#pr-confirm").fill("DifferentPass456!");
    await page.getByRole("button", { name: "Update Password" }).click();
    await expect(page.getByText("New passwords do not match")).toBeVisible();

    // Wrong current password produces a real server error.
    await page.locator("#pr-current").fill("NotMyPassword123!");
    await page.locator("#pr-confirm").fill("BrandNewPass456!");
    await page.getByRole("button", { name: "Update Password" }).click();
    await expect(page.locator("p[role=alert]").last()).toBeVisible({ timeout: 20_000 });

    // Correct change signs out and requires the new password.
    await page.locator("#pr-current").fill(password);
    await page.getByRole("button", { name: "Update Password" }).click();
    await expect(page).toHaveURL(/\/login\?passwordChanged=1/, { timeout: 30_000 });
    await loginViaUI(page, email, "BrandNewPass456!");
    await expect(page).toHaveURL(/\/dashboard$/);
    await shot(page, "crud-profile-password-changed");
    logIssues("crud-profile", monitor.issues);
    expect(monitor.serious()).toEqual([]);
  });

  test("study plan preferences persist to DB and plan generation works or falls back safely", async ({ page }) => {
    test.setTimeout(240_000);
    const monitor = monitorPage(page);
    const email = await newStudent(page, "qa-studyplan");
    await page.goto("/study-plan");

    const future = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);
    await page.locator("#sp-exam-date").fill(future);
    await page.locator("#sp-daily").fill("60");
    await page.locator("#sp-weakest").selectOption("SPEAKING");
    await page.getByRole("button", { name: "Save Parameters" }).click();
    await expect(page.getByText("Saved to account")).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => {
      const row = studyPlanInDb(email);
      return Number(row?.dailyCommitmentMinutes) === 60 && row?.weakestSkill === "SPEAKING";
    }).toBe(true);

    const aiResponse = page.waitForResponse(
      (r) => r.url().includes("/ai/study-plan") && r.request().method() === "POST",
      { timeout: 120_000 }
    );
    await page.getByRole("button", { name: "Generate AI Plan" }).first().click();
    const res = await aiResponse;
    console.log(`[study-plan] AI provider responded ${res.status()}`);
    if (res.status() >= 500) {
      await expect(page.getByText(/AI coach unavailable/)).toBeVisible({ timeout: 20_000 });
      monitor.acknowledgeAiOutage("/ai/study-plan");
    }
    // The app is designed to fall back to a local template when the AI
    // provider is unavailable; either way a plan must be persisted.
    await expect.poll(() => {
      const row = studyPlanInDb(email);
      const plan = row?.studyPlanJson as unknown[] | null | undefined;
      return Array.isArray(plan) && plan.length > 0;
    }, { timeout: 60_000 }).toBe(true);

    await page.reload();
    await expect(page.getByRole("button", { name: "Regenerate Plan" })).toBeVisible();
    await shot(page, "crud-study-plan", true);
    logIssues("crud-studyplan", monitor.issues);
    expect(monitor.serious()).toEqual([]);
  });

  test("AI paraphrase integration responds or reports a real error", async ({ page }) => {
    test.setTimeout(180_000);
    await newStudent(page, "qa-paraphrase");
    await gotoApp(page, "/vocabulary");
    await page.getByRole("textbox", { name: "Sentence to rewrite" }).fill(
      "The government should invest in public transport to reduce congestion."
    );
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes("/ai/paraphrase") && r.request().method() === "POST",
      { timeout: 120_000 }
    );
    await page.getByRole("button", { name: "Rewrite" }).click();
    const res = await responsePromise;
    console.log(`[paraphrase] AI provider responded ${res.status()}`);
    if (res.status() === 200 || res.status() === 201) {
      const rewriter = page.locator("section").filter({ hasText: "Academic rewriter" });
      await expect(rewriter.locator("li p").first()).toBeVisible({ timeout: 30_000 });
    } else {
      await expect(page.getByRole("alert")).toBeVisible();
    }
  });
});
