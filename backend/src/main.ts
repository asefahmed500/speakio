import 'dotenv/config';
import { createServer } from './server';

async function bootstrap() {
  const app = await createServer();
  const port = Number(process.env.PORT || 4040);
  await new Promise<void>((resolve) => app.listen(port, () => resolve()));
  const baseUrl = `http://localhost:${port}`;
  console.log('---------------------------------------------');
  console.log('  SPEAKIO BACKEND IS RUNNING');
  console.log(`  API ready:      ${baseUrl}`);
  console.log(`  Health check:   ${baseUrl}/health`);
  console.log(
    `  NODE_ENV:       ${process.env.NODE_ENV ?? 'development'} (auth cookies ${process.env.NODE_ENV === 'production' ? 'Secure' : 'not Secure — dev only'})`,
  );
  console.log('---------------------------------------------');
}

bootstrap().catch((err) => {
  console.error('Failed to bootstrap backend:', err);
  process.exit(1);
});
