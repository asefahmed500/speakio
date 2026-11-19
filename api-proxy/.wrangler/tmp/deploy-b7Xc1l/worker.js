// src/worker.ts
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = new URL(env.API_ORIGIN);
    const target = new URL(url.pathname + url.search, origin);
    const headers = new Headers(request.headers);
    headers.delete("cf-connecting-ip");
    headers.delete("cf-ipcountry");
    headers.delete("cf-ray");
    const upstream = new Request(target, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? void 0 : request.body,
      redirect: "manual"
    });
    try {
      const response = await fetch(upstream, {
        signal: AbortSignal.timeout(24e4)
      });
      const out = new Response(response.body, response);
      return out;
    } catch {
      return new Response(
        JSON.stringify({ message: "API origin is temporarily unreachable" }),
        { status: 503, headers: { "content-type": "application/json" } }
      );
    }
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
