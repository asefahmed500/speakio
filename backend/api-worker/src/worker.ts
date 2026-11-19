interface Env {
  SPEAKIO_API: DurableObjectNamespace<SpeakioApiContainer>;
  DATABASE_URL: string;
  JWT_SECRET: string;
  ZAI_API_KEY: string;
  ZAI_BASE_URL?: string;
  ZAI_MODEL_REASONING?: string;
  ZAI_MODEL_GENERAL?: string;
  ZAI_MODEL_FAST?: string;
  CF_EMAIL_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  CF_EMAIL_FROM?: string;
  FRONTEND_URL: string;
  COOKIE_SAMESITE: string;
}

const PORT = 8080;
const INACTIVITY_MS = 5 * 60 * 1000;

/** Long-lived API process. One singleton keeps Prisma connections warm. */
export class SpeakioApiContainer extends DurableObject<Env> {
  private starting?: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    if (ctx.container?.running) {
      void ctx.blockConcurrencyWhile(() =>
        ctx.container!.setInactivityTimeout(INACTIVITY_MS),
      );
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (!this.ctx.container?.running) {
      this.starting ??= this.start().finally(() => {
        this.starting = undefined;
      });
      await this.starting;
    }
    const url = new URL(request.url);
    url.protocol = "http:";
    url.host = "container";
    const forwarded = new Request(url, request);
    forwarded.headers.delete("host");
    return this.ctx.container!.getTcpPort(PORT).fetch(forwarded);
  }

  private async start(): Promise<void> {
    const container = this.ctx.container!;
    container.start({
      image: container.images.base,
      instance: "lite",
      enableInternet: true,
      env: {
        NODE_ENV: "production",
        PORT: String(PORT),
        DATABASE_URL: this.env.DATABASE_URL,
        JWT_SECRET: this.env.JWT_SECRET,
        JWT_EXPIRES_IN: "15m",
        ZAI_API_KEY: this.env.ZAI_API_KEY,
        ZAI_BASE_URL: this.env.ZAI_BASE_URL ?? "https://api.z.ai/api/paas/v4",
        ZAI_MODEL_REASONING: this.env.ZAI_MODEL_REASONING ?? "glm-4.7-flash",
        ZAI_MODEL_GENERAL: this.env.ZAI_MODEL_GENERAL ?? "glm-4.7-flash",
        ZAI_MODEL_FAST: this.env.ZAI_MODEL_FAST ?? "glm-4.7-flash",
        CF_EMAIL_API_TOKEN: this.env.CF_EMAIL_API_TOKEN ?? "",
        CF_ACCOUNT_ID: this.env.CF_ACCOUNT_ID ?? "",
        CF_EMAIL_FROM: this.env.CF_EMAIL_FROM ?? "",
        FRONTEND_URL: this.env.FRONTEND_URL,
        COOKIE_SAMESITE: this.env.COOKIE_SAMESITE,
      },
    });
    void container
      .monitor()
      .catch((error: unknown) => console.error("API container exited:", error));
    await container.setInactivityTimeout(INACTIVITY_MS);

    const port = container.getTcpPort(PORT);
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        const probe = await port.fetch("http://container/health", {
          signal: AbortSignal.timeout(1500),
        });
        await probe.body?.cancel();
        if (probe.ok) return;
      } catch {
        // not listening yet
      }
      await scheduler.wait(500);
    }
    throw new Error("API container did not become ready on port 8080");
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight is handled by the NestJS app; just forward everything.
    return env.SPEAKIO_API.getByName("speakio-api").fetch(request);
  },
} satisfies ExportedHandler<Env>;
