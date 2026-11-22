import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);

/**
 * Resolves the live Cloudflare credential used for Workers AI.
 *
 * This deployment authenticates wrangler with an OAuth token that Cloudflare
 * rotates. A static copy in .env goes stale, so the token is read at call time
 * from wrangler's config. A conventional API token in ZAI_API_KEY is still the
 * fallback on machines that do not use wrangler OAuth.
 */
export function getAiToken(): string {
  const candidates = [
    process.env.APPDATA
      ? path.join(process.env.APPDATA, 'xdg.config', '.wrangler', 'config', 'default.toml')
      : '',
    path.join(os.homedir(), '.config', '.wrangler', 'config', 'default.toml'),
    path.join(os.homedir(), '.wrangler', 'config', 'default.toml'),
  ].filter(Boolean);

  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const match = fs.readFileSync(file, 'utf8').match(/oauth_token\s*=\s*["']([^"']+)["']/);
      if (match?.[1]) return match[1];
    } catch {
      // Unreadable config — fall through to the next candidate.
    }
  }
  return process.env.ZAI_API_KEY?.trim() ?? '';
}

/** Serialize concurrent refreshes so only one wrangler process runs at a time. */
let inFlight: Promise<string> | null = null;
let lastRefreshAt = 0;
const MIN_REFRESH_INTERVAL_MS = 10_000;

/**
 * Ask wrangler to refresh its OAuth token, then return the fresh value.
 *
 * MUST stay async: an earlier `execFileSync` blocked the whole Node event loop
 * for up to 45 s on every provider 401, stalling auth, health and all other
 * requests. Concurrent callers now share one in-flight refresh.
 */
export function refreshAiToken(): Promise<string> {
  if (inFlight) return inFlight;
  if (Date.now() - lastRefreshAt < MIN_REFRESH_INTERVAL_MS) {
    return Promise.resolve(getAiToken());
  }
  inFlight = (async () => {
    try {
      if (process.platform === 'win32') {
        await execFileAsync('cmd.exe', ['/c', 'npx wrangler whoami'], {
          cwd: process.cwd(),
          timeout: 45_000,
          windowsHide: true,
        });
      } else {
        await execFileAsync('npx', ['wrangler', 'whoami'], {
          cwd: process.cwd(),
          timeout: 45_000,
        });
      }
    } catch {
      // Refresh is best-effort; the caller will surface the original error.
    }
    lastRefreshAt = Date.now();
    return getAiToken();
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
