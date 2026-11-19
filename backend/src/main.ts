import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import { randomUUID } from 'crypto';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Honour X-Forwarded-* from one proxy hop so throttler keys use the real
  // client IP instead of the proxy's (shared) address.
  const expressApp = app.getHttpAdapter().getInstance() as {
    set: (setting: string, value: unknown) => void;
    use: (middleware: (req: any, res: any, next: () => void) => void) => void;
  };
  expressApp.set('trust proxy', 1);

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
      const isLocal =
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

  // Ensure Prisma disconnects cleanly on SIGTERM/SIGINT.
  app.enableShutdownHooks();

  const port = process.env.PORT || 4040;
  await app.listen(port);
  const baseUrl = `http://localhost:${port}`;
  console.log('---------------------------------------------');
  console.log('  SPEAKIO BACKEND IS RUNNING');
  console.log(`  API ready:      ${baseUrl}`);
  console.log(`  Health check:   ${baseUrl}/health`);
  console.log(`  CORS origin(s): ${configuredOrigins.join(', ')}`);
  console.log('---------------------------------------------');
}

bootstrap().catch((err) => {
  console.error('Failed to bootstrap backend:', err);
  process.exit(1);
});
