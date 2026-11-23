import { Module } from '@nestjs/common';
import { AttemptsModule } from '../attempts/attempts.module';
import { InternalController } from './internal.controller';

/** Secured maintenance endpoints invoked by the Cloudflare cron trigger. */
@Module({
  imports: [AttemptsModule],
  controllers: [InternalController],
})
export class InternalModule {}
