import { Module } from '@nestjs/common';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { OrdersModule } from '../orders/orders.module';
import { MemberBenefitsModule } from '../member-benefits/member-benefits.module';

@Module({
  imports: [OrdersModule, MemberBenefitsModule],
  exports: [MembersService],
  controllers: [MembersController],
  providers: [MembersService],
})
export class MembersModule {}
