import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth';
import { CouponsModule } from '../coupons/coupons.module';
import { MarketingService } from './marketing.service';
import { MarketingController } from './marketing.controller';
@Module({
  imports: [AuthModule, CouponsModule],
  providers: [MarketingService],
  controllers: [MarketingController],
})
export class MarketingModule {}
