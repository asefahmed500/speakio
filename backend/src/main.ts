import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Honour X-Forwarded-* from one proxy hop so throttler keys use the real
  // client IP instead of the proxy's (shared) address.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());

  // Speaking submissions carry base64 audio data URLs — the default 100KB
  // JSON limit would reject legitimate recordings before validation runs.
  app.use(json({ limit: '12mb' }));

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  app.enableCors({
    origin: frontendUrl.split(',').map((o) => o.trim()),
    credentials: true,
  });

  // Ensure Prisma disconnects cleanly on SIGTERM/SIGINT.
  app.enableShutdownHooks();

  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log(`Speakio Backend API running on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error('Failed to bootstrap backend:', err);
  process.exit(1);
});
