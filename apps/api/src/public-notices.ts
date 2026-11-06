import { Controller, Get, Injectable, Module, Query, ServiceUnavailableException } from '@nestjs/common';
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
  private async read(table: string, params: URLSearchParams): Promise<unknown> {
    const url = process.env.SUPABASE_URL ?? '';
    const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? '';
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new ServiceUnavailableException('Public notice store is not configured'); }
    if (parsed.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname)
      || parsed.port || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash
      || !key.startsWith('sb_publishable_')) {
      throw new ServiceUnavailableException('Public notice store is not configured');
    }
    const endpoint = new URL(`/rest/v1/${table}`, parsed);
    endpoint.search = params.toString();
    try {
      const response = await fetch(endpoint, { headers: { apikey: key }, signal: AbortSignal.timeout(10000), redirect: 'error' });
      if (!response.ok) throw new Error('Store unavailable');
      return await response.json();
    } catch { throw new ServiceUnavailableException('Public notice store unavailable'); }
  }

  sources(): Promise<unknown> {
    return this.read('platform_sources', new URLSearchParams({ select: 'id,name,url,last_success_at', order: 'id' }));
  }

  notices(query: NoticeQuery): Promise<unknown> {
    const params = new URLSearchParams({
      select: 'id,source_id,article_no,title,category,url,posted_on,pinned,deadline,first_seen,changed_at,change_kind,previous_title',
      order: 'posted_on.desc,id.desc', limit: String(query.limit), offset: String(query.offset),
    });
    if (query.source) params.set('source_id', `eq.${query.source}`);
    return this.read('platform_notices', params);
  }
}

@Controller()
export class PublicNoticesController {
  constructor(private readonly service: PublicNoticesService) {}
  @Get('ready') async ready(): Promise<{ status: string }> {
    await this.service.sources();
    return { status: 'ok' };
  }
  @Get('sources') sources(): Promise<unknown> { return this.service.sources(); }
  @Get('notices') notices(@Query() query: NoticeQuery): Promise<unknown> { return this.service.notices(query); }
}

@Module({ controllers: [PublicNoticesController], providers: [PublicNoticesService] })
export class PublicNoticesModule {}
