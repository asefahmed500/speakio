import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import type { BrowserIssue } from "./monitor";

export const REPORT_DIR = resolve(process.cwd(), "tests/reports");
export const SCREENSHOT_DIR = resolve(REPORT_DIR, "screenshots");

export function ensureReportDirs(): void {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

/** Save a screenshot as evidence, returning its relative path. */
export async function shot(page: Page, name: string, fullPage = false): Promise<string> {
  ensureReportDirs();
  const safe = name.replace(/[^a-z0-9-_]/gi, "-").toLowerCase();
  const file = resolve(SCREENSHOT_DIR, `${safe}.png`);
  // NOTE: do not pass animations:"disabled" here — Playwright injects an
  // inline `caret-color: transparent` on inputs while capturing, which React
  // reports as a hydration mismatch when the page hydrates during the shot.
  await page.screenshot({ path: file, fullPage });
  return `tests/reports/screenshots/${safe}.png`;
}

export function logIssues(label: string, issues: BrowserIssue[]): void {
  if (issues.length) {
    console.log(`[${label}] browser issues (${issues.length}):`);
    for (const i of issues) console.log(`  - ${i.type}: ${i.text}${i.url ? ` @ ${i.url}` : ""}`);
  }
}
