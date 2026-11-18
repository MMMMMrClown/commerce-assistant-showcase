import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../auth/auth';
import type { AuthUser } from '../common/api';
import { BenefitPageDto, UpdateBenefitPolicyDto, UpdateMemberTierDto } from './benefit.dto';
import { MemberBenefitsService } from './member-benefits.service';

@Controller('member-benefits')
export class MemberBenefitsController {
  constructor(private readonly service: MemberBenefitsService) {}
  @Get('policy')
  @RequirePermissions('member:view')
  policy() {
    return this.service.policy();
  }

  @Patch('policy')
  @RequirePermissions('member:benefits-manage')
  updatePolicy(@CurrentUser() user: AuthUser, @Body() dto: UpdateBenefitPolicyDto) {
    return this.service.updatePolicy(user, dto);
  }

  @Get('members/:id')
  @RequirePermissions('member:view')
  summary(@Param('id') id: string) {
    return this.service.summary(id);
  }

  @Patch('members/:id/tier')
  @RequirePermissions('member:benefits-manage')
  updateTier(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateMemberTierDto,
  ) {
    return this.service.updateTier(user, id, dto);
  }

  @Get('members/:id/ledger')
  @RequirePermissions('member:view', 'order:view')
  ledger(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query() query: BenefitPageDto) {
    return this.service.ledger(user, id, query);
  }

  @Get('members/:id/audits')
  @RequirePermissions('member:benefits-manage')
  audits(@Param('id') id: string) {
    return this.service.audits(id);
  }
}
