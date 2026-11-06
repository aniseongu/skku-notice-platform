import { Controller, Get, Module } from '@nestjs/common';
import { PublicNoticesModule } from './public-notices';
import { UserSubscriptionsModule } from './user-subscriptions';

@Controller()
export class HealthController {
  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }
}

@Module({ imports: [PublicNoticesModule, UserSubscriptionsModule], controllers: [HealthController] })
export class AppModule {}
