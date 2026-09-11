import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Honour X-Forwarded-* from one proxy hop so throttler keys use the real
  // client IP instead of the proxy's (shared) address.
  const expressApp = app.getHttpAdapter().getInstance() as {
    set: (setting: string, value: unknown) => void;
  };
  expressApp.set('trust proxy', 1);

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

  const port = process.env.PORT || 5000;
  await app.listen(port);
  const baseUrl = `http://localhost:${port}`;
  console.log('---------------------------------------------');
  console.log('  SPEAKIO BACKEND IS RUNNING');
  console.log(`  API ready:      ${baseUrl}`);
  console.log(`  Health check:   ${baseUrl}/health`);
  console.log(`  CORS origin(s): ${frontendUrl}`);
  console.log('---------------------------------------------');
}

bootstrap().catch((err) => {
  console.error('Failed to bootstrap backend:', err);
  process.exit(1);
});
