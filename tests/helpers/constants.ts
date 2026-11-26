export const APP_URL = process.env.QA_APP_URL ?? "http://localhost:3000";
export const API_URL = process.env.QA_API_URL ?? "http://localhost:4040";

/** Existing seeded administrator — used only for read/admin-page verification. */
export const ADMIN_EMAIL = process.env.QA_ADMIN_EMAIL ?? "admin@speakio.com";
export const ADMIN_PASSWORD = process.env.QA_ADMIN_PASSWORD ?? "TestAdmin123!";

/** All routes discovered from app/ (App Router) and the sidebar. */
export const PUBLIC_ROUTES = ["/", "/login", "/register", "/forgot-password", "/reset-password", "/verify"];
export const STUDENT_ROUTES = [
  "/dashboard",
  "/results",
  "/study-plan",
  "/vocabulary",
  "/skills/listening",
  "/skills/reading",
  "/skills/writing",
  "/skills/speaking",
  "/certificates",
  "/profile",
];
export const ADMIN_ROUTES = [
  "/overview",
  "/review-queue",
  "/agent-ops",
  "/students",
  "/users",
  "/question-bank",
];

export const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

export function uniqueTag(prefix = "qa"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
