import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { CurrentUser, RequirePermissions } from '../auth/auth';
import type { AuthUser } from '../common/api';
import { MarketingService } from './marketing.service';
class ConfigureProgramDto {
  @IsBoolean() enabled!: boolean;
  @IsOptional() @IsString() templateId?: string | null;
  @IsInt() @Min(1) version!: number;
}
@Controller('marketing')
export class MarketingController {
  constructor(private readonly service: MarketingService) {}
  @Get('programs') @RequirePermissions('member:view') list() {
    return this.service.list();
  }
  @Patch('programs/:kind')
  @RequirePermissions('member:view', 'member:benefits-manage', 'member:coupon-issue')
  configure(
    @CurrentUser() user: AuthUser,
    @Param('kind') kind: string,
    @Body() dto: ConfigureProgramDto,
  ) {
    return this.service.configure(user, kind, dto);
  }
  @Get('programs/:kind/grants') @RequirePermissions('member:view') records(
    @Param('kind') kind: string,
    @Query() query: Record<string, string>,
  ) {
    return this.service.records(kind, query);
  }
  @Post('programs/:kind/run')
  @RequirePermissions('member:view', 'member:benefits-manage', 'member:coupon-issue')
  run(@Param('kind') kind: string) {
    return this.service.sweep(kind);
  }
  @Post('grants/:id/retry')
  @RequirePermissions('member:view', 'member:benefits-manage', 'member:coupon-issue')
  retry(@Param('id') id: string) {
    return this.service.process(id, true);
  }
}
