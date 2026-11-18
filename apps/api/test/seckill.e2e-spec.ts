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

type Quote = {
  quoteHash: string;
  payableAmount: string;
  discountAmount: string;
  seckillSnapshot: { price: string };
};
type Order = { id: string; status: string; expiresAt: string; seckillSnapshot: { price: string } };
const data = <T>(response: request.Response) => (response.body as { data: T }).data;

describe('秒杀：库存、限购、幂等与超时（隔离PostgreSQL）', () => {
  let app: INestApplication<App>, db: PrismaClient, service: SeckillService;
  const p = 'seckill-' + randomUUID();
  const id = { product: p + '-p', other: p + '-p2', store: p + '-s', foreign: p + '-s2' };
  const member = (n = 0) => p + '-m' + n;
  let admin: string, clerk: string;
  const post = (path: string, body: object, token = admin) =>
    request(app.getHttpServer())
      .post('/api/v1' + path)
      .auth(token, { type: 'bearer' })
      .send(body);
  const activityBody = () => ({
    name: '限量咖啡',
    productId: id.product,
    price: '9.90',
    stock: 3,
    holdMinutes: 1,
    startsAt: new Date(Date.now() - 60000).toISOString(),
    endsAt: new Date(Date.now() + 3600000).toISOString(),
  });
  const activity = async (patch: object = {}) =>
    data<{ id: string }>(
      await post('/seckill/activities', { ...activityBody(), ...patch }).expect(201),
    ).id;
  const input = (activityId: string, n = 0) => ({
    activityId,
    memberId: member(n),
    storeId: id.store,
    benefitMode: 'SECKILL',
    items: [{ productId: id.product, quantity: 1 }],
  });
  const quote = async (activityId: string, n = 0) =>
    data<Quote>(await post('/orders/quote', input(activityId, n)).expect(201));
  const create = async (activityId: string, n = 0) => {
    const q = await quote(activityId, n);
    return data<Order>(
      await post('/orders', {
        ...input(activityId, n),
        quoteHash: q.quoteHash,
        requestId: randomUUID(),
      }).expect(201),
    );
  };
  const stock = async (activityId: string) =>
    (await db.seckillActivity.findUniqueOrThrow({ where: { id: activityId } })).remainingStock;

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
    service = app.get(SeckillService);
    service.onModuleDestroy(); // 测试中主动扫描，避免定时器干扰到期断言。
    await db.region.create({ data: { id: p, code: p, name: '秒杀测试区域' } });
    await db.store.createMany({
      data: [id.store, id.foreign].map((s) => ({
        id: s,
        code: s,
        name: '测试门店',
        regionId: p,
        address: 'test',
        openedAt: new Date(),
      })),
    });
    await db.productCategory.create({ data: { id: p, code: p, name: '秒杀测试' } });
    await db.product.createMany({
      data: [id.product, id.other].map((productId) => ({
        id: productId,
        code: productId,
        name: '测试咖啡',
        categoryId: p,
        price: '20.00',
        costPrice: 0,
        stockOnHand: 10000,
      })),
    });
    await db.member.createMany({
      data: Array.from({ length: 15 }, (_, n) => ({
        id: member(n),
        name: '会员' + n,
        phone: member(n),
        tierOverride: 'DIAMOND' as const,
      })),
    });
    const permissions = await db.permission.findMany({
      where: {
        code: {
          in: ['seckill:view', 'seckill:manage', 'order:view', 'order:create', 'order:cancel'],
        },
      },
    });
    expect(permissions).toHaveLength(5);
    for (const kind of ['admin', 'clerk']) {
      await db.role.create({
        data: {
          id: p + kind,
          code: p + kind,
          name: kind,
          dataScope: kind === 'admin' ? 'ALL' : 'STORE',
          permissions: {
            create: permissions
              .filter((v) => kind === 'admin' || v.code !== 'seckill:manage')
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
          storeId: kind === 'clerk' ? id.store : null,
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

  it('创建活动鉴权、金额/时间/库存校验和有效商品检查', async () => {
    await request(app.getHttpServer()).get('/api/v1/seckill/activities').expect(401);
    await post('/seckill/activities', activityBody(), clerk).expect(403);
    for (const patch of [
      { price: '21' },
      { price: '0' },
      { stock: 0 },
      { stock: 1.5 },
      { holdMinutes: 0 },
      { endsAt: new Date(Date.now() - 120000).toISOString() },
      { productId: 'missing' },
    ])
      await post('/seckill/activities', { ...activityBody(), ...patch }).expect(400);
  });

  it('预览按活动价，不叠加会员折扣、不扣库存、不建订单', async () => {
    const aid = await activity();
    const before = await db.order.count({ where: { memberId: member() } });
    const q = await quote(aid);
    expect(q.payableAmount).toBe('9.90');
    expect(q.discountAmount).toBe('10.10');
    expect(q.seckillSnapshot.price).toBe('9.90');
    expect(await stock(aid)).toBe(3);
    expect(await db.order.count({ where: { memberId: member() } })).toBe(before);
  });

  it('拒绝未开始、已结束、停用活动及越权门店', async () => {
    const aid = await activity({ startsAt: new Date(Date.now() + 60000).toISOString() });
    await post('/orders/quote', input(aid)).expect(409);
    const ended = await activity();
    await db.seckillActivity.update({
      where: { id: ended },
      data: { startsAt: new Date(Date.now() - 120000), endsAt: new Date(Date.now() - 60000) },
    });
    await post('/orders/quote', input(ended)).expect(409);
    const active = await activity();
    await post('/orders/quote', { ...input(active), storeId: id.foreign }, clerk).expect(400);
    await db.seckillActivity.update({ where: { id: active }, data: { enabled: false } });
    await post('/orders/quote', input(active)).expect(409);
  });

  it('限制单商品一件、活动匹配、禁止券叠加或伪造价格', async () => {
    const aid = await activity();
    for (const patch of [
      { items: [{ productId: id.product, quantity: 2 }] },
      { items: [{ productId: id.other, quantity: 1 }] },
      { benefitMode: 'NONE' },
      { couponId: 'fake' },
      { payableAmount: '0.01' },
    ])
      await post('/orders/quote', { ...input(aid), ...patch }).expect(400);
  });

  it('同一提交并发重试只创建一单、只占一个名额', async () => {
    const aid = await activity(),
      q = await quote(aid);
    const body = { ...input(aid), requestId: randomUUID(), quoteHash: q.quoteHash };
    const responses = await Promise.all([
      post('/orders', body),
      post('/orders', body),
      post('/orders', body),
    ]);
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(new Set(responses.map((r) => data<Order>(r).id)).size).toBe(1);
    expect(await stock(aid)).toBe(2);
    const order = data<Order>(responses[0]);
    expect(order.status).toBe('PENDING_PAYMENT');
    expect(order.expiresAt).toBeTruthy();
    expect(await db.seckillReservation.count({ where: { activityId: aid } })).toBe(1);
  });

  it('同会员更换requestId和操作人，也不能重复抢购', async () => {
    const aid = await activity(),
      q = await quote(aid);
    const responses = await Promise.all([
      post('/orders', { ...input(aid), requestId: randomUUID(), quoteHash: q.quoteHash }),
      post('/orders', { ...input(aid), requestId: randomUUID(), quoteHash: q.quoteHash }, clerk),
    ]);
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(1);
    expect(await stock(aid)).toBe(2);
  });

  it('12名会员并发抢3个名额，不超卖且订单/占用/库存一致', async () => {
    const aid = await activity();
    const quotes = await Promise.all(Array.from({ length: 12 }, (_, n) => quote(aid, n)));
    const responses = await Promise.all(
      quotes.map((q, n) =>
        post('/orders', { ...input(aid, n), quoteHash: q.quoteHash, requestId: randomUUID() }),
      ),
    );
    expect(responses.filter((r) => r.status === 201)).toHaveLength(3);
    expect(responses.every((r) => [201, 409].includes(r.status))).toBe(true);
    expect(await stock(aid)).toBe(0);
    const reservations = await db.seckillReservation.findMany({
      where: { activityId: aid },
      include: { order: true },
    });
    expect(reservations).toHaveLength(3);
    expect(reservations.every((r) => r.order.status === 'PENDING_PAYMENT')).toBe(true);
  });

  it('取消原子释放，允许重新参与；重复取消旧单不多还名额', async () => {
    const aid = await activity({ stock: 1 }),
      order = await create(aid);
    expect(await stock(aid)).toBe(0);
    await post('/orders/' + order.id + '/cancel', {}).expect(201);
    expect(await stock(aid)).toBe(1);
    const next = await create(aid);
    await post('/orders/' + order.id + '/cancel', {}).expect(201);
    expect(await stock(aid)).toBe(0);
    expect(
      (await db.seckillReservation.findUniqueOrThrow({ where: { orderId: next.id } })).status,
    ).toBe('RESERVED');
  });

  it('到期扫描关闭订单并只释放一次，付过款的订单不会被超时关闭', async () => {
    const aid = await activity({ stock: 2 }),
      order = await create(aid);
    await db.order.update({
      where: { id: order.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await service.releaseExpired();
    await service.releaseExpired();
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CANCELED');
    expect(await stock(aid)).toBe(2);
    const paid = await create(aid);
    await db.order.update({
      where: { id: paid.id },
      data: { status: 'PAID', paidAmount: '9.90', expiresAt: new Date(Date.now() - 1000) },
    });
    await service.releaseExpired();
    expect(await stock(aid)).toBe(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: paid.id } })).status).toBe('PAID');
  });

  it('报价后停用活动不能创建，失败不占库存；取消不能越权', async () => {
    const aid = await activity(),
      q = await quote(aid);
    await db.seckillActivity.update({ where: { id: aid }, data: { enabled: false } });
    await post('/orders', {
      ...input(aid),
      quoteHash: q.quoteHash,
      requestId: randomUUID(),
    }).expect(409);
    expect(await stock(aid)).toBe(3);
    const other = await activity();
    const body = { ...input(other), storeId: id.foreign };
    const otherQ = data<Quote>(await post('/orders/quote', body).expect(201));
    const order = data<Order>(
      await post('/orders', {
        ...body,
        quoteHash: otherQ.quoteHash,
        requestId: randomUUID(),
      }).expect(201),
    );
    await post('/orders/' + order.id + '/cancel', {}, clerk).expect(404);
    expect(await stock(other)).toBe(2);
  });

  it('重新启动扫描器时，从数据库恢复处理停机期间到期的占用', async () => {
    const aid = await activity({ stock: 1 }),
      order = await create(aid);
    await db.order.update({
      where: { id: order.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    // 模拟生命周期重新初始化，验证启动即扫描，不依赖进程内到期队列。
    service.onModuleInit();
    try {
      for (let i = 0; i < 100; i++) {
        if ((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status === 'CANCELED')
          break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
        'CANCELED',
      );
      expect(await stock(aid)).toBe(1);
    } finally {
      service.onModuleDestroy();
    }
  });
});
