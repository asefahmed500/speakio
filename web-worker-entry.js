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
          signal: AbortSignal.timeout(240_000),
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

    return openNext.fetch(request, env, ctx);
  },
};

export default worker;
