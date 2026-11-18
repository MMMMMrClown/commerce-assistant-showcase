import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertCouponUsable, assertTemplateIssuable } from './coupon-feedback';
const now = new Date('2026-11-14T04:00:00Z'),
  template = {
    id: 't',
    name: '演示满减券',
    deletedAt: null,
    startsAt: new Date('2026-11-01T00:00:00Z'),
    endsAt: new Date('2026-12-01T00:00:00Z'),
    minimumSpend: new Prisma.Decimal('100.10'),
  };
const coupon = { id: 'c', memberId: 'm', status: 'AVAILABLE', orderId: null, template };
function failure(fn: () => void) {
  try {
    fn();
    throw Error('Expected failure');
  } catch (e) {
    expect(e).toBeInstanceOf(HttpException);
    return {
      status: (e as HttpException).getStatus(),
      body: (e as HttpException).getResponse() as {
        code: string;
        message: string;
        details: Record<string, unknown>[];
      },
    };
  }
}
describe('券与模板反馈', () => {
  it.each([
    { value: null, code: 'COUPON_TEMPLATE_NOT_FOUND' },
    { value: { ...template, deletedAt: now }, code: 'COUPON_TEMPLATE_STOPPED' },
    { value: { ...template, endsAt: now }, code: 'COUPON_TEMPLATE_EXPIRED' },
  ])('发放模板不可用 $code', ({ value, code }) => {
    const e = failure(() => assertTemplateIssuable(value, now));
    expect(e.status).toBe(400);
    expect(e.body.code).toBe(code);
    expect(e.body.details[0].nextAction).toBe('SELECT_TEMPLATE');
  });
  it('未开始模板允许提前发券，但不能提前启用自动营销', () => {
    const future = { ...template, startsAt: new Date('2026-11-20T00:00:00Z') };
    expect(() => assertTemplateIssuable(future, now)).not.toThrow();
    expect(failure(() => assertTemplateIssuable(future, now, true)).body.code).toBe(
      'COUPON_TEMPLATE_NOT_STARTED',
    );
  });
  it('不存在与不属于该会员的券返回相同信息，不泄漏名称和其他会员', () => {
    const missing = failure(() => assertCouponUsable(null, 'm', new Prisma.Decimal(200), now));
    const foreign = failure(() =>
      assertCouponUsable(
        { ...coupon, memberId: 'another', template: { ...template, name: '不应泄漏的券名' } },
        'm',
        new Prisma.Decimal(200),
        now,
      ),
    );
    expect(foreign).toEqual(missing);
    expect(JSON.stringify(foreign)).not.toContain('不应泄漏');
  });
  it.each([
    { change: { status: 'RESERVED', orderId: 'private-order' }, reason: 'RESERVED' },
    { change: { status: 'USED' }, reason: 'USED' },
    { change: { status: 'VOID' }, reason: 'VOID' },
    { change: { template: { ...template, endsAt: now } }, reason: 'EXPIRED' },
    {
      change: { template: { ...template, startsAt: new Date('2026-11-20T00:00:00Z') } },
      reason: 'NOT_STARTED',
    },
  ])('保留COUPON_UNAVAILABLE并区分原因 $reason', ({ change, reason }) => {
    const e = failure(() =>
      assertCouponUsable({ ...coupon, ...change }, 'm', new Prisma.Decimal(200), now),
    );
    expect(e.status).toBe(409);
    expect(e.body.code).toBe('COUPON_UNAVAILABLE');
    expect(e.body.details[0].reason).toBe(reason);
    expect(e.body.message).toContain(template.name);
    expect(JSON.stringify(e.body)).not.toContain('private-order');
  });
  it('未达门槛以Decimal给出准确差额', () => {
    const e = failure(() => assertCouponUsable(coupon, 'm', new Prisma.Decimal('99.99'), now));
    expect(e.status).toBe(400);
    expect(e.body.code).toBe('COUPON_MINIMUM_NOT_MET');
    expect(e.body.details[0]).toMatchObject({
      originalAmount: '99.99',
      minimumSpend: '100.10',
      shortfall: '0.11',
    });
  });
  it('停止发放不阻止已有券使用，门槛相等时允许', () => {
    const existing = { ...coupon, template: { ...template, deletedAt: now } };
    expect(() =>
      assertCouponUsable(existing, 'm', new Prisma.Decimal('100.10'), now),
    ).not.toThrow();
  });
});
