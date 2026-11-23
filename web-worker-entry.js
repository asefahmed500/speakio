/**
 * Frontend Worker entrypoint.
 *
 * OpenNext generates .open-next/worker.js for the Next.js app. We wrap it with
 * a same-origin API proxy so the NestJS auth cookies are set on the FRONTEND
 * host rather than on the API Worker's host.
 *
 * Why this is required: speakio-web and speakio-api are different
 * workers.dev subdomains, and workers.dev is on the Public Suffix List — so a
 * shared Domain cookie is impossible. With the proxy, every /api/* call is
 * same-origin, host-only cookies reach the Next proxy.ts gate and the server
 * layouts, and local-dev behaviour (shared localhost cookies) is preserved.
 */
import openNext from './.open-next/worker.js';

export {
  DOQueueHandler,
  DOShardedTagCache,
  BucketCachePurge,
} from './.open-next/worker.js';

const API_ORIGIN = 'https://speakio-api.speakio.workers.dev';

/** Baseline security headers for user-facing HTML (the backend already sets
 *  these on API responses via helmet). */
function withSecurityHeaders(response, request) {
  const out = new Response(response.body, response);
  out.headers.set('x-content-type-options', 'nosniff');
  out.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  out.headers.set('x-frame-options', 'SAMEORIGIN');
  out.headers.set('permissions-policy', 'camera=(self), microphone=(self), geolocation=()');
  if (new URL(request.url).protocol === 'https:') {
    out.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  }
  return out;
}

const worker = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      const target = new URL(url.pathname.slice('/api'.length) + url.search, API_ORIGIN);
      const headers = new Headers(request.headers);
      headers.delete('host');
      headers.delete('cf-connecting-ip');
      headers.delete('cf-ipcountry');
      headers.delete('cf-ray');

      const upstream = new Request(target, {
        method: request.method,
        headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'manual',
      });

      try {
        const response = await fetch(upstream, {
          // Cloudflare caps origin waits at ~100s; a longer signal only ties
          // up subrequest slots. AI calls legitimately take up to ~60s.
          signal: AbortSignal.timeout(95_000),
        });
        // Pass Set-Cookie + status through unchanged: the browser stores the
        // cookie for speakio-web.speakio.workers.dev (same origin as the page).
        return new Response(response.body, response);
      } catch {
        return new Response(
          JSON.stringify({ message: 'API origin is temporarily unreachable' }),
          { status: 503, headers: { 'content-type': 'application/json' } },
        );
      }
    }

    return withSecurityHeaders(await openNext.fetch(request, env, ctx), request);
  },
};

export default worker;

/**
 * Cron trigger (see wrangler.jsonc). Vercel freezes a function as soon as its
 * HTTP response is sent, so AI scoring cannot finish in the submit request.
 * Each tick drives one pending attempt through the secured internal endpoint;
 * the endpoint claims jobs atomically and retries failures on later ticks.
 */
export async function scheduled(_controller, env) {
  const secret = env.CRON_SECRET;
  // Never call the internal endpoint without a secret — it fails closed.
  if (!secret) return;
  try {
    const response = await fetch(
      new URL('/internal/process-pending', API_ORIGIN),
      {
        method: 'POST',
        headers: { 'x-cron-secret': secret },
        // Stay below the API Worker's edge timeout; a job that outlives this
        // is left in SCORING and re-claimed after the stale threshold.
        signal: AbortSignal.timeout(50_000),
      },
    );
    if (!response.ok) {
      console.error(`Cron scoring driver returned ${response.status}`);
    }
  } catch (error) {
    console.error('Cron scoring driver unreachable', error);
  }
}
