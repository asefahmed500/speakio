/**
 * Vercel serverless entrypoint for the NestJS API.
 *
 * The Express instance is built once per warm lambda and cached at module
 * scope; Vercel keeps the instance alive across invocations (fluid compute),
 * so a cold Nest bootstrap only happens on the first request after a spin-up.
 */
import { createServer } from '../src/server';

type ExpressApp = (req: unknown, res: unknown) => void;

let appPromise: Promise<ExpressApp> | null = null;

function getApp(): Promise<ExpressApp> {
  if (!appPromise) {
    const bootstrap = createServer();
    // A failed bootstrap must not be cached forever — clear it on rejection.
    void bootstrap.catch(() => {
      if (appPromise === bootstrap) appPromise = null;
    });
    appPromise = bootstrap;
  }
  return appPromise;
}

export default async function handler(req: any, res: any): Promise<void> {
  try {
    const app = await getApp();
    app(req, res);
  } catch (err) {
    console.error('Backend failed to initialize:', err);
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ message: 'Backend is starting up — please retry' }));
  }
}
