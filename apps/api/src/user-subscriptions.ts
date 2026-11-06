import { BadRequestException, Controller, Delete, Get, Headers, Injectable, Module, Param, Put, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class UserSubscriptionsService {
  private config(): { base: URL; key: string } {
    let base: URL;
    try { base = new URL(process.env.SUPABASE_URL ?? ''); }
    catch { throw new ServiceUnavailableException('Authentication service is not configured'); }
    const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? '';
    if (base.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(base.hostname)
      || base.port || base.username || base.password || base.pathname !== '/' || base.search || base.hash
      || !key.startsWith('sb_publishable_')) throw new ServiceUnavailableException('Authentication service is not configured');
    return { base, key };
  }

  async request(authorization: string | undefined, operation: 'list' | 'add' | 'remove', source?: string): Promise<unknown> {
    const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/);
    if (!match || authorization!.length > 8192) throw new UnauthorizedException();
    if (source !== undefined && !/^[a-z0-9-]{1,80}$/.test(source)) throw new BadRequestException('Invalid source');
    const { base, key } = this.config();
    const headers = { apikey: key, Authorization: `Bearer ${match[1]}` };
    let user: { id?: unknown };
    try {
      const response = await fetch(new URL('/auth/v1/user', base), { headers, signal: AbortSignal.timeout(10000), redirect: 'error' });
      if (response.status === 401 || response.status === 403) throw new UnauthorizedException();
      if (!response.ok) throw new Error('Auth unavailable');
      user = await response.json() as { id?: unknown };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new ServiceUnavailableException('Authentication service unavailable');
    }
    if (typeof user.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id)) throw new UnauthorizedException();
    const endpoint = new URL('/rest/v1/user_source_subscriptions', base);
    endpoint.searchParams.set('user_id', `eq.${user.id}`);
    if (source) endpoint.searchParams.set('source_id', `eq.${source}`);
    if (operation === 'list') endpoint.searchParams.set('select', 'source_id,notifications_enabled,created_at');
    if (operation === 'add') {
      endpoint.searchParams.delete('user_id'); endpoint.searchParams.delete('source_id');
      endpoint.searchParams.set('on_conflict', 'user_id,source_id');
    }
    try {
      const response = await fetch(endpoint, {
        method: operation === 'list' ? 'GET' : operation === 'add' ? 'POST' : 'DELETE',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: operation === 'add' ? 'resolution=ignore-duplicates,return=minimal' : 'return=minimal' },
        body: operation === 'add' ? JSON.stringify({ user_id: user.id, source_id: source }) : undefined,
        signal: AbortSignal.timeout(10000), redirect: 'error',
      });
      if (response.status === 401 || response.status === 403) throw new UnauthorizedException();
      if (!response.ok) throw new Error('Store unavailable');
      return operation === 'list' ? await response.json() : { ok: true };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new ServiceUnavailableException('Subscription store unavailable');
    }
  }
}

@Controller('me/subscriptions')
export class UserSubscriptionsController {
  constructor(private readonly service: UserSubscriptionsService) {}
  @Get() list(@Headers('authorization') auth?: string): Promise<unknown> { return this.service.request(auth, 'list'); }
  @Put(':source') add(@Param('source') source: string, @Headers('authorization') auth?: string): Promise<unknown> { return this.service.request(auth, 'add', source); }
  @Delete(':source') remove(@Param('source') source: string, @Headers('authorization') auth?: string): Promise<unknown> { return this.service.request(auth, 'remove', source); }
}

@Module({ controllers: [UserSubscriptionsController], providers: [UserSubscriptionsService] })
export class UserSubscriptionsModule {}
