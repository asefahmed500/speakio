import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

export interface ApiEndpointDoc {
  name: string;
  path: string;
}

export interface ApiInfo {
  name: string;
  description: string;
  status: 'ok';
  version: string;
  docs: ApiEndpointDoc[];
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
  latencyMs: number | null;
  uptimeSeconds: number;
  timestamp: string;
}

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  getApiInfo(): ApiInfo {
    return {
      name: 'Speakio API',
      description:
        'IELTS Prep platform — auth, test engine, AI band scoring, certificates.',
      status: 'ok',
      version: '1.0',
      docs: [
        { name: 'auth', path: '/auth' },
        { name: 'tests', path: '/tests' },
        { name: 'attempts', path: '/attempts' },
        { name: 'scoring (agent runs)', path: '/scoring' },
        { name: 'dashboard', path: '/dashboard' },
        { name: 'vocabulary', path: '/vocabulary' },
        { name: 'certificates', path: '/certificates' },
        { name: 'ai', path: '/ai' },
        { name: 'health', path: '/health' },
      ],
    };
  }

  async getHealth(): Promise<HealthReport> {
    const startedAt = Date.now();
    let database: HealthReport['database'] = 'down';
    let latencyMs: number | null = null;

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'up';
      latencyMs = Date.now() - startedAt;
    } catch {
      database = 'down';
    }

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      latencyMs,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
