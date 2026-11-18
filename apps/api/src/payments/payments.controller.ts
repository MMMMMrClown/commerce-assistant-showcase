import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../auth/auth';
import type { AuthUser } from '../common/api';
import { MockResultDto, RequestRefundDto } from './payment.dto';
import { PaymentsService } from './payments.service';

@Controller('orders/:id')
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  // 【查询接口】支付、退款和通知记录统一附属于有权查看的订单。
  @Get('payment')
  @RequirePermissions('order:view')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.detail(user, id);
  }

  @Post('payment')
  @RequirePermissions('order:pay')
  start(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.start(user, id);
  }

  // 【模拟渠道接口】仅授权员工可触发测试结果，不暴露未认证的成功确认接口。
  @Post('payment/mock-result')
  @RequirePermissions('order:pay')
  paymentResult(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: MockResultDto,
  ) {
    return this.service.simulate(user, id, 'PAYMENT', dto);
  }

  @Post('refund')
  @RequirePermissions('order:refund')
  refund(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RequestRefundDto) {
    return this.service.requestRefund(user, id, dto);
  }

  @Post('refund/mock-result')
  @RequirePermissions('order:refund')
  refundResult(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: MockResultDto) {
    return this.service.simulate(user, id, 'REFUND', dto);
  }
}
