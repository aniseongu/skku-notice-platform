import { Controller, Get, Headers, Injectable, Module, Query, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class NoticeQuery {
  @IsOptional() @IsString() @Matches(/^[a-z0-9-]{1,80}$/)
  source?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 30;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000)
  offset = 0;
}

@Injectable()
export class PublicNoticesService {
  // 공지 표는 로그인한 사용자만 읽는다. 사용자 토큰을 그대로 넘겨 RLS가 판단하게 한다.
  private bearer(authorization: string | undefined): string {
    const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/);
    if (!match || authorization!.length > 8192) throw new UnauthorizedException();
    return match[1];
  }

  private config(): { parsed: URL; key: string } {
    const url = process.env.SUPABASE_URL ?? '';
    const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? '';
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new ServiceUnavailableException('Public notice store is not configured'); }
    if (parsed.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname)
      || parsed.port || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash
      || !key.startsWith('sb_publishable_')) {
      throw new ServiceUnavailableException('Public notice store is not configured');
    }
    return { parsed, key };
  }

  private async read(table: string, params: URLSearchParams, authorization: string | undefined): Promise<unknown> {
    const token = this.bearer(authorization);
    const { parsed, key } = this.config();
    const endpoint = new URL(`/rest/v1/${table}`, parsed);
    endpoint.search = params.toString();
    try {
      const response = await fetch(endpoint, {
        headers: { apikey: key, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000), redirect: 'error',
      });
      if (response.status === 401 || response.status === 403) throw new UnauthorizedException();
      if (!response.ok) throw new Error('Store unavailable');
      return await response.json();
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new ServiceUnavailableException('Notice store unavailable');
    }
  }

  // 준비 확인은 공지 표를 읽지 않고(로그인 전용) 인증 서비스 상태만 본다.
  async ready(): Promise<void> {
    const { parsed, key } = this.config();
    try {
      const response = await fetch(new URL('/auth/v1/health', parsed), { headers: { apikey: key }, signal: AbortSignal.timeout(10000), redirect: 'error' });
      if (!response.ok) throw new Error('Auth unavailable');
    } catch { throw new ServiceUnavailableException('Notice store unavailable'); }
  }

  sources(authorization: string | undefined): Promise<unknown> {
    return this.read('platform_sources', new URLSearchParams({ select: 'id,name,url,last_success_at', order: 'id' }), authorization);
  }

  notices(query: NoticeQuery, authorization: string | undefined): Promise<unknown> {
    const params = new URLSearchParams({
      select: 'id,source_id,article_no,title,category,url,posted_on,pinned,deadline,first_seen,changed_at,change_kind,previous_title',
      order: 'posted_on.desc,id.desc', limit: String(query.limit), offset: String(query.offset),
    });
    if (query.source) params.set('source_id', `eq.${query.source}`);
    return this.read('platform_notices', params, authorization);
  }
}

@Controller()
export class PublicNoticesController {
  constructor(private readonly service: PublicNoticesService) {}
  @Get('ready') async ready(): Promise<{ status: string }> {
    await this.service.ready();
    return { status: 'ok' };
  }
  @Get('sources') sources(@Headers('authorization') auth?: string): Promise<unknown> { return this.service.sources(auth); }
  @Get('notices') notices(@Query() query: NoticeQuery, @Headers('authorization') auth?: string): Promise<unknown> { return this.service.notices(query, auth); }
}

@Module({ controllers: [PublicNoticesController], providers: [PublicNoticesService] })
export class PublicNoticesModule {}
