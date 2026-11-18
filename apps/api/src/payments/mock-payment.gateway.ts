import { ForbiddenException, Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type ChannelEvent = {
  id: string;
  orderId: string;
  recordId: string;
  kind: 'PAYMENT' | 'REFUND';
  attempt: number;
  amount: string;
  outcome: 'SUCCESS' | 'FAILURE';
};

@Injectable()
export class MockPaymentGateway {
  private readonly secret = randomBytes(32);

  // 【环境隔离】本地模拟不接真实资金；生产环境默认关闭，必须显式启用才可演示。
  enabled() {
    return process.env.NODE_ENV !== 'production' || process.env.MOCK_PAYMENTS_ENABLED === 'true';
  }

  assertEnabled() {
    if (!this.enabled()) throw new ForbiddenException('当前环境未启用模拟支付');
  }

  // 【渠道签名】模拟渠道生成完整事件；这是本地HMAC演示，不等于支付宝RSA验签接入。
  sign(event: ChannelEvent) {
    return createHmac('sha256', this.secret).update(JSON.stringify(event)).digest('hex');
  }

  verify(event: ChannelEvent, signature: string) {
    const expected = Buffer.from(this.sign(event), 'hex');
    const actual = Buffer.from(signature, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new ForbiddenException('支付渠道通知签名无效');
  }
}
