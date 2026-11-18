import { Module } from '@nestjs/common';
import { CouponsController } from './coupons.controller';
import { CouponsService } from './coupons.service';

@Module({
  exports: [CouponsService],
  controllers: [CouponsController],
  providers: [CouponsService],
})
export class CouponsModule {}
