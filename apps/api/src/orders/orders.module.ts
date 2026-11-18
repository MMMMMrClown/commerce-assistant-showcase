import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { MemberBenefitsModule } from '../member-benefits/member-benefits.module';

@Module({
  imports: [AuthModule, MemberBenefitsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
