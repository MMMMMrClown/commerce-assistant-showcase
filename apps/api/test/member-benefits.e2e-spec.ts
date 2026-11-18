import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { MemberTier, Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { ApiExceptionFilter } from '../src/common/api';
import { PrismaService } from '../src/prisma/prisma.service';
import { DEFAULT_MEMBER_TIERS, type MemberTierRule } from '../src/member-benefits/benefit-rules';
import { MemberBenefitsService } from '../src/member-benefits/member-benefits.service';

type Quote = {
  quoteHash: string;
  discountAmount: string;
  payableAmount: string;
  benefitSnapshot: { source: string; discountBps: number; tier: MemberTier };
};
type Summary = {
  member: { tier: MemberTier; totalSpent: string; points: number; tierOverride: MemberTier | null };
};
type Policy = {
  version: number;
  enabled: boolean;
  tiers: MemberTierRule[];
};
function data<T>(response: request.Response) {
  return (response.body as { data: T }).data;
}

describe('会员权益（隔离数据库）', () => {
  let app: INestApplication<App>, db: PrismaClient, benefits: MemberBenefitsService;
  const p = 'benefit-test-' + randomUUID();
  const id = {
    region: p + '-r',
    store: p + '-s',
    foreign: p + '-s2',
    category: p + '-c',
    product: p + '-product',
    member: p + '-m',
    admin: p + '-admin',
    clerk: p + '-clerk',
    adminRole: p + '-all',
    clerkRole: p + '-store',
  };
  let adminToken: string, clerkToken: string;
  const post = (path: string, body: object, token = adminToken) =>
    request(app.getHttpServer())
      .post('/api/v1' + path)
      .auth(token, { type: 'bearer' })
      .send(body);
  const patch = (path: string, body: object, token = adminToken) =>
    request(app.getHttpServer())
      .patch('/api/v1' + path)
      .auth(token, { type: 'bearer' })
      .send(body);
  const get = (path: string, token = adminToken) =>
    request(app.getHttpServer())
      .get('/api/v1' + path)
      .auth(token, { type: 'bearer' });
  const input = () => ({
    storeId: id.store,
    memberId: id.member,
    items: [{ productId: id.product, quantity: 1 }],
  });
  const tier = (tierOverride: MemberTier | null) =>
    patch('/member-benefits/members/' + id.member + '/tier', {
      tierOverride,
      reason: '独立测试等级规则',
    });
  async function policy() {
    const raw = data<Policy>(await get('/member-benefits/policy').expect(200));
    return {
      enabled: raw.enabled,
      tiers: raw.tiers,
      version: raw.version,
    };
  }
  async function updatePolicy(
    extra: Partial<Policy> & {
      vipThreshold?: string;
      vipDiscountBps?: number;
      pointsPerYuan?: number;
    },
    expectedStatus = 200,
  ) {
    const current = await policy();
    return await patch('/member-benefits/policy', {
      ...current,
      tiers:
        extra.tiers ??
        current.tiers.map((rule, index) => ({
          ...rule,
          minimumSpend:
            rule.code === 'VIP' && extra.vipThreshold !== undefined
              ? extra.vipThreshold
              : rule.minimumSpend,
          discountBps:
            index >= 2 && extra.vipDiscountBps !== undefined
              ? Math.min(rule.discountBps, extra.vipDiscountBps)
              : rule.discountBps,
          pointsPerYuan:
            extra.pointsPerYuan !== undefined
              ? Math.max(rule.pointsPerYuan, extra.pointsPerYuan)
              : rule.pointsPerYuan,
        })),
      enabled: extra.enabled ?? current.enabled,
      reason: '独立测试权益规则',
    }).expect(expectedStatus);
  }
  async function resetPolicy() {
    await db.memberBenefitPolicy.update({
      where: { id: 'default' },
      data: {
        enabled: true,
        tiers: DEFAULT_MEMBER_TIERS,
        version: { increment: 1 },
      },
    });
  }
  async function newMember() {
    const memberId = p + '-' + randomUUID();
    return db.member.create({ data: { id: memberId, name: '权益测试会员', phone: memberId } });
  }
  async function paidOrder(memberId: string, amount = '1000.99', storeId = id.store) {
    return db.order.create({
      data: {
        orderNo: p + '-' + randomUUID(),
        memberId,
        storeId,
        source: 'BACKOFFICE',
        status: 'PAID',
        orderedAt: new Date(),
        originalAmount: amount,
        payableAmount: amount,
        paidAmount: amount,
      },
    });
  }
  async function payment(orderId: string) {
    for (let i = 0; i < 4; i++) {
      try {
        return await db.$transaction((tx) => benefits.recordPayment(tx, orderId), {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          !['P2034', 'P2002'].includes(error.code) ||
          i === 3
        )
          throw error;
      }
    }
    throw new Error('Retry exhausted');
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
    db = app.get(PrismaService);
    benefits = app.get(MemberBenefitsService);
    await resetPolicy();
    await db.region.create({ data: { id: id.region, code: id.region, name: '权益测试区域' } });
    await db.store.createMany({
      data: [id.store, id.foreign].map((value) => ({
        id: value,
        code: value,
        name: '权益测试门店',
        regionId: id.region,
        address: '测试',
        openedAt: new Date(),
      })),
    });
    await db.productCategory.create({
      data: { id: id.category, code: id.category, name: '测试分类' },
    });
    await db.product.create({
      data: {
        id: id.product,
        code: id.product,
        categoryId: id.category,
        name: '测试商品',
        price: '20.10',
        costPrice: 0,
        stockOnHand: 10000,
      },
    });
    await db.member.create({ data: { id: id.member, name: '会员报价测试', phone: p + '-phone' } });
    const permissions = await db.permission.findMany();
    for (const [roleId, scope, canManage] of [
      [id.adminRole, 'ALL', true],
      [id.clerkRole, 'STORE', false],
    ] as const) {
      await db.role.create({
        data: {
          id: roleId,
          code: roleId,
          name: '权益测试角色',
          dataScope: scope,
          permissions: {
            create: permissions
              .filter((permission) => canManage || permission.code !== 'member:benefits-manage')
              .map((permission) => ({ permissionId: permission.id })),
          },
        },
      });
    }
    for (const [userId, roleId, storeId] of [
      [id.admin, id.adminRole, null],
      [id.clerk, id.clerkRole, id.store],
    ]) {
      await db.user.create({
        data: {
          id: userId!,
          username: userId!,
          name: '权益测试员工',
          passwordHash: 'not-a-login',
          storeId,
          roles: { create: { roleId: roleId! } },
        },
      });
    }
    const jwt = app.get(JwtService);
    adminToken = jwt.sign({ sub: id.admin });
    clerkToken = jwt.sign({ sub: id.clerk });
  }, 30000);
  afterAll(async () => {
    if (db) {
      await db.memberBenefitLedger.deleteMany({ where: { memberId: { startsWith: p } } });
      await db.memberBenefitAudit.deleteMany({ where: { actorId: { in: [id.admin, id.clerk] } } });
      await db.orderItem.deleteMany({
        where: { order: { storeId: { in: [id.store, id.foreign] } } },
      });
      await db.order.deleteMany({ where: { storeId: { in: [id.store, id.foreign] } } });
      await db.member.deleteMany({ where: { id: { startsWith: p } } });
      await db.operationLog.deleteMany({ where: { userId: { in: [id.admin, id.clerk] } } });
      await db.user.deleteMany({ where: { id: { in: [id.admin, id.clerk] } } });
      await db.role.deleteMany({ where: { id: { in: [id.adminRole, id.clerkRole] } } });
      await db.productStockHold.deleteMany({ where: { productId: id.product } });
      await db.productStockMovement.deleteMany({ where: { productId: id.product } });
      await db.product.deleteMany({ where: { id: id.product } });
      await db.productCategory.deleteMany({ where: { id: id.category } });
      await db.store.deleteMany({ where: { id: { in: [id.store, id.foreign] } } });
      await db.region.deleteMany({ where: { id: id.region } });
      await resetPolicy();
    }
    await app?.close();
  }, 30000);

  it('默认规则可读取，未登录和店长无权改权益', async () => {
    await request(app.getHttpServer()).get('/api/v1/member-benefits/policy').expect(401);
    const current = await policy();
    expect(current.tiers.find((rule) => rule.code === 'VIP')?.discountBps).toBe(9500);
    await patch('/member-benefits/policy', {}, clerkToken).expect(403);
    await patch(
      '/member-benefits/members/' + id.member + '/tier',
      { tierOverride: 'VIP', reason: '越权测试' },
      clerkToken,
    ).expect(403);
    await get('/member-benefits/members/' + id.member + '/audits', clerkToken).expect(403);
  });

  it('普通会员原价，人工VIP95折，金额四舍五入到分', async () => {
    await tier(null).expect(200);
    expect(data<Quote>(await post('/orders/quote', input()).expect(201)).payableAmount).toBe(
      '20.10',
    );
    await tier(MemberTier.VIP).expect(200);
    const quoted = data<Quote>(await post('/orders/quote', input()).expect(201));
    expect(quoted.payableAmount).toBe('19.10');
    expect(quoted.discountAmount).toBe('1.00');
    expect(quoted.benefitSnapshot.source).toBe('MEMBER');
    const regular = data<Quote>(
      await post('/orders/quote', { ...input(), benefitMode: 'NONE' }).expect(201),
    );
    expect(regular.payableAmount).toBe('20.10');
  });

  it('等级修改留痕，恢复自动等级不改变消费和积分', async () => {
    await tier(null).expect(200);
    const summary = data<Summary>(await get('/member-benefits/members/' + id.member).expect(200));
    expect(summary.member.tier).toBe('STANDARD');
    expect(summary.member.points).toBe(0);
    const records = data<{ reason: string }[]>(
      await get('/member-benefits/members/' + id.member + '/audits').expect(200),
    );
    expect(records.length).toBeGreaterThanOrEqual(3);
    expect(records[0].reason).toBe('独立测试等级规则');
  });

  it('拒绝伪造积分/消费/等级字段、缺失等级和空白调整原因', async () => {
    await patch('/members/' + id.member, {
      points: 9999,
      totalSpent: '9999.00',
      tierOverride: 'VIP',
    }).expect(400);
    await patch('/member-benefits/members/' + id.member + '/tier', {
      tierOverride: 'VIP',
      reason: '  ',
    }).expect(400);
    await patch('/member-benefits/members/' + id.member + '/tier', { reason: '缺少等级' }).expect(
      400,
    );
    await post('/orders/quote', { ...input(), benefitMode: 'FAKE' }).expect(400);
  });

  it('报价之后等级变化，创建要求重新确认', async () => {
    await tier(null).expect(200);
    const quote = data<Quote>(await post('/orders/quote', input()).expect(201));
    await tier(MemberTier.VIP).expect(200);
    await post('/orders', {
      ...input(),
      quoteHash: quote.quoteHash,
      requestId: randomUUID(),
    }).expect(409);
  });

  it('下单保存等级和折扣快照；改规则不修改旧订单', async () => {
    await tier(MemberTier.VIP).expect(200);
    const quote = data<Quote>(await post('/orders/quote', input()).expect(201));
    const created = data<{ id: string }>(
      await post('/orders', {
        ...input(),
        quoteHash: quote.quoteHash,
        requestId: randomUUID(),
      }).expect(201),
    );
    try {
      await updatePolicy({ vipDiscountBps: 9000 }, 200);
      const existing = data<Quote>(await get('/orders/' + created.id).expect(200));
      expect(Number(existing.payableAmount)).toBe(19.1);
      expect(existing.benefitSnapshot.discountBps).toBe(9500);
      const current = data<Quote>(await post('/orders/quote', input()).expect(201));
      expect(current.payableAmount).toBe('18.09');
      const member = await db.member.findUniqueOrThrow({ where: { id: id.member } });
      expect(member.points).toBe(0);
      expect(member.totalSpent.isZero()).toBe(true);
      await post('/orders/' + created.id + '/cancel', {}).expect(201);
      expect(await db.memberBenefitLedger.count({ where: { orderId: created.id } })).toBe(0);
    } finally {
      await resetPolicy();
      await tier(null);
    }
  });

  it('策略版本防覆盖，拒绝非法比例、门槛和积分倍率', async () => {
    const current = await policy();
    await updatePolicy({ vipDiscountBps: 9000 }, 200);
    await patch('/member-benefits/policy', { ...current, reason: '过期表单' }).expect(409);
    await updatePolicy({ vipThreshold: '0' }, 400);
    await updatePolicy({ vipDiscountBps: 4999 }, 400);
    await updatePolicy({ pointsPerYuan: 11 }, 400);
    await resetPolicy();
  });

  it('权益变更后旧报价失效，普通订单20件上限仍有效', async () => {
    const quote = data<Quote>(await post('/orders/quote', input()).expect(201));
    await updatePolicy({ pointsPerYuan: 2 }, 200);
    await post('/orders', {
      ...input(),
      requestId: randomUUID(),
      quoteHash: quote.quoteHash,
    }).expect(409);
    await post('/orders/quote', {
      ...input(),
      items: [{ productId: id.product, quantity: 20 }],
    }).expect(201);
    await post('/orders/quote', {
      ...input(),
      items: [{ productId: id.product, quantity: 21 }],
    }).expect(400);
    await resetPolicy();
  });

  it('待支付订单不能通过内部接口发积分；无公开加积分入口', async () => {
    const member = await newMember();
    const order = await paidOrder(member.id);
    await db.order.update({
      where: { id: order.id },
      data: { status: 'PENDING_PAYMENT', paidAmount: 0 },
    });
    await expect(payment(order.id)).rejects.toThrow('仅已确认全额付款');
    expect(await db.memberBenefitLedger.count({ where: { orderId: order.id } })).toBe(0);
    await post('/member-benefits/members/' + member.id + '/points', { points: 999 }).expect(404);
  });

  it('已付款内部处理幂等，达到门槛自动VIP', async () => {
    const member = await newMember();
    const order = await paidOrder(member.id);
    await payment(order.id);
    await payment(order.id);
    const summary = data<Summary>(await get('/member-benefits/members/' + member.id).expect(200));
    expect(Number(summary.member.totalSpent)).toBe(1000.99);
    expect(summary.member.points).toBe(1000);
    expect(summary.member.tier).toBe('VIP');
    expect(await db.memberBenefitLedger.count({ where: { orderId: order.id } })).toBe(1);
  });

  it('并发处理同一支付只入账一次', async () => {
    const member = await newMember();
    const order = await paidOrder(member.id, '50.10');
    await Promise.all([payment(order.id), payment(order.id), payment(order.id)]);
    const updated = await db.member.findUniqueOrThrow({ where: { id: member.id } });
    expect(updated.points).toBe(50);
    expect(updated.totalSpent.toFixed(2)).toBe('50.10');
  });

  it('事务中途失败，付款状态与权益一起回滚', async () => {
    const member = await newMember();
    const order = await paidOrder(member.id, '99.99');
    await db.order.update({
      where: { id: order.id },
      data: { status: 'PENDING_PAYMENT', paidAmount: 0 },
    });
    await expect(
      db.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'PAID', paidAmount: '99.99' },
        });
        await benefits.recordPayment(tx, order.id);
        throw new Error('模拟后续操作失败');
      }),
    ).rejects.toThrow('模拟后续操作失败');
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'PENDING_PAYMENT',
    );
    expect((await db.member.findUniqueOrThrow({ where: { id: member.id } })).points).toBe(0);
    expect(await db.memberBenefitLedger.count({ where: { orderId: order.id } })).toBe(0);
  });

  it('退款按原积分冲回，重复退款不重复扣减，自动等级重算', async () => {
    const member = await newMember();
    const order = await paidOrder(member.id);
    await payment(order.id);
    await updatePolicy({ pointsPerYuan: 2 }, 200);
    await db.order.update({ where: { id: order.id }, data: { status: 'REFUNDED' } });
    await db.$transaction((tx) => benefits.recordRefund(tx, order.id));
    await db.$transaction((tx) => benefits.recordRefund(tx, order.id));
    const summary = data<Summary>(await get('/member-benefits/members/' + member.id).expect(200));
    expect(summary.member.points).toBe(0);
    expect(Number(summary.member.totalSpent)).toBe(0);
    expect(summary.member.tier).toBe('STANDARD');
    await resetPolicy();
  });

  it('会员余额共享，积分流水仍受员工门店范围限制', async () => {
    const member = await newMember();
    await payment((await paidOrder(member.id, '10.00', id.store)).id);
    await payment((await paidOrder(member.id, '20.00', id.foreign)).id);
    const summary = data<Summary>(
      await get('/member-benefits/members/' + member.id, clerkToken).expect(200),
    );
    expect(summary.member.points).toBe(30);
    const result = data<{ total: number }>(
      await get('/member-benefits/members/' + member.id + '/ledger', clerkToken).expect(200),
    );
    expect(result.total).toBe(1);
  });

  it('消费入账沿用下单积分规则快照，不受之后规则调整影响', async () => {
    const member = await newMember();
    const order = await paidOrder(member.id, '100.50');
    const current = await policy();
    await db.order.update({
      where: { id: order.id },
      data: {
        benefitSnapshot: { pointsPerYuan: 1, policyVersion: current.version },
      },
    });
    try {
      await updatePolicy({ pointsPerYuan: 2 }, 200);
      const entry = await payment(order.id);
      expect(entry.pointsDelta).toBe(100);
      expect(entry.ruleVersion).toBe(current.version);
    } finally {
      await resetPolicy();
    }
  });

  it('人工等级覆盖自动等级，恢复自动后按有效消费计算', async () => {
    const member = await newMember();
    const order = await paidOrder(member.id);
    await payment(order.id);
    const path = '/member-benefits/members/' + member.id + '/tier';
    await patch(path, { tierOverride: 'STANDARD', reason: '测试人工等级优先' }).expect(200);
    let summary = data<Summary>(await get('/member-benefits/members/' + member.id).expect(200));
    expect(summary.member.tier).toBe('STANDARD');
    await patch(path, { tierOverride: null, reason: '测试恢复自动等级' }).expect(200);
    summary = data<Summary>(await get('/member-benefits/members/' + member.id).expect(200));
    expect(summary.member.tier).toBe('VIP');
    await patch(path, { tierOverride: 'VIP', reason: '测试人工授予VIP' }).expect(200);
    await db.order.update({ where: { id: order.id }, data: { status: 'REFUNDED' } });
    await db.$transaction((tx) => benefits.recordRefund(tx, order.id));
    summary = data<Summary>(await get('/member-benefits/members/' + member.id).expect(200));
    expect(summary.member.tier).toBe('VIP');
    expect(Number(summary.member.totalSpent)).toBe(0);
  });

  it('单笔跨级至最高等级，下一单使用最高档折扣与积分，退款重算', async () => {
    const member = await newMember();
    const order = await paidOrder(member.id, '5000.00');
    await payment(order.id);
    let summary = data<Summary>(await get('/member-benefits/members/' + member.id).expect(200));
    expect(summary.member.tier).toBe('DIAMOND');
    const quoted = data<Quote & { benefitSnapshot: { pointsPerYuan: number } }>(
      await post('/orders/quote', { ...input(), memberId: member.id }).expect(201),
    );
    expect(quoted.payableAmount).toBe('17.69');
    expect(quoted.benefitSnapshot.pointsPerYuan).toBe(3);
    const nextOrder = await paidOrder(member.id, '10.90');
    await db.order.update({
      where: { id: nextOrder.id },
      data: { benefitSnapshot: quoted.benefitSnapshot },
    });
    await payment(nextOrder.id);
    summary = data<Summary>(await get('/member-benefits/members/' + member.id).expect(200));
    expect(summary.member.points).toBe(5030);
    await db.order.update({ where: { id: order.id }, data: { status: 'REFUNDED' } });
    await db.$transaction((tx) => benefits.recordRefund(tx, order.id));
    summary = data<Summary>(await get('/member-benefits/members/' + member.id).expect(200));
    expect(summary.member.tier).toBe('STANDARD');
    expect(summary.member.points).toBe(30);
    expect(Number(summary.member.totalSpent)).toBe(10.9);
  });

  it('配置必须完整且门槛与权益有序，非法规则不产生新版本', async () => {
    const current = await policy();
    const invalid = [
      current.tiers.slice(1),
      current.tiers.map((rule, i) => ({
        ...rule,
        minimumSpend: i === 2 ? '100' : rule.minimumSpend,
      })),
      current.tiers.map((rule, i) => ({
        ...rule,
        discountBps: i === 5 ? 10000 : rule.discountBps,
      })),
    ];
    for (const tiers of invalid) await updatePolicy({ tiers }, 400);
    expect((await policy()).version).toBe(current.version);
  });
});
