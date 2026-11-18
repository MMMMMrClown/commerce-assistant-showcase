import { MockPaymentGateway, type ChannelEvent } from './mock-payment.gateway';

describe('本地模拟渠道通知认证', () => {
  const gateway = new MockPaymentGateway();
  const event: ChannelEvent = {
    id: 'event-1',
    orderId: 'order-1',
    recordId: 'pay-1',
    kind: 'PAYMENT',
    amount: '20.00',
    attempt: 1,
    outcome: 'SUCCESS',
  };
  it('校验原始签名，拒绝篡改金额和错误签名长度', () => {
    const signature = gateway.sign(event);
    expect(() => gateway.verify(event, signature)).not.toThrow();
    expect(() => gateway.verify({ ...event, amount: '1.00' }, signature)).toThrow('签名无效');
    expect(() => gateway.verify(event, 'bad')).toThrow('签名无效');
  });
  it('生产环境默认关闭模拟支付，显式配置才允许演示', () => {
    const mode = process.env.NODE_ENV,
      enabled = process.env.MOCK_PAYMENTS_ENABLED;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.MOCK_PAYMENTS_ENABLED;
      expect(() => gateway.assertEnabled()).toThrow('未启用');
      process.env.MOCK_PAYMENTS_ENABLED = 'true';
      expect(() => gateway.assertEnabled()).not.toThrow();
    } finally {
      if (mode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = mode;
      if (enabled === undefined) delete process.env.MOCK_PAYMENTS_ENABLED;
      else process.env.MOCK_PAYMENTS_ENABLED = enabled;
    }
  });
});
