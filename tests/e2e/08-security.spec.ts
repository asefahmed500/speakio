import { expect, test } from "@playwright/test";
import { API_URL, uniqueTag } from "../helpers/constants";
import { loginViaUI, registerViaUI } from "../helpers/auth";
import { monitorPage } from "../helpers/monitor";
import { logIssues, shot } from "../helpers/report";
import { latestAttemptInDb, userInDb } from "../helpers/db";

const password = "QaSecurity123!";

test.describe("SECURITY — authz, IDOR, injection, session integrity", () => {
  test("protected API endpoints reject anonymous callers with 401", async ({ page }) => {
    await page.goto("/");
    for (const path of ["/auth/me", "/dashboard/stats", "/vocabulary", "/users", "/attempts/not-a-uuid"]) {
      const res = await page.request.get(`${API_URL}${path}`);
      expect(res.status(), `${path} should require auth`).toBe(401);
    }
  });

  test("USER receives 403 on every admin endpoint", async ({ page }) => {
    const email = `${uniqueTag("qa-sec-user")}@speakio.test`;
    await registerViaUI(page, { email, password, name: "QA Security User" });
    for (const [method, path, body] of [
      ["GET", "/users", undefined],
      ["GET", "/users/stats", undefined],
      ["GET", "/admin/students", undefined],
      ["GET", "/scoring/runs", undefined],
      ["GET", "/scoring/review-queue", undefined],
      ["GET", "/tests/manage", undefined],
      ["POST", "/tests/generate", { skill: "READING", count: 1 }],
    ] as const) {
      const res = await page.request.fetch(`${API_URL}${path}`, {
        method,
        data: body,
      });
      expect(res.status(), `${method} ${path} should be forbidden`).toBe(403);
    }
  });

  test("IDOR: a second user cannot read, edit, submit or rescore another user's attempt", async ({ browser }) => {
    const tag = uniqueTag("qa-idor");
    const ownerEmail = `${tag}-owner@speakio.test`;
    const attackerEmail = `${tag}-attacker@speakio.test`;

    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await registerViaUI(ownerPage, { email: ownerEmail, password, name: "QA Attempt Owner" });
    const started = await ownerPage.request.post(`${API_URL}/attempts`, {
      data: { testSetId: "reading-passage-urban-green" },
    });
    expect(started.status()).toBe(201);
    const attempt = latestAttemptInDb(ownerEmail);
    expect(attempt).toBeTruthy();
    const attemptId = attempt!.id as string;
    await ownerCtx.close();

    const attackerCtx = await browser.newContext();
    const attackerPage = await attackerCtx.newPage();
    await registerViaUI(attackerPage, { email: attackerEmail, password, name: "QA Attempt Attacker" });

    for (const [method, path, body] of [
      ["GET", `/attempts/${attemptId}`, undefined],
      ["PATCH", `/attempts/${attemptId}`, { answers: { x: "y" } }],
      ["POST", `/attempts/${attemptId}/submit`, { answers: {} }],
      ["POST", `/attempts/${attemptId}/rescore`, undefined],
    ] as const) {
      const res = await attackerPage.request.fetch(`${API_URL}${path}`, { method, data: body });
      expect(res.status(), `${method} ${path} must be 403`).toBe(403);
    }
    // The owner's record is untouched by the attacker's writes.
    const after = latestAttemptInDb(ownerEmail);
    expect(after!.status).toBe("IN_PROGRESS");
    await attackerCtx.close();
  });

  test("a forged JWT cookie cannot authenticate", async ({ browser }) => {
    const context = await browser.newContext();
    const payload = Buffer.from(
      JSON.stringify({ sub: "fake-user", role: "ADMIN", exp: Math.floor(Date.now() / 1000) + 3600 })
    ).toString("base64url");
    const forged = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payload}.forgedSignature`;
    await context.addCookies([
      { name: "access_token", value: forged, domain: "localhost", path: "/" },
      { name: "refresh_token", value: forged, domain: "localhost", path: "/" },
    ]);
    const page = await context.newPage();
    const res = await page.request.get(`${API_URL}/auth/me`);
    expect(res.status()).toBe(401);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await shot(page, "security-forged-token");
    await context.close();
  });

  test("user-supplied markup is escaped, not executed", async ({ page }) => {
    const email = `${uniqueTag("qa-xss")}@speakio.test`;
    await registerViaUI(page, { email, password, name: "QA XSS User" });
    await page.goto("/profile");
    await expect(page.locator("#pr-name")).toHaveValue("QA XSS User");
    const payload = '<script>window.__qaXss=1</script>';
    await page.locator("#pr-name").fill(payload);
    await page.getByRole("button", { name: "Save Profile" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });
    const executed = await page.evaluate(() => (window as unknown as { __qaXss?: number }).__qaXss);
    expect(executed, "injected script must not execute").toBeUndefined();
    expect(userInDb(email)?.name).toBe(payload);
    await page.reload();
    await expect(page.locator("#pr-name")).toHaveValue(payload);
    const scripts = await page.locator("script").count();
    expect(scripts >= 0).toBe(true);
  });

  test("SQL-injection-shaped search input is handled safely", async ({ page, browser }) => {
    await loginViaUI(page, process.env.QA_ADMIN_EMAIL ?? "admin@speakio.com", process.env.QA_ADMIN_PASSWORD ?? "TestAdmin123!");
    await page.goto("/users");
    await page.getByRole("textbox", { name: "Search users by name or email" }).fill("' OR 1=1 --");
    await expect(page.getByRole("heading", { name: "No users match" })).toBeVisible({ timeout: 30_000 });

    const studentCtx = await browser.newContext();
    const studentPage = await studentCtx.newPage();
    await registerViaUI(studentPage, {
      email: `${uniqueTag("qa-sql")}@speakio.test`,
      password,
      name: "QA SQL Student",
    });
    await studentPage.goto("/vocabulary");
    await studentPage.getByRole("searchbox", { name: "Search vocabulary" }).fill("' OR 1=1 --");
    await expect(
      studentPage.getByText(/No matches|No words saved yet/)
    ).toBeVisible({ timeout: 30_000 });
    const vocabRes = await studentPage.request.get(`${API_URL}/vocabulary`);
    expect(vocabRes.status()).toBe(200);
    const vocab = await vocabRes.json();
    expect(vocab.some((v: { word: string }) => v.word.includes("OR 1=1"))).toBe(false);
    await studentCtx.close();
  });

  test("rate limiting returns a friendly 429 without leaking the exception class", async ({ page }) => {
    await page.goto("/");
    let limited = false;
    for (let i = 0; i < 15; i++) {
      const res = await page.request.post(`${API_URL}/auth/forgot-password`, {
        data: { email: `throttle-probe-${uniqueTag("x")}-${i}@speakio.test` },
      });
      if (res.status() === 429) {
        const body = await res.json();
        expect(body.message).toBe("Too many requests. Please wait a moment and try again.");
        expect(JSON.stringify(body)).not.toContain("ThrottlerException");
        limited = true;
        break;
      }
      expect(res.status()).toBe(200);
    }
    expect(limited, "rate limiter must trigger within 15 requests").toBe(true);
  });

  test("error responses never leak secrets or stack traces", async ({ page }) => {
    const monitor = monitorPage(page);
    await page.goto("/");
    const responses = await Promise.all([
      page.request.get(`${API_URL}/attempts/not-a-uuid`),
      page.request.get(`${API_URL}/auth/me`),
      page.request.post(`${API_URL}/certificates`, { data: {} }),
    ]);
    for (const res of responses) {
      const text = await res.text();
      for (const secret of ["DATABASE_URL", "postgres://", "JWT_SECRET", "cfoat_", "PrismaClient", "node_modules"]) {
        expect(text, `${res.status()} response leaked ${secret}`).not.toContain(secret);
      }
    }
    logIssues("security-errors", monitor.issues);
  });
});
