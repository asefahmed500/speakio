interface Env {
  API_ORIGIN: string;
}

/**
 * Edge reverse-proxy for the Speakio API on the free Workers plan.
 * Keeps a stable *.workers.dev API hostname in front of the origin; the
 * upstream is a Cloudflare Tunnel to the NestJS process. All auth, CORS and
 * rate-limit decisions remain in the origin — this worker only forwards.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = new URL(env.API_ORIGIN);
    const target = new URL(url.pathname + url.search, origin);

    const headers = new Headers(request.headers);
    // Cloudflare CONNECT headers are not useful to the origin.
    headers.delete("cf-connecting-ip");
    headers.delete("cf-ipcountry");
    headers.delete("cf-ray");

    const upstream = new Request(target, {
      method: request.method,
      headers,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : request.body,
      redirect: "manual",
    });

    try {
      const response = await fetch(upstream, {
        // Cloudflare's edge cap is ~100s; 95s leaves a small safety margin.
        signal: AbortSignal.timeout(95_000),
      });
      const out = new Response(response.body, response);
      // Preserve CORS headers emitted by the origin (credentials + allowlist).
      return out;
    } catch {
      return new Response(
        JSON.stringify({ message: "API origin is temporarily unreachable" }),
        { status: 503, headers: { "content-type": "application/json" } },
      );
    }
  },
} satisfies ExportedHandler<Env>;
