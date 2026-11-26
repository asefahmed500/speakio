import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, API_URL, uniqueTag } from "../helpers/constants";
import { loginViaUI, registerViaUI } from "../helpers/auth";
import { gotoApp } from "../helpers/navigation";
import { monitorPage } from "../helpers/monitor";
import { logIssues, shot } from "../helpers/report";
import { latestAttemptInDb, scoresInDb } from "../helpers/db";

const password = "QaExtended123!";

async function student(page: import("@playwright/test").Page, prefix: string) {
  const email = `${uniqueTag(prefix)}@speakio.test`;
  await registerViaUI(page, { email, password, name: "QA Extended User" });
  return email;
}

async function beginTest(page: import("@playwright/test").Page, skillUrl: string, cta: RegExp) {
  await gotoApp(page, skillUrl);
  await expect(page.getByRole("link", { name: cta }).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: cta }).first().click();
  await page.getByRole("button", { name: /I am Ready — Begin Exam/ }).click();
}

test.describe("EXTENDED FEATURES — PRD flows not covered by the core suites", () => {
  test("Listening exam renders a working audio console and submits a graded attempt", async ({ page }) => {
    test.setTimeout(240_000);
    const monitor = monitorPage(page);
    const email = await student(page, "qa-listening");
    await beginTest(page, "/skills/listening", /Start Listening Test/);

    await expect(page.getByText("OFFICIAL AUDIO STIMULUS")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start Audio Track" })).toBeVisible();
    // Mute is a local-only control — safe to exercise without external TTS.
    await page.getByRole("button", { name: "Mute audio" }).click();
    await expect(page.getByRole("button", { name: "Unmute audio" })).toBeVisible();
    await page.getByRole("button", { name: "Unmute audio" }).click();
    await shot(page, "ext-listening-audio-console");

    if (await page.locator('input[type="radio"]').count()) {
      await page.locator('input[type="radio"]').first().check();
    } else {
      await page.locator('input[type="text"]').first().fill("answer");
    }
    const submitResponse = page.waitForResponse(
      (r) => r.url().includes("/submit") && r.request().method() === "POST",
      { timeout: 120_000 }
    );
    await page.getByRole("button", { name: /Submit Test for AI Evaluation/ }).click();
    const submit = await submitResponse;
    expect([200, 201]).toContain(submit.status());

    const attempt = latestAttemptInDb(email);
    expect(attempt).toBeTruthy();
    expect(["COMPLETED", "SCORING", "NEEDS_REVIEW", "SUBMITTED"]).toContain(attempt!.status);
    const scores = scoresInDb(attempt!.id as string);
    expect(scores.length, "listening must be auto-graded").toBeGreaterThan(0);
    logIssues("ext-listening", monitor.issues);
    expect(monitor.serious()).toEqual([]);
  });

  test("Writing exam enforces the word gate, submits to AI and stores criterion scores", async ({ page }) => {
    test.setTimeout(360_000);
    const monitor = monitorPage(page);
    const email = await student(page, "qa-writing");
    await beginTest(page, "/skills/writing", /Begin Writing Exam/);

    const essay = page.locator('textarea[id^="q-"]').first();
    await expect(essay).toBeVisible();
    const submitButton = page.getByRole("button", { name: /Submit Test for AI Evaluation/ });
    await expect(submitButton).toBeDisabled();
    await essay.fill(
      "Many people believe that governments should invest more in public transport. " +
      "This essay will argue that better buses and trains reduce traffic congestion and improve air quality. " +
      "Firstly, reliable public transport encourages commuters to leave their cars at home, which cuts emissions. " +
      "Secondly, affordable fares give lower income citizens better access to jobs and education. " +
      "In conclusion, investing in transport is both an environmental and a social priority."
    );
    await expect(page.locator("span").filter({ hasText: /^\d+ words$/ }).first()).toBeVisible();
    await expect(submitButton).toBeEnabled();
    await shot(page, "ext-writing-desk", true);

    const submitResponse = page.waitForResponse(
      (r) => r.url().includes("/submit") && r.request().method() === "POST",
      { timeout: 180_000 }
    );
    await submitButton.click();
    const submit = await submitResponse;
    console.log(`[writing] submit returned ${submit.status()}`);
    expect([200, 201]).toContain(submit.status());

    const attempt = latestAttemptInDb(email);
    expect(attempt).toBeTruthy();
    await expect.poll(() => scoresInDb(attempt!.id as string).length, { timeout: 180_000 }).toBeGreaterThan(0);
    const score = scoresInDb(attempt!.id as string)[0];
    console.log(`[writing] band=${score.bandScore} scoredBy=${score.scoredBy} confidence=${score.confidence}`);
    expect(Number(score.bandScore)).toBeGreaterThan(0);
    await gotoApp(page, `/results/${attempt!.id}`);
    await expect(page.locator("h1").first()).toBeVisible();
    await shot(page, "ext-writing-result", true);
    logIssues("ext-writing", monitor.issues);
    expect(monitor.serious()).toEqual([]);
  });

  test("Reading exam tools: font scaling, flag, question navigation and save indicator", async ({ page }) => {
    test.setTimeout(180_000);
    const monitor = monitorPage(page);
    await student(page, "qa-reading-tools");
    await beginTest(page, "/skills/reading", /Start Reading Test/);

    await expect(page.getByRole("button", { name: "Larger Font" })).toBeVisible();
    await page.getByRole("button", { name: "Larger Font" }).click();
    await expect(page.getByRole("button", { name: "Standard Font" })).toBeVisible();
    await page.getByRole("button", { name: "Flag", exact: true }).click();
    await expect(page.getByRole("button", { name: "Flagged for Review" })).toBeVisible();
    const nextBefore = page.locator('[title*="Question 1"]').first();
    await expect(nextBefore).toBeVisible();
    await page.getByRole("button", { name: "Next question" }).click();
    await expect(page.locator('[title*="Question 2"]').first()).toBeVisible();
    await expect(page.getByText(/Saving…|Saved/).first()).toBeVisible({ timeout: 40_000 });
    await shot(page, "ext-reading-tools");
    logIssues("ext-reading-tools", monitor.issues);
    expect(monitor.serious()).toEqual([]);
  });

  test("Certificates page shows real eligibility and blocks ineligible issuance", async ({ page }) => {
    test.setTimeout(120_000);
    const monitor = monitorPage(page);
    await student(page, "qa-certificates");
    await gotoApp(page, "/certificates");
    await expect(page.getByRole("heading", { name: /certificate/i }).first()).toBeVisible();
    await page.getByRole("button", { name: /Issue new certificate/ }).click();
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 30_000 });
    await shot(page, "ext-certificates-eligibility", true);

    const eligibility = await page.request.get(`${API_URL}/certificates/eligibility`);
    expect(eligibility.status()).toBe(200);
    const body = await eligibility.json();
    expect(body).toHaveProperty("eligible");
    expect(Array.isArray(body.skills)).toBe(true);
    expect(Array.isArray(body.missingSkills)).toBe(true);
    logIssues("ext-certificates", monitor.issues);
    expect(monitor.serious()).toEqual([]);
  });

  test("all four skill hubs load real test lists and per-skill KPIs", async ({ page }) => {
    const monitor = monitorPage(page);
    await student(page, "qa-skill-hubs");
    for (const [route, cta] of [
      ["/skills/listening", /Start Listening Test/],
      ["/skills/reading", /Start Reading Test/],
      ["/skills/writing", /Begin Writing Exam/],
      ["/skills/speaking", /Enter Examiner Room/],
    ] as const) {
      await gotoApp(page, route);
      await expect(page.getByRole("link", { name: cta }).first()).toBeVisible({ timeout: 30_000 });
      const summary = await page.request.get(`${API_URL}/dashboard/skills/${route.split("/").pop()!.toUpperCase()}`);
      expect(summary.status(), `${route} KPI API`).toBe(200);
    }
    logIssues("ext-skill-hubs", monitor.issues);
    expect(monitor.serious()).toEqual([]);
  });

  test("admin student roster search opens a real per-student detail page", async ({ page, browser }) => {
    const email = `${uniqueTag("qa-student-record")}@speakio.test`;
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await registerViaUI(p, { email, password, name: "QA Student Record" });
    await ctx.close();

    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await gotoApp(page, "/students");
    await page.getByRole("textbox", { name: "Search students by name or email" }).fill(email);
    const row = page.locator("tr").filter({ hasText: email });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/students\//);
    await expect(page.locator("h1").first()).toBeVisible();
    await shot(page, "ext-admin-student-detail", true);
  });

  test("agent ops filters and retry guards are enforced server-side", async ({ page }) => {
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await gotoApp(page, "/agent-ops");
    await expect(page.locator("h1").first()).toBeVisible();

    const runs = await page.request.get(`${API_URL}/scoring/runs?status=DONE`);
    expect(runs.status()).toBe(200);
    const list = await runs.json();
    expect(Array.isArray(list)).toBe(true);
    const retry = await page.request.post(
      `${API_URL}/scoring/runs/00000000-0000-0000-0000-000000000000/retry`
    );
    expect(retry.status()).toBe(404);
  });

  test("deep link is honoured after login and dialog keyboard dismissal works", async ({ page }) => {
    await page.goto("/study-plan");
    await expect(page).toHaveURL(/\/login\?next=%2Fstudy-plan/);
    await page.locator("#login-email").fill(ADMIN_EMAIL);
    await page.locator("#login-password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/study-plan$/, { timeout: 30_000 });

    await page.getByRole("button", { name: "Sign out" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});
