import { defineConfig } from "@playwright/test";

/**
 * Speakio end-to-end browser test configuration.
 * Real Chromium, headed by default, against the locally running app.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./tests/reports/artifacts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Accommodates real AI calls and the backend's 60s registration throttle.
  timeout: 240_000,
  forbidOnly: false,
  reporter: [
    ["list"],
    ["json", { outputFile: "./tests/reports/results.json" }],
    ["html", { outputFolder: "./tests/reports/html", open: "never" }],
  ],
  globalSetup: "./tests/helpers/global-setup.ts",
  use: {
    baseURL: "http://localhost:3000",
    headless: process.env.PW_HEADLESS === "1",
    browserName: "chromium",
    viewport: { width: 1440, height: 1000 },
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    trace: process.env.PW_TRACE === "1" ? "on" : "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ignoreHTTPSErrors: true,
    launchOptions: {
      args: ["--start-maximized", "--disable-dev-shm-usage"],
    },
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { viewport: { width: 1440, height: 1000 } },
    },
  ],
});
