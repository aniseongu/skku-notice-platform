import { Controller, Get, Module } from '@nestjs/common';
import { PublicNoticesModule } from './public-notices';

@Controller()
export class HealthController {
  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }
}

@Module({ imports: [PublicNoticesModule], controllers: [HealthController] })
export class AppModule {}
