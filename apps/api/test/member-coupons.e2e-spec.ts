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

type Quote = {
  quoteHash: string;
  payableAmount: string;
  discountAmount: string;
  couponSnapshot: { name: string };
};
type Coupon = { id: string; status: string; displayStatus: string };
const data = <T>(r: request.Response) => (r.body as { data: T }).data;

describe('会员满减券（HTTP + 隔离PostgreSQL）', () => {
  let app: INestApplication<App>, db: PrismaClient;
  let admin: string, reader: string, clerk: string;
  const p = 'coupon-test-' + randomUUID();
  const id = {
    member: p + '-m',
    other: p + '-other',
    disabled: p + '-disabled',
    store: p + '-s',
    foreign: p + '-s2',
    product: p + '-product',
    user: p + '-admin',
  };
  const post = (path: string, body: object, token = admin) =>
    request(app.getHttpServer())
      .post('/api/v1' + path)
      .auth(token, { type: 'bearer' })
      .send(body);
  const get = (path: string, token = admin) =>
    request(app.getHttpServer())
      .get('/api/v1' + path)
      .auth(token, { type: 'bearer' });
  const templateBody = () => ({
    name: '满30减5',
    minimumSpend: '30',
    discountAmount: '5',
    startsAt: new Date(Date.now() - 60000).toISOString(),
    endsAt: new Date(Date.now() + 86400000).toISOString(),
  });
  const template = async (overrides: object = {}) =>
    data<{ id: string }>(
      await post('/coupons/templates', { ...templateBody(), ...overrides }).expect(201),
    ).id;
  const issue = async (templateId?: string, memberId = id.member) =>
    data<Coupon>(
      await post('/coupons/members/' + memberId, {
        templateId: templateId ?? (await template()),
        requestId: randomUUID(),
      }).expect(201),
    );
  const input = (couponId: string) => ({
    storeId: id.store,
    memberId: id.member,
    benefitMode: 'COUPON',
    couponId,
    items: [{ productId: id.product, quantity: 2 }],
  });
  const quote = async (couponId: string) =>
    data<Quote>(await post('/orders/quote', input(couponId)).expect(201));
  const create = async (couponId: string) => {
    const q = await quote(couponId);
    return post('/orders', {
      ...input(couponId),
      quoteHash: q.quoteHash,
      requestId: randomUUID(),
    }).expect(201);
  };

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
    await db.region.create({ data: { id: p, code: p, name: '券测试区域' } });
    await db.store.createMany({
      data: [id.store, id.foreign].map((s) => ({
        id: s,
        code: s,
        name: '券测试门店',
        regionId: p,
        address: '测试',
        openedAt: new Date(),
      })),
    });
    await db.productCategory.create({ data: { id: p, code: p, name: '券测试分类' } });
    await db.product.create({
      data: {
        id: id.product,
        code: id.product,
        name: '测试咖啡',
        categoryId: p,
        price: 20,
        costPrice: 0,
        stockOnHand: 10000,
      },
    });
    await db.member.createMany({
      data: [
        { id: id.member, name: '典藏会员', phone: p, tierOverride: 'PLATINUM' },
        { id: id.other, name: '其他会员', phone: p + '2' },
        { id: id.disabled, name: '停用会员', phone: p + '3', enabled: false },
      ],
    });
    const permissions = await db.permission.findMany({
      where: {
        code: {
          in: ['member:view', 'member:coupon-issue', 'order:view', 'order:create', 'order:cancel'],
        },
      },
    });
    expect(permissions).toHaveLength(5);
    for (const kind of ['admin', 'reader', 'clerk']) {
      await db.role.create({
        data: {
          id: p + kind,
          code: p + kind,
          name: kind,
          dataScope: kind === 'clerk' ? 'STORE' : 'ALL',
          permissions: {
            create: permissions
              .filter(
                (permission) =>
                  kind === 'admin' ||
                  (kind === 'reader'
                    ? permission.code.endsWith(':view')
                    : permission.code !== 'member:coupon-issue'),
              )
              .map((permission) => ({ permissionId: permission.id })),
          },
        },
      });
      await db.user.create({
        data: {
          id: p + '-' + kind,
          username: p + kind,
          name: kind,
          passwordHash: 'test-only',
          storeId: kind === 'clerk' ? id.store : null,
          roles: { create: { roleId: p + kind } },
        },
      });
    }
    const jwt = app.get(JwtService);
    admin = jwt.sign({ sub: id.user });
    reader = jwt.sign({ sub: p + '-reader' });
    clerk = jwt.sign({ sub: p + '-clerk' });
  }, 30000);
  afterAll(async () => {
    await app?.close();
  });

  it('必须登录且有发券权限，普通查看者不能发券/创建模板', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/coupons/templates')
      .send(templateBody())
      .expect(401);
    await post('/coupons/templates', templateBody(), reader).expect(403);
    await request(app.getHttpServer())
      .patch('/api/v1/coupons/templates/missing')
      .auth(reader, { type: 'bearer' })
      .send({ ...templateBody(), version: 1 })
      .expect(403);
    await request(app.getHttpServer())
      .delete('/api/v1/coupons/templates/missing')
      .auth(reader, { type: 'bearer' })
      .expect(403);
    await post(
      '/coupons/members/' + id.member,
      { templateId: 'x', requestId: randomUUID() },
      clerk,
    ).expect(403);
  });

  it('拒绝非法金额、空名称和无效日期范围', async () => {
    for (const patch of [
      { minimumSpend: '0' },
      { discountAmount: '31' },
      { discountAmount: '-1' },
      { discountAmount: '0.001' },
      { name: '  ' },
      { endsAt: new Date(Date.now() - 120000).toISOString() },
    ]) {
      await post('/coupons/templates', { ...templateBody(), ...patch }).expect(400);
    }
  });

  it('并发重复发券只生成一张，标识不能改用于其他会员', async () => {
    const templateId = await template(),
      requestId = randomUUID();
    const body = { templateId, requestId };
    const responses = await Promise.all([
      post('/coupons/members/' + id.member, body),
      post('/coupons/members/' + id.member, body),
    ]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(new Set(responses.map((r) => data<Coupon>(r).id)).size).toBe(1);
    await post('/coupons/members/' + id.other, body).expect(409);
    await post('/coupons/members/' + id.disabled, { ...body, requestId: randomUUID() }).expect(400);
  });

  it('报价为券后35元，不叠加典藏折扣，不绑定订单或修改余额', async () => {
    const coupon = await issue();
    const before = await db.order.count({ where: { memberId: id.member } });
    const q = await quote(coupon.id);
    expect(q.payableAmount).toBe('35.00');
    expect(q.discountAmount).toBe('5.00');
    expect(q.couponSnapshot.name).toBe('满30减5');
    expect(await db.order.count({ where: { memberId: id.member } })).toBe(before);
    const stored = await db.memberCoupon.findUniqueOrThrow({ where: { id: coupon.id } });
    expect(stored.status).toBe('AVAILABLE');
    expect(stored.orderId).toBeNull();
    const member = await db.member.findUniqueOrThrow({ where: { id: id.member } });
    expect(member.points).toBe(0);
    expect(member.totalSpent.toFixed(2)).toBe('0.00');
  });

  it('拒绝他人券、未生效券、未达门槛、用券参数缺失和混用会员折扣', async () => {
    const coupon = await issue();
    await post('/orders/quote', { ...input(coupon.id), memberId: id.other }).expect(409);
    await post('/orders/quote', {
      ...input(coupon.id),
      items: [{ productId: id.product, quantity: 1 }],
    }).expect(400);
    await post('/orders/quote', { ...input(coupon.id), benefitMode: 'MEMBER' }).expect(400);
    await post('/orders/quote', { ...input(coupon.id), couponId: undefined }).expect(400);
    const future = await issue(
      await template({ startsAt: new Date(Date.now() + 60000).toISOString() }),
    );
    await post('/orders/quote', input(future.id)).expect(409);
    const list = data<Coupon[]>(await get('/coupons/members/' + id.member).expect(200));
    expect(list.find((c) => c.id === future.id)?.displayStatus).toBe('NOT_STARTED');
  });

  it('创建才绑定订单，保持RESERVED而非USED，重复创建返回原单', async () => {
    const coupon = await issue(),
      q = await quote(coupon.id);
    const body = { ...input(coupon.id), quoteHash: q.quoteHash, requestId: randomUUID() };
    const first = data<{ id: string; status: string; payableAmount: string }>(
      await post('/orders', body).expect(201),
    );
    expect(first.status).toBe('PENDING_PAYMENT');
    expect(Number(first.payableAmount)).toBe(35);
    expect(data<{ id: string }>(await post('/orders', body).expect(201)).id).toBe(first.id);
    const stored = await db.memberCoupon.findUniqueOrThrow({ where: { id: coupon.id } });
    expect(stored.orderId).toBe(first.id);
    expect(stored.status).toBe('RESERVED');
    expect(stored.usedAt).toBeNull();
    const list = data<Coupon[]>(await get('/coupons/members/' + id.member).expect(200));
    expect(list.find((c) => c.id === coupon.id)?.displayStatus).toBe('RESERVED');
    expect(list.find((c) => c.id === coupon.id)).not.toHaveProperty('orderId');
  });

  it('不同订单并发抢同一券，只创建一单', async () => {
    const coupon = await issue(),
      q = await quote(coupon.id);
    const before = await db.order.count({ where: { memberId: id.member } });
    const responses = await Promise.all(
      Array.from({ length: 3 }, () =>
        post('/orders', { ...input(coupon.id), quoteHash: q.quoteHash, requestId: randomUUID() }),
      ),
    );
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(2);
    expect(await db.order.count({ where: { memberId: id.member } })).toBe(before + 1);
  });

  it('取消和释放原子完成，重复取消不释放后来另一单占用的券', async () => {
    const coupon = await issue();
    const first = data<{ id: string }>(await create(coupon.id));
    await post('/orders/' + first.id + '/cancel', {}).expect(201);
    expect(
      (await db.memberCoupon.findUniqueOrThrow({ where: { id: coupon.id } })).orderId,
    ).toBeNull();
    const second = data<{ id: string }>(await create(coupon.id));
    await post('/orders/' + first.id + '/cancel', {}).expect(201);
    expect((await db.memberCoupon.findUniqueOrThrow({ where: { id: coupon.id } })).orderId).toBe(
      second.id,
    );
    const old = data<{ couponSnapshot: { name: string } }>(
      await get('/orders/' + first.id).expect(200),
    );
    expect(old.couponSnapshot.name).toBe('满30减5');
  });

  it('报价后过期不能创建；取消时已过期的券仍不能再次使用', async () => {
    const tid = await template(),
      coupon = await issue(tid),
      q = await quote(coupon.id);
    await db.couponTemplate.update({
      where: { id: tid },
      data: { startsAt: new Date(Date.now() - 120000), endsAt: new Date(Date.now() - 60000) },
    });
    await post('/orders', {
      ...input(coupon.id),
      quoteHash: q.quoteHash,
      requestId: randomUUID(),
    }).expect(409);
    const tid2 = await template(),
      coupon2 = await issue(tid2);
    const order = data<{ id: string }>(await create(coupon2.id));
    await db.couponTemplate.update({
      where: { id: tid2 },
      data: { startsAt: new Date(Date.now() - 120000), endsAt: new Date(Date.now() - 60000) },
    });
    await post('/orders/' + order.id + '/cancel', {}).expect(201);
    const list = data<Coupon[]>(await get('/coupons/members/' + id.member).expect(200));
    expect(list.find((c) => c.id === coupon2.id)?.displayStatus).toBe('EXPIRED');
    await post('/orders/quote', input(coupon2.id)).expect(409);
  });

  it('报价后价格变化不留订单或占券；篡改券后金额不能下单', async () => {
    const coupon = await issue(),
      q = await quote(coupon.id);
    await db.product.update({ where: { id: id.product }, data: { price: 21 } });
    try {
      await post('/orders', {
        ...input(coupon.id),
        quoteHash: q.quoteHash,
        requestId: randomUUID(),
      }).expect(409);
      expect((await db.memberCoupon.findUniqueOrThrow({ where: { id: coupon.id } })).status).toBe(
        'AVAILABLE',
      );
    } finally {
      await db.product.update({ where: { id: id.product }, data: { price: 20 } });
    }
    await post('/orders/quote', { ...input(coupon.id), payableAmount: '0.01' }).expect(400);
  });

  it('越权取消不能释放其他门店的券', async () => {
    const coupon = await issue();
    const body = { ...input(coupon.id), storeId: id.foreign };
    const q = data<Quote>(await post('/orders/quote', body).expect(201));
    const order = data<{ id: string }>(
      await post('/orders', { ...body, quoteHash: q.quoteHash, requestId: randomUUID() }).expect(
        201,
      ),
    );
    await post('/orders/' + order.id + '/cancel', {}, clerk).expect(404);
    expect((await db.memberCoupon.findUniqueOrThrow({ where: { id: coupon.id } })).status).toBe(
      'RESERVED',
    );
  });

  it('批量勾选发券去重，重复批次不再发券且拒绝更换目标', async () => {
    const templateId = await template();
    const body = {
      templateId,
      requestId: randomUUID(),
      mode: 'SELECTED',
      memberIds: [id.member, id.other, id.member],
    };
    const responses = await Promise.all([
      post('/coupons/batches', body),
      post('/coupons/batches', body),
    ]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    const result = data<{ batchId: string; count: number }>(responses[0]);
    expect(result.count).toBe(2);
    expect(data<{ batchId: string }>(responses[1]).batchId).toBe(result.batchId);
    expect(await db.memberCoupon.count({ where: { batchId: result.batchId } })).toBe(2);
    await post('/coupons/batches', { ...body, memberIds: [id.member] }).expect(409);
    await post('/coupons/batches', { ...body, requestId: randomUUID() }, reader).expect(403);
  });

  it('跨页全选按后端条件发给全部启用会员，重试不包含后加入的会员', async () => {
    const keyword = p + '-bulk';
    await db.member.createMany({
      data: Array.from({ length: 26 }, (_, index) => ({
        id: keyword + index,
        name: keyword,
        phone: keyword + index,
        enabled: index < 25,
      })),
    });
    const body = { templateId: await template(), requestId: randomUUID(), mode: 'ALL', keyword };
    const result = data<{ batchId: string; count: number }>(
      await post('/coupons/batches', body).expect(201),
    );
    expect(result.count).toBe(25);
    expect(await db.memberCoupon.count({ where: { batchId: result.batchId } })).toBe(25);
    expect(
      await db.memberCoupon.count({ where: { batchId: result.batchId, memberId: keyword + '25' } }),
    ).toBe(0);
    await db.member.create({
      data: { id: keyword + 'new', name: keyword, phone: keyword + 'new' },
    });
    expect(data<{ count: number }>(await post('/coupons/batches', body).expect(201)).count).toBe(
      25,
    );
    expect(await db.memberCoupon.count({ where: { batchId: result.batchId } })).toBe(25);
  });

  it('空选择、停用会员、未找到目标或全选混传ID不产生批次', async () => {
    const body = { templateId: await template(), requestId: randomUUID(), mode: 'SELECTED' };
    for (const patch of [
      { memberIds: [] },
      { memberIds: [id.member, id.disabled] },
      { memberIds: ['missing'] },
      { mode: 'ALL', keyword: 'none-' + p },
      { mode: 'ALL', memberIds: [id.member] },
    ]) {
      await post('/coupons/batches', { ...body, ...patch }).expect(400);
    }
    expect(await db.couponIssueBatch.count({ where: { requestId: body.requestId } })).toBe(0);
  });

  it('编辑发布新版本，已发券保持原规则，旧版本不能再修改或发放', async () => {
    const tid = await template(),
      oldCoupon = await issue(tid);
    const changed = await request(app.getHttpServer())
      .patch('/api/v1/coupons/templates/' + tid)
      .auth(admin, { type: 'bearer' })
      .send({ ...templateBody(), name: '满30减8', discountAmount: '8', version: 1 })
      .expect(200);
    const next = data<{ id: string; version: number }>(changed);
    expect(next.id).not.toBe(tid);
    expect(next.version).toBe(2);
    expect((await quote(oldCoupon.id)).payableAmount).toBe('35.00');
    const newCoupon = await issue(next.id);
    expect((await quote(newCoupon.id)).payableAmount).toBe('32.00');
    await post('/coupons/members/' + id.member, {
      templateId: tid,
      requestId: randomUUID(),
    }).expect(400);
    await request(app.getHttpServer())
      .patch('/api/v1/coupons/templates/' + tid)
      .auth(admin, { type: 'bearer' })
      .send({ ...templateBody(), version: 1 })
      .expect(409);
    expect(
      data<{ id: string }[]>(await get('/coupons/templates').expect(200)).some((t) => t.id === tid),
    ).toBe(false);
    const oldList = data<{ id: string; template: { name: string } }[]>(
      await get('/coupons/members/' + id.member).expect(200),
    );
    expect(oldList.find((c) => c.id === oldCoupon.id)?.template.name).toBe('满30减5');
  });

  it('删除模板停止后续发券，已发券仍然可用；删除操作幂等', async () => {
    const tid = await template(),
      coupon = await issue(tid);
    const remove = () =>
      request(app.getHttpServer())
        .delete('/api/v1/coupons/templates/' + tid)
        .auth(admin, { type: 'bearer' });
    await remove().expect(200);
    await remove().expect(200);
    expect((await quote(coupon.id)).payableAmount).toBe('35.00');
    await post('/coupons/members/' + id.member, {
      templateId: tid,
      requestId: randomUUID(),
    }).expect(400);
    await post('/coupons/batches', {
      templateId: tid,
      requestId: randomUUID(),
      mode: 'SELECTED',
      memberIds: [id.member],
    }).expect(400);
  });

  it('允许作废未占用券，拒绝作废他人券或订单占用券', async () => {
    const coupon = await issue();
    const remove = (memberId: string, couponId: string, token = admin) =>
      request(app.getHttpServer())
        .delete('/api/v1/coupons/members/' + memberId + '/coupons/' + couponId)
        .auth(token, { type: 'bearer' });
    await remove(id.member, coupon.id, reader).expect(403);
    await remove(id.other, coupon.id).expect(404);
    await remove(id.member, coupon.id).expect(200);
    await remove(id.member, coupon.id).expect(200);
    await post('/orders/quote', input(coupon.id)).expect(409);
    const reserved = await issue();
    await create(reserved.id);
    await remove(id.member, reserved.id).expect(409);
    expect((await db.memberCoupon.findUniqueOrThrow({ where: { id: reserved.id } })).status).toBe(
      'RESERVED',
    );
  });
});
