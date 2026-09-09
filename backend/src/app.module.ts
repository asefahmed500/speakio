import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
