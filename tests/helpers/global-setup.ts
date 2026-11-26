import { APP_URL, API_URL } from "./constants";

/** Fail fast, with a clear message, if either service is not running. */
export default async function globalSetup(): Promise<void> {
  for (const [name, url] of [
    ["frontend", `${APP_URL}/`],
    ["backend", `${API_URL}/health`],
  ] as const) {
    let ready = false;
    let lastError: unknown;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (res.ok) {
          if (name === "backend") {
            const health = (await res.json()) as { database?: string };
            if (health.database !== "up") throw new Error("database is not up");
          }
          ready = true;
          break;
        }
        lastError = new Error(`${name} returned ${res.status}`);
      } catch (err) {
        lastError = err;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!ready) {
      throw new Error(`[global-setup] ${name} at ${url} is not ready: ${String(lastError)}`);
    }
  }
}
