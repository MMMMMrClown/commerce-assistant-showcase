import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { ApiExceptionFilter } from '../src/common/api';
import { PrismaService } from '../src/prisma/prisma.service';
import { SeckillService } from '../src/seckill/seckill.service';
import { PaymentsService } from '../src/payments/payments.service';
import { MockPaymentGateway, type ChannelEvent } from '../src/payments/mock-payment.gateway';
import type { AuthUser } from '../src/common/api';

type RecordRow = { id: string; attempt: number; status: string; amount: string; reason: string };
const data = <T>(r: request.Response) => (r.body as { data: T }).data;

describe('模拟支付退款业务闭环（隔离PostgreSQL）', () => {
  let app: INestApplication<App>, db: PrismaClient;
  let admin: string, clerk: string;
  const p = 'pay-' + randomUUID();
  let n = 0;
  const post = (path: string, body: object = {}, token = admin) =>
    request(app.getHttpServer())
      .post('/api/v1' + path)
      .auth(token, { type: 'bearer' })
      .send(body);
  const get = (path: string, token = admin) =>
    request(app.getHttpServer())
      .get('/api/v1' + path)
      .auth(token, { type: 'bearer' });
  const pay = (id: string) => post('/orders/' + id + '/payment');
  const notify = (id: string, outcome = 'SUCCESS', attempt = 1, kind = 'payment') =>
    post(`/orders/${id}/${kind}/mock-result`, { outcome, attempt });
  const refund = (id: string, reason = '顾客申请退款') =>
    post('/orders/' + id + '/refund', { reason });
  async function create(mode = 'NONE', memberId?: string) {
    const member = memberId
      ? await db.member.findUniqueOrThrow({ where: { id: memberId } })
      : await db.member.create({ data: { name: '支付会员', phone: p + ++n } });
    const input: Record<string, unknown> = {
      storeId: p,
      memberId: member.id,
      benefitMode: mode,
      items: [{ productId: p, quantity: 1 }],
    };
    let couponId: string | undefined;
    let activityId: string | undefined;
    if (mode === 'COUPON') {
      const template = await db.couponTemplate.create({
        data: {
          name: '满20减5',
          minimumSpend: 20,
          discountAmount: 5,
          startsAt: new Date(Date.now() - 60000),
          endsAt: new Date(Date.now() + 3600000),
        },
      });
      const coupon = await db.memberCoupon.create({
        data: {
          memberId: member.id,
          templateId: template.id,
          issuedById: p + 'admin',
          requestId: randomUUID(),
        },
      });
      couponId = coupon.id;
      input.couponId = couponId;
    }
    if (mode === 'SECKILL') {
      const a = await db.seckillActivity.create({
        data: {
          name: '支付秒杀',
          productId: p,
          price: '9.90',
          stock: 1,
          remainingStock: 1,
          startsAt: new Date(Date.now() - 60000),
          endsAt: new Date(Date.now() + 3600000),
          holdMinutes: 1,
        },
      });
      activityId = a.id;
      input.activityId = a.id;
    }
    const q = data<{ quoteHash: string }>(await post('/orders/quote', input).expect(201));
    const order = data<{ id: string }>(
      await post('/orders', { ...input, quoteHash: q.quoteHash, requestId: randomUUID() }).expect(
        201,
      ),
    );
    return { id: order.id, memberId: member.id, couponId, activityId };
  }
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    app.get(SeckillService).onModuleDestroy();
    db = app.get(PrismaService);
    await db.region.create({ data: { id: p, code: p, name: '支付测试区域' } });
    await db.store.createMany({
      data: [p, p + 'foreign'].map((id) => ({
        id,
        code: id,
        name: '支付门店',
        regionId: p,
        address: 'test',
        openedAt: new Date(),
      })),
    });
    await db.productCategory.create({ data: { id: p, code: p, name: '支付分类' } });
    await db.product.create({
      data: {
        id: p,
        code: p,
        name: '支付商品',
        categoryId: p,
        price: 20,
        costPrice: 0,
        stockOnHand: 10000,
      },
    });
    const perms = await db.permission.findMany({
      where: {
        code: { in: ['order:view', 'order:create', 'order:cancel', 'order:pay', 'order:refund'] },
      },
    });
    expect(perms).toHaveLength(5);
    for (const kind of ['admin', 'clerk']) {
      await db.role.create({
        data: {
          id: p + kind,
          code: p + kind,
          name: kind,
          dataScope: kind === 'admin' ? 'ALL' : 'STORE',
          permissions: {
            create: perms
              .filter((v) => kind === 'admin' || v.code !== 'order:refund')
              .map((v) => ({ permissionId: v.id })),
          },
        },
      });
      await db.user.create({
        data: {
          id: p + kind,
          username: p + kind,
          name: kind,
          passwordHash: 'test-only',
          storeId: kind === 'clerk' ? p : null,
          roles: { create: { roleId: p + kind } },
        },
      });
    }
    const jwt = app.get(JwtService);
    admin = jwt.sign({ sub: p + 'admin' });
    clerk = jwt.sign({ sub: p + 'clerk' });
  }, 30000);
  afterAll(async () => {
    await app?.close();
  });

  it('并发发起支付只生成一份支付记录，金额来自订单且未提前入账', async () => {
    const o = await create();
    const replies = await Promise.all([pay(o.id), pay(o.id), pay(o.id)]);
    expect(replies.every((r) => r.status === 201)).toBe(true);
    expect(new Set(replies.map((r) => data<RecordRow>(r).id)).size).toBe(1);
    const row = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(row.status).toBe('PENDING_PAYMENT');
    expect(row.paidAmount.toFixed(2)).toBe('0.00');
    expect(await db.memberBenefitLedger.count({ where: { orderId: o.id } })).toBe(0);
  });

  it('并发重复支付通知只入账一次，迟到失败不能覆盖成功', async () => {
    const o = await create();
    await pay(o.id).expect(201);
    const replies = await Promise.all([notify(o.id), notify(o.id), notify(o.id)]);
    expect(replies.every((r) => r.status === 201)).toBe(true);
    const member = await db.member.findUniqueOrThrow({ where: { id: o.memberId } });
    expect(member.totalSpent.toFixed(2)).toBe('20.00');
    expect(member.points).toBe(20);
    expect(await db.memberBenefitLedger.count({ where: { orderId: o.id } })).toBe(1);
    expect(await db.paymentEvent.count({ where: { orderId: o.id } })).toBe(1);
    await notify(o.id, 'FAILURE').expect(409);
  });

  it('支付失败不核销不记账，重试增加尝试号并拒绝旧通知', async () => {
    const o = await create('COUPON');
    await pay(o.id).expect(201);
    await notify(o.id, 'FAILURE').expect(201);
    expect((await db.memberCoupon.findUniqueOrThrow({ where: { id: o.couponId } })).status).toBe(
      'RESERVED',
    );
    expect(data<RecordRow>(await pay(o.id).expect(201)).attempt).toBe(2);
    await notify(o.id, 'SUCCESS', 1).expect(409);
    await notify(o.id, 'SUCCESS', 2).expect(201);
    expect((await db.memberCoupon.findUniqueOrThrow({ where: { id: o.couponId } })).status).toBe(
      'USED',
    );
    expect(
      (await db.member.findUniqueOrThrow({ where: { id: o.memberId } })).totalSpent.toFixed(2),
    ).toBe('15.00');
  });

  it('整单退款申请不提前回冲，失败可重试，重复成功只返券和回冲一次', async () => {
    const o = await create('COUPON');
    await pay(o.id).expect(201);
    await notify(o.id).expect(201);
    const replies = await Promise.all([refund(o.id), refund(o.id)]);
    expect(replies.every((r) => r.status === 201)).toBe(true);
    expect(new Set(replies.map((r) => data<RecordRow>(r).id)).size).toBe(1);
    await refund(o.id, '不同原因').expect(409);
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('PAID');
    await notify(o.id, 'FAILURE', 1, 'refund').expect(201);
    expect((await db.member.findUniqueOrThrow({ where: { id: o.memberId } })).points).toBe(15);
    expect(data<RecordRow>(await refund(o.id).expect(201)).attempt).toBe(2);
    await notify(o.id, 'SUCCESS', 1, 'refund').expect(409);
    const results = await Promise.all([
      notify(o.id, 'SUCCESS', 2, 'refund'),
      notify(o.id, 'SUCCESS', 2, 'refund'),
    ]);
    expect(results.every((r) => r.status === 201)).toBe(true);
    const member = await db.member.findUniqueOrThrow({ where: { id: o.memberId } });
    expect(member.points).toBe(0);
    expect(member.totalSpent.toFixed(2)).toBe('0.00');
    const order = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(order.status).toBe('REFUNDED');
    expect(order.paidAmount.toFixed(2)).toBe('15.00');
    const coupon = await db.memberCoupon.findUniqueOrThrow({ where: { id: o.couponId } });
    expect(coupon.status).toBe('AVAILABLE');
    expect(coupon.orderId).toBeNull();
    expect(await db.memberBenefitLedger.count({ where: { orderId: o.id } })).toBe(2);
    await notify(o.id).expect(201); // 退款后的原支付重放也不能重新入账。
    expect((await db.member.findUniqueOrThrow({ where: { id: o.memberId } })).points).toBe(0);
  });

  it('退款返券不延长原有效期，即使模板已软删除也按原规则退款', async () => {
    const o = await create('COUPON');
    await pay(o.id).expect(201);
    await notify(o.id).expect(201);
    const coupon = await db.memberCoupon.findUniqueOrThrow({ where: { id: o.couponId } });
    const end = new Date(Date.now() - 1000);
    await db.couponTemplate.update({
      where: { id: coupon.templateId },
      data: { endsAt: end, deletedAt: new Date() },
    });
    await refund(o.id).expect(201);
    await notify(o.id, 'SUCCESS', 1, 'refund').expect(201);
    expect(
      (await db.couponTemplate.findUniqueOrThrow({ where: { id: coupon.templateId } })).endsAt,
    ).toEqual(end);
    expect((await db.memberCoupon.findUniqueOrThrow({ where: { id: coupon.id } })).status).toBe(
      'AVAILABLE',
    );
  });

  it('退款使用原始积分流水而不是新规则倍率', async () => {
    const o = await create();
    await pay(o.id).expect(201);
    await notify(o.id).expect(201);
    await db.member.update({ where: { id: o.memberId }, data: { tierOverride: 'DIAMOND' } });
    await refund(o.id).expect(201);
    await notify(o.id, 'SUCCESS', 1, 'refund').expect(201);
    const entry = await db.memberBenefitLedger.findUniqueOrThrow({
      where: { orderId_kind: { orderId: o.id, kind: 'REFUND' } },
    });
    expect(entry.pointsDelta).toBe(-20);
  });

  it('已取消和到期订单拒绝确认支付，取消同时关闭原支付记录', async () => {
    const o = await create();
    await pay(o.id).expect(201);
    await post('/orders/' + o.id + '/cancel').expect(201);
    await notify(o.id).expect(409);
    await pay(o.id).expect(409);
    expect((await db.paymentRecord.findUniqueOrThrow({ where: { orderId: o.id } })).status).toBe(
      'CLOSED',
    );
    const s = await create('SECKILL');
    await pay(s.id).expect(201);
    await db.order.update({
      where: { id: s.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await notify(s.id).expect(409);
    await app.get(SeckillService).releaseExpired();
    expect((await db.paymentRecord.findUniqueOrThrow({ where: { orderId: s.id } })).status).toBe(
      'CLOSED',
    );
    expect(
      (await db.seckillActivity.findUniqueOrThrow({ where: { id: s.activityId } })).remainingStock,
    ).toBe(1);
  });

  it('并发取消和付款只能一个成功，不出现取消单已记账', async () => {
    const o = await create();
    await pay(o.id).expect(201);
    const results = await Promise.all([post('/orders/' + o.id + '/cancel'), notify(o.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const order = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(await db.memberBenefitLedger.count({ where: { orderId: o.id } })).toBe(
      order.status === 'PAID' ? 1 : 0,
    );
  });

  it('秒杀支付后确认名额，到期扫描不释放，退款也保留名额与限购', async () => {
    const o = await create('SECKILL');
    await pay(o.id).expect(201);
    await notify(o.id).expect(201);
    await db.order.update({
      where: { id: o.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await app.get(SeckillService).releaseExpired();
    await refund(o.id).expect(201);
    await notify(o.id, 'SUCCESS', 1, 'refund').expect(201);
    expect(
      (await db.seckillReservation.findUniqueOrThrow({ where: { orderId: o.id } })).status,
    ).toBe('CONFIRMED');
    expect(
      (await db.seckillActivity.findUniqueOrThrow({ where: { id: o.activityId } })).remainingStock,
    ).toBe(0);
    await post('/orders/quote', {
      storeId: p,
      memberId: o.memberId,
      activityId: o.activityId,
      benefitMode: 'SECKILL',
      items: [{ productId: p, quantity: 1 }],
    }).expect(409);
  });

  it('鉴权、门店范围、金额注入、无效结果与未支付退款均被拒绝', async () => {
    const o = await create();
    await request(app.getHttpServer()).post(`/api/v1/orders/${o.id}/payment`).send({}).expect(401);
    await post(`/orders/${o.id}/refund`, { reason: '退款申请' }, clerk).expect(403);
    await refund(o.id).expect(409);
    await post(`/orders/${o.id}/payment/mock-result`, {
      outcome: 'SUCCESS',
      attempt: 1,
      amount: 1,
    }).expect(400);
    await post(`/orders/${o.id}/payment/mock-result`, { outcome: 'YES', attempt: 0 }).expect(400);
    await db.order.update({ where: { id: o.id }, data: { storeId: p + 'foreign' } });
    await post(`/orders/${o.id}/payment`, {}, clerk).expect(404);
    await get(`/orders/${o.id}/payment`, clerk).expect(404);
    await db.order.update({ where: { id: o.id }, data: { source: 'CSV_IMPORT' } });
    await pay(o.id).expect(400);
  });

  it('伪造签名和已签名但金额不符的事件不会写入业务', async () => {
    const o = await create();
    const record = data<RecordRow>(await pay(o.id).expect(201));
    const service = app.get(PaymentsService),
      gateway = app.get(MockPaymentGateway);
    const event: ChannelEvent = {
      id: randomUUID(),
      orderId: o.id,
      recordId: record.id,
      kind: 'PAYMENT',
      amount: '0.01',
      attempt: 1,
      outcome: 'SUCCESS',
    };
    const user = {
      id: p + 'admin',
      roles: [{ dataScope: 'ALL' }],
      permissions: [],
    } as unknown as AuthUser;
    await expect(service.acceptEvent(user, event, 'bad')).rejects.toThrow('签名无效');
    await expect(service.acceptEvent(user, event, gateway.sign(event))).rejects.toThrow('不匹配');
    expect(await db.paymentEvent.count({ where: { orderId: o.id } })).toBe(0);
  });

  it('权益异常则回滚退款状态、返券和成功事件，修复后同通知可重试', async () => {
    const o = await create('COUPON');
    await pay(o.id).expect(201);
    await notify(o.id).expect(201);
    await refund(o.id).expect(201);
    await db.member.update({ where: { id: o.memberId }, data: { points: 0 } });
    await notify(o.id, 'SUCCESS', 1, 'refund').expect(409);
    expect((await db.refundRecord.findUniqueOrThrow({ where: { orderId: o.id } })).status).toBe(
      'PENDING',
    );
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('PAID');
    expect((await db.memberCoupon.findUniqueOrThrow({ where: { id: o.couponId } })).status).toBe(
      'USED',
    );
    await db.member.update({ where: { id: o.memberId }, data: { points: 15 } });
    await notify(o.id, 'SUCCESS', 1, 'refund').expect(201);
  });

  it('同一会员多笔订单并发付款，累计消费和积分不丢失', async () => {
    const a = await create();
    const b = await create('NONE', a.memberId);
    await pay(a.id).expect(201);
    await pay(b.id).expect(201);
    const replies = await Promise.all([notify(a.id), notify(b.id)]);
    expect(replies.every((r) => r.status === 201)).toBe(true);
    const member = await db.member.findUniqueOrThrow({ where: { id: a.memberId } });
    expect(member.totalSpent.toFixed(2)).toBe('40.00');
    expect(member.points).toBe(40);
  });

  it('返还的券被新订单占用后，旧退款通知不会释放新占用', async () => {
    const o = await create('COUPON');
    await pay(o.id).expect(201);
    await notify(o.id).expect(201);
    await refund(o.id).expect(201);
    await notify(o.id, 'SUCCESS', 1, 'refund').expect(201);
    const input = {
      storeId: p,
      memberId: o.memberId,
      benefitMode: 'COUPON',
      couponId: o.couponId,
      items: [{ productId: p, quantity: 1 }],
    };
    const q = data<{ quoteHash: string }>(await post('/orders/quote', input).expect(201));
    const next = data<{ id: string }>(
      await post('/orders', { ...input, quoteHash: q.quoteHash, requestId: randomUUID() }).expect(
        201,
      ),
    );
    await notify(o.id, 'SUCCESS', 1, 'refund').expect(201);
    const coupon = await db.memberCoupon.findUniqueOrThrow({ where: { id: o.couponId } });
    expect(coupon.status).toBe('RESERVED');
    expect(coupon.orderId).toBe(next.id);
  });

  it('支付券占用异常则所有支付入账回滚', async () => {
    const o = await create('COUPON');
    await pay(o.id).expect(201);
    await db.memberCoupon.update({
      where: { id: o.couponId },
      data: { status: 'VOID', orderId: null, reservedAt: null },
    });
    await notify(o.id).expect(409);
    expect((await db.paymentRecord.findUniqueOrThrow({ where: { orderId: o.id } })).status).toBe(
      'PENDING',
    );
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe(
      'PENDING_PAYMENT',
    );
    expect(await db.memberBenefitLedger.count({ where: { orderId: o.id } })).toBe(0);
  });

  it('新会员690元分段报价686.20，支付成长升级、退款按实付回冲', async () => {
    await db.product.update({ where: { id: p }, data: { price: 690 } });
    try {
      const o = await create('MEMBER');
      const before = await db.order.findUniqueOrThrow({ where: { id: o.id } });
      expect(before.payableAmount.toFixed(2)).toBe('686.20');
      expect(before.discountAmount.toFixed(2)).toBe('3.80');
      expect(
        (await db.member.findUniqueOrThrow({ where: { id: o.memberId } })).totalSpent.toFixed(2),
      ).toBe('0.00');
      await pay(o.id).expect(201);
      await notify(o.id).expect(201);
      const member = await db.member.findUniqueOrThrow({ where: { id: o.memberId } });
      expect(member.totalSpent.toFixed(2)).toBe('686.20');
      expect(member.points).toBe(686);
      const nextInput = {
        storeId: p,
        memberId: o.memberId,
        benefitMode: 'MEMBER',
        items: [{ productId: p, quantity: 1 }],
      };
      const next = data<{ benefitSnapshot: { tier: string } }>(
        await post('/orders/quote', nextInput).expect(201),
      );
      expect(next.benefitSnapshot.tier).toBe('SPROUT');
      await refund(o.id).expect(201);
      await notify(o.id, 'SUCCESS', 1, 'refund').expect(201);
      expect(
        (await db.member.findUniqueOrThrow({ where: { id: o.memberId } })).totalSpent.toFixed(2),
      ).toBe('0.00');
    } finally {
      await db.product.update({ where: { id: p }, data: { price: 20 } });
    }
  });

  it('同一等级内成长基数变化也使跨档旧报价失效，创建后的快照不重算', async () => {
    await db.product.update({ where: { id: p }, data: { price: 690 } });
    try {
      const member = await db.member.create({
        data: { name: '报价变化会员', phone: p + ++n, totalSpent: 490 },
      });
      const input = {
        storeId: p,
        memberId: member.id,
        benefitMode: 'MEMBER',
        items: [{ productId: p, quantity: 1 }],
      };
      const q = data<{ quoteHash: string; payableAmount: string }>(
        await post('/orders/quote', input).expect(201),
      );
      expect(q.payableAmount).toBe('671.31');
      await db.member.update({ where: { id: member.id }, data: { totalSpent: 495 } });
      await post('/orders', { ...input, quoteHash: q.quoteHash, requestId: randomUUID() }).expect(
        409,
      );
      const fresh = data<{ quoteHash: string; payableAmount: string }>(
        await post('/orders/quote', input).expect(201),
      );
      expect(fresh.payableAmount).toBe('671.06');
      const order = data<{ id: string }>(
        await post('/orders', {
          ...input,
          quoteHash: fresh.quoteHash,
          requestId: randomUUID(),
        }).expect(201),
      );
      await db.member.update({ where: { id: member.id }, data: { totalSpent: 500 } });
      await pay(order.id).expect(201);
      await notify(order.id).expect(201);
      expect(
        (await db.order.findUniqueOrThrow({ where: { id: order.id } })).paidAmount.toFixed(2),
      ).toBe('671.06');
    } finally {
      await db.product.update({ where: { id: p }, data: { price: 20 } });
    }
  });
});
