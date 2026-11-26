import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import { randomUUID } from 'crypto';
import { AppModule } from './app.module';
import { ThrottlerFilter } from './common/throttler-filter';

/**
 * Builds the fully configured Express instance without binding a port.
 * `main.ts` listens on it for local/VM runs; the Vercel serverless entry
 * (`api/index.ts`) awaits it and hands requests straight to Express.
 */
type AppInstance = ((req: unknown, res: unknown) => void) & {
  set: (setting: string, value: unknown) => void;
  use: (middleware: (req: any, res: any, next: () => void) => void) => void;
  listen: (port: number, cb?: () => void) => void;
};

export async function createServer(): Promise<AppInstance> {
  const app = await NestFactory.create(AppModule, { logger: false });

  // Honour X-Forwarded-* from one proxy hop so throttler keys use the real
  // client IP instead of the proxy's (shared) address.
  const expressApp = app.getHttpAdapter().getInstance() as AppInstance;
  expressApp.set('trust proxy', 1);

  app.useGlobalFilters(new ThrottlerFilter());
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());

  // Correlation IDs: every request gets an ID echoed back in x-request-id and
  // included in the completion log, so a user report can be traced to one
  // request without logging secrets or payloads.
  expressApp.use((req: any, res: any, next: () => void) => {
    const id = String(req.headers['x-request-id'] ?? randomUUID()).slice(0, 64);
    req.requestId = id;
    res.setHeader('x-request-id', id);
    const start = Date.now();
    res.on('finish', () => {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          type: 'request',
          id,
          method: req.method,
          path: String(req.originalUrl ?? req.url).split('?')[0],
          status: res.statusCode,
          ms: Date.now() - start,
        }),
      );
    });
    next();
  });

  // Speaking submissions carry base64 audio data URLs — the default 100KB
  // JSON limit would reject legitimate recordings before validation runs.
  app.use(json({ limit: '12mb' }));

  const configuredOrigins: string[] = (
    process.env.FRONTEND_URL || 'http://localhost:3000'
  )
    .split(',')
    .map((o: string) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ): void => {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (configuredOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      // Only trust private-network origins in development. In production a
      // page on the LAN could otherwise make credentialed cross-origin calls.
      const isLocal =
        process.env.NODE_ENV !== 'production' &&
        /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(
          origin,
        );
      if (isLocal) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  });

  // Ensure Prisma disconnects cleanly on SIGTERM/SIGINT (and serverless freeze).
  app.enableShutdownHooks();

  await app.init();
  return expressApp;
}
