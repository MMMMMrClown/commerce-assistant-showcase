import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth';
import { MemberBenefitsController } from './member-benefits.controller';
import { MemberBenefitsService } from './member-benefits.service';

@Module({
  imports: [AuthModule],
  controllers: [MemberBenefitsController],
  providers: [MemberBenefitsService],
  exports: [MemberBenefitsService],
})
export class MemberBenefitsModule {}
