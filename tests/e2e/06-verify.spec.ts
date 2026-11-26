import { expect, test } from "@playwright/test";
import { API_URL, uniqueTag } from "../helpers/constants";
import { monitorPage } from "../helpers/monitor";
import { logIssues, shot } from "../helpers/report";
import { latestCertificate } from "../helpers/db";

test.describe("PUBLIC VERIFICATION — no authentication required", () => {
  test("unknown certificate code shows a clear not-found state", async ({ page }) => {
    const monitor = monitorPage(page);
    const code = `NOT-A-REAL-CODE-${uniqueTag("x").toUpperCase()}`;
    await page.goto("/verify");
    await expect(page.getByRole("heading", { name: "Verify a certificate" })).toBeVisible();
    await page.locator("#verify-code").fill(code);
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(new RegExp(`/verify/${encodeURIComponent(code)}`));
    await expect(page.getByText(/no certificate matches/i)).toBeVisible({ timeout: 30_000 });
    await shot(page, "verify-not-found");
    logIssues("verify-unknown", monitor.issues);
    expect(monitor.serious()).toEqual([]);
  });

  test("a real certificate is publicly verifiable from DB data (including revocation)", async ({ page }) => {
    const cert = latestCertificate();
    if (!cert) {
      console.log("[verify] no certificate in DB — skipping live lookup (not marked passed)");
      test.skip(true, "no certificate in database");
      return;
    }
    const code = String(cert.verificationCode);
    const response = await page.request.get(`${API_URL}/certificates/verify/${encodeURIComponent(code)}`);
    expect(response.status(), "public verification API must not require auth").toBe(200);
    const body = await response.json();
    expect(String(body.certificateNumber)).toBe(String(cert.certificateNumber));
    expect(body.status).toBe(String(cert.status));

    await page.goto(`/verify/${encodeURIComponent(code)}`);
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.getByText(String(cert.certificateNumber))).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(cert.status === "REVOKED" ? "Revoked" : "Verified", { exact: false }).first()).toBeVisible();
    await shot(page, "verify-real-certificate", true);
  });

  test("verification page requires no session cookies", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/verify");
    await expect(page.getByRole("heading", { name: "Verify a certificate" })).toBeVisible();
    const cookies = await context.cookies();
    expect(cookies.filter((c) => /token/i.test(c.name))).toEqual([]);
    await context.close();
  });
});
