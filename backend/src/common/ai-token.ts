import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

/** Ask wrangler to refresh its OAuth token, then return the fresh value. */
export function refreshAiToken(): string {
  try {
    execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler', 'whoami'], {
      cwd: process.cwd(),
      stdio: 'ignore',
      timeout: 45_000,
    });
  } catch {
    // Refresh is best-effort; the caller will surface the original error.
  }
  return getAiToken();
}
