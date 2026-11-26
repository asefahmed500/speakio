import type { Page } from "@playwright/test";

export interface BrowserIssue {
  type: "console-error" | "console-warning" | "pageerror" | "requestfailed" | "response-5xx";
  text: string;
  url?: string;
}

interface SeenResponse {
  status: number;
  url: string;
}

/** Benign dev-only noise we still record but do not fail a test on. */
export const BENIGN_PATTERNS = [
  /scroll-behavior: smooth/,
  /Next\.js dev tools/i,
  /Download the React DevTools/i,
  /source map/i,
  /favicon\.ico/i,
  /\[Fast Refresh\]/i,
  // Playwright's screenshot helper injects `caret-color: transparent` inline
  // on inputs to hide the caret in evidence images. When a screenshot lands
  // during React hydration, React reports that injected inline style as a
  // mismatch. No application code sets caret-color, so this exact signature
  // is a harness artifact; all other hydration warnings remain actionable.
  /caret-color:\\?"transparent\\?"/,
];

export function isBenign(issue: BrowserIssue): boolean {
  return BENIGN_PATTERNS.some((p) => p.test(issue.text));
}

/**
 * Attach listeners BEFORE navigation so every console message, JS exception,
 * failed request and 5xx response during the page lifetime is captured.
 */
export function monitorPage(page: Page): {
  issues: BrowserIssue[];
  serious: () => BrowserIssue[];
  acknowledgeAiOutage: (endpoint: string) => void;
} {
  const issues: BrowserIssue[] = [];
  const responses: SeenResponse[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      issues.push({ type: "console-error", text: msg.text(), url: page.url() });
    } else if (msg.type() === "warning") {
      issues.push({ type: "console-warning", text: msg.text(), url: page.url() });
    }
  });
  page.on("pageerror", (err) => {
    issues.push({ type: "pageerror", text: err.message, url: page.url() });
  });
  page.on("requestfailed", (req) => {
    const failure = req.failure()?.errorText ?? "unknown";
    if (/ERR_ABORTED/.test(failure)) return; // normal navigation cancellation
    issues.push({
      type: "requestfailed",
      text: `${req.method()} ${req.url()} :: ${failure}`,
      url: req.url(),
    });
  });
  page.on("response", (res) => {
    responses.push({ status: res.status(), url: res.url() });
    if (res.status() >= 500) {
      issues.push({
        type: "response-5xx",
        text: `${res.status()} ${res.request().method()} ${res.url()}`,
        url: res.url(),
      });
    }
  });

  const serious = (): BrowserIssue[] =>
    issues.filter((issue) => {
      if (isBenign(issue)) return false;
      if (issue.type === "console-warning") return false;
      // The browser logs a generic "Failed to load resource: status NNN"
      // console error for every HTTP error response, including ones the app
      // handles deliberately (guest auth probes, validation errors in the
      // tests). Only excuse it when that exact status was actually observed
      // on the wire. Real 5xx responses are still flagged separately as
      // `response-5xx`, so server failures can never be hidden this way.
      if (issue.type === "console-error") {
        const match = issue.text.match(/status of (\d{3})/);
        if (match && responses.some((r) => r.status === Number(match[1]))) {
          return false;
        }
      }
      return true;
    });

  /**
   * A 503 from an AI endpoint is an external-provider outage, not a frontend
   * or backend defect — but only acknowledge it once the test has verified
   * the application displayed its designed fallback and persisted data.
   */
  const acknowledgeAiOutage = (endpoint: string): void => {
    for (let i = issues.length - 1; i >= 0; i--) {
      const issue = issues[i];
      if (issue.type === "response-5xx" && (issue.url ?? "").includes(endpoint)) {
        issues.splice(i, 1);
      } else if (issue.type === "console-error" && /status of 503/.test(issue.text)) {
        issues.splice(i, 1);
      }
    }
  };

  return { issues, serious, acknowledgeAiOutage };
}
