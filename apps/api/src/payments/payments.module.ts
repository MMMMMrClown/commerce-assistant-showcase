import { PaymentRecordsController } from './payment-records.controller';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth';
import { MemberBenefitsModule } from '../member-benefits/member-benefits.module';
import { MockPaymentGateway } from './mock-payment.gateway';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [AuthModule, MemberBenefitsModule],
  exports: [PaymentsService],
  controllers: [PaymentsController, PaymentRecordsController],
  providers: [PaymentsService, MockPaymentGateway],
})
export class PaymentsModule {}
