import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AiModule } from './ai/ai.module';
import { AgentsModule } from './agents/agents.module';
import { AuthModule } from './auth/auth.module';
import { ScoringModule } from './scoring/scoring.module';
import { TestsModule } from './tests/tests.module';
import { AttemptsModule } from './attempts/attempts.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { CertificatesModule } from './certificates/certificates.module';
import { VocabularyModule } from './vocabulary/vocabulary.module';
import { UsersModule } from './users/users.module';
import { AdminModule } from './admin/admin.module';
import { InternalModule } from './internal/internal.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    // .env loading for local dev happens via dotenv in main.ts / api/index.ts.
    // @nestjs/config was removed: v12 is ESM-only and cannot be require()d
    // from this CJS build on older Node runtimes. On Vercel, env vars are
    // injected by the platform, so no loader is needed there at all.
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 120, // global default: 120 req/min per IP
      },
    ]),
    PrismaModule,
    AiModule,
    AgentsModule,
    AuthModule,
    ScoringModule,
    TestsModule,
    AttemptsModule,
    DashboardModule,
    CertificatesModule,
    VocabularyModule,
    UsersModule,
    AdminModule,
    InternalModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
