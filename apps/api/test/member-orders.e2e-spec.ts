import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { ApiExceptionFilter } from '../src/common/api';
import { PrismaService } from '../src/prisma/prisma.service';

type JsonOrder = {
  id: string;
  member: unknown;
  payableAmount: string;
  store: { id: string };
  items: { productId: string; productName: string; unitPrice: string }[];
};
type JsonList = { items: JsonOrder[]; total: number };
function payload<T = JsonOrder>(response: request.Response) {
  return response.body as { data: T; code?: string };
}
// Uses dedicated fixtures in the configured local database. Never clears existing business data.
describe('会员关联订单（HTTP + PostgreSQL）', () => {
  let app: INestApplication<App>;
  let db: PrismaClient;
  const prefix = 'order-test-' + randomUUID();
  const ids = {
    region: prefix + '-region',
    store: prefix + '-store',
    otherStore: prefix + '-other',
    category: prefix + '-category',
    product: prefix + '-p1',
    second: prefix + '-p2',
    member: prefix + '-member',
    disabled: prefix + '-disabled',
    admin: prefix + '-admin',
    clerk: prefix + '-clerk',
    reader: prefix + '-reader',
    allRole: prefix + '-all',
    storeRole: prefix + '-scoped',
    readRole: prefix + '-read',
  };
  let admin: string, clerk: string, reader: string;
  let orderId: string;
  const input = () => ({
    storeId: ids.store,
    memberId: ids.member,
    items: [
      { productId: ids.product, quantity: 3 },
      { productId: ids.second, quantity: 2 },
    ],
  });
  const post = (path: string, body: object, token = admin) =>
    request(app.getHttpServer())
      .post('/api/v1' + path)
      .auth(token, { type: 'bearer' })
      .send(body);
  const get = (path: string, token = admin) =>
    request(app.getHttpServer())
      .get('/api/v1' + path)
      .auth(token, { type: 'bearer' });
  const quote = async (body = input()) => {
    const response = await post('/orders/quote', body).expect(201);
    return payload<{ quoteHash: string; payableAmount: string }>(response).data;
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
    await db.region.create({ data: { id: ids.region, code: ids.region, name: '测试区域' } });
    await db.store.createMany({
      data: [ids.store, ids.otherStore].map((id) => ({
        id,
        code: id,
        name: id === ids.store ? '测试门店' : '范围外门店',
        regionId: ids.region,
        address: '仅用于测试',
        openedAt: new Date(),
      })),
    });
    await db.productCategory.create({
      data: { id: ids.category, code: ids.category, name: '测试分类' },
    });
    await db.product.createMany({
      data: [
        {
          id: ids.product,
          code: ids.product,
          name: '测试咖啡',
          categoryId: ids.category,
          price: '0.10',
          costPrice: 0,
          stockOnHand: 10000,
        },
        {
          id: ids.second,
          code: ids.second,
          name: '测试面包',
          categoryId: ids.category,
          price: '0.20',
          costPrice: 0,
          stockOnHand: 10000,
        },
      ],
    });
    await db.member.createMany({
      data: [
        { id: ids.member, name: '测试会员', phone: prefix + '-phone', enabled: true },
        { id: ids.disabled, name: '停用会员', phone: prefix + '-disabled-phone', enabled: false },
      ],
    });
    const permissions = await db.permission.findMany({
      where: { code: { in: ['order:view', 'order:create', 'order:cancel', 'member:view'] } },
    });
    expect(permissions).toHaveLength(4);
    for (const [id, scope, readOnly] of [
      [ids.allRole, 'ALL', false],
      [ids.storeRole, 'STORE', false],
      [ids.readRole, 'ALL', true],
    ] as const) {
      await db.role.create({
        data: {
          id,
          code: id,
          name: '测试角色',
          dataScope: scope,
          permissions: {
            create: permissions
              .filter((p) => !readOnly || p.code.endsWith(':view'))
              .map((p) => ({ permissionId: p.id })),
          },
        },
      });
    }
    for (const [id, roleId, storeId] of [
      [ids.admin, ids.allRole, null],
      [ids.clerk, ids.storeRole, ids.store],
      [ids.reader, ids.readRole, null],
    ]) {
      await db.user.create({
        data: {
          id: id!,
          username: id!,
          name: '测试操作人',
          passwordHash: 'not-a-login-password',
          storeId,
          roles: { create: { roleId: roleId! } },
        },
      });
    }
    const jwt = app.get(JwtService);
    admin = jwt.sign({ sub: ids.admin });
    clerk = jwt.sign({ sub: ids.clerk });
    reader = jwt.sign({ sub: ids.reader });
  }, 30000);

  afterAll(async () => {
    if (db) {
      const orders = await db.order.findMany({
        where: { storeId: { in: [ids.store, ids.otherStore] } },
        select: { id: true },
      });
      await db.orderItem.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
      await db.order.deleteMany({ where: { id: { in: orders.map((o) => o.id) } } });
      await db.operationLog.deleteMany({
        where: { userId: { in: [ids.admin, ids.clerk, ids.reader] } },
      });
      await db.user.deleteMany({ where: { id: { in: [ids.admin, ids.clerk, ids.reader] } } });
      await db.role.deleteMany({
        where: { id: { in: [ids.allRole, ids.storeRole, ids.readRole] } },
      });
      await db.member.deleteMany({ where: { id: { in: [ids.member, ids.disabled] } } });
      await db.productStockHold.deleteMany({
        where: { productId: { in: [ids.product, ids.second] } },
      });
      await db.productStockMovement.deleteMany({
        where: { productId: { in: [ids.product, ids.second] } },
      });
      await db.product.deleteMany({ where: { id: { in: [ids.product, ids.second] } } });
      await db.productCategory.deleteMany({ where: { id: ids.category } });
      await db.store.deleteMany({ where: { id: { in: [ids.store, ids.otherStore] } } });
      await db.region.deleteMany({ where: { id: ids.region } });
    }
    await app?.close();
  }, 30000);

  it('无登录返回401，只有查看权限不能试算/创建', async () => {
    await request(app.getHttpServer()).get('/api/v1/orders').expect(401);
    await post('/orders/quote', input(), reader).expect(403);
    await post('/orders', {}, reader).expect(403);
  });

  it('多商品金额使用Decimal；试算不创建订单', async () => {
    const before = await db.order.count({ where: { memberId: ids.member } });
    const result = await quote();
    expect(result.payableAmount).toBe('0.70');
    expect(await db.order.count({ where: { memberId: ids.member } })).toBe(before);
  });

  it('拒绝篡改价格、伪造已完成状态、空明细和非法数量', async () => {
    await post('/orders/quote', { ...input(), paidAmount: 0.01 }).expect(400);
    await post('/orders/quote', { ...input(), status: 'COMPLETED' }).expect(400);
    for (const quantity of [0, -1, 1.5, 100]) {
      await post('/orders/quote', {
        ...input(),
        items: [{ productId: ids.product, quantity }],
      }).expect(400);
    }
    await post('/orders/quote', { ...input(), items: [] }).expect(400);
    await post('/orders/quote', {
      ...input(),
      items: [{ productId: ids.product, quantity: 1, unitPrice: 0 }],
    }).expect(400);
  });

  it('拒绝停用会员、无效商品和重复商品', async () => {
    await post('/orders/quote', { ...input(), memberId: ids.disabled }).expect(400);
    await post('/orders/quote', {
      ...input(),
      items: [{ productId: 'missing', quantity: 1 }],
    }).expect(400);
    await post('/orders/quote', { ...input(), items: [input().items[0], input().items[0]] }).expect(
      400,
    );
  });

  it('拒绝停用门店、下架商品与停用分类', async () => {
    await db.store.update({ where: { id: ids.store }, data: { enabled: false } });
    try {
      await post('/orders/quote', input()).expect(400);
    } finally {
      await db.store.update({ where: { id: ids.store }, data: { enabled: true } });
    }
    await db.product.update({ where: { id: ids.product }, data: { enabled: false } });
    try {
      await post('/orders/quote', input()).expect(400);
    } finally {
      await db.product.update({ where: { id: ids.product }, data: { enabled: true } });
    }
    await db.productCategory.update({ where: { id: ids.category }, data: { enabled: false } });
    try {
      await post('/orders/quote', input()).expect(400);
    } finally {
      await db.productCategory.update({ where: { id: ids.category }, data: { enabled: true } });
    }
  });

  it('试算后商品价格变化，创建返回409而不静默改价', async () => {
    const current = await quote();
    await db.product.update({ where: { id: ids.product }, data: { price: '1.00' } });
    try {
      const response = await post('/orders', {
        ...input(),
        requestId: randomUUID(),
        quoteHash: current.quoteHash,
      }).expect(409);
      expect(payload(response).code).toBe('ORDER_QUOTE_CHANGED');
    } finally {
      await db.product.update({ where: { id: ids.product }, data: { price: '0.10' } });
    }
  });

  it('并发重复提交只生成一单，关联会员且实付为0', async () => {
    const current = await quote();
    const body = { ...input(), requestId: randomUUID(), quoteHash: current.quoteHash };
    const responses = await Promise.all([
      post('/orders', body),
      post('/orders', body),
      post('/orders', body),
    ]);
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201]);
    orderId = payload(responses[0]).data.id;
    expect(new Set(responses.map((r) => payload(r).data.id)).size).toBe(1);
    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });
    expect(order.memberId).toBe(ids.member);
    expect(order.status).toBe('PENDING_PAYMENT');
    expect(order.paidAmount.toFixed(2)).toBe('0.00');
    expect(order.payableAmount.toFixed(2)).toBe('0.70');
    expect(order.items).toHaveLength(2);
    await post('/orders', { ...body, items: [{ productId: ids.product, quantity: 1 }] }).expect(
      409,
    );
  });

  it('历史商品改名改价，不影响订单商品快照和金额', async () => {
    await db.product.update({
      where: { id: ids.product },
      data: { name: '改名后的咖啡', price: '99.99' },
    });
    try {
      const response = await get('/orders/' + orderId).expect(200);
      const item = payload(response).data.items.find(
        (item: { productId: string }) => item.productId === ids.product,
      );
      expect(item?.productName).toBe('测试咖啡');
      expect(Number(item?.unitPrice)).toBe(0.1);
      expect(Number(payload(response).data.payableAmount)).toBe(0.7);
    } finally {
      await db.product.update({
        where: { id: ids.product },
        data: { name: '测试咖啡', price: '0.10' },
      });
    }
  });

  it('会员订单查询、列表过滤和分页参数校验', async () => {
    const response = await get('/members/' + ids.member + '/orders').expect(200);
    expect(
      payload<JsonList>(response).data.items.some((o: { id: string }) => o.id === orderId),
    ).toBe(true);
    await get('/orders?page=1.5').expect(400);
    await get('/orders?pageSize=101').expect(400);
    await get('/orders?status=FAKE').expect(400);
  });

  it('店长只能操作本店；篡改门店筛选与会员ID不能越权', async () => {
    const other = { ...input(), storeId: ids.otherStore };
    await post('/orders/quote', other, clerk).expect(400);
    const current = await quote(other);
    const foreign = await post('/orders', {
      ...other,
      quoteHash: current.quoteHash,
      requestId: randomUUID(),
    }).expect(201);
    const id = payload(foreign).data.id;
    await get('/orders/' + id, clerk).expect(404);
    await post('/orders/' + id + '/cancel', {}, clerk).expect(404);
    const response = await get(
      '/orders?memberId=' + ids.member + '&storeId=' + ids.otherStore,
      clerk,
    ).expect(200);
    expect(payload<JsonList>(response).data.total).toBe(0);
    const memberOrders = await get('/members/' + ids.member + '/orders', clerk).expect(200);
    expect(
      payload<JsonList>(memberOrders).data.items.every(
        (o: { store: { id: string } }) => o.store.id === ids.store,
      ),
    ).toBe(true);
  });

  it('无会员历史订单仍可查看，不能当待支付订单取消', async () => {
    const legacy = await db.order.create({
      data: {
        orderNo: prefix + '-legacy',
        storeId: ids.store,
        orderedAt: new Date(),
        status: 'COMPLETED',
        originalAmount: 10,
        payableAmount: 10,
        paidAmount: 10,
      },
    });
    const response = await get('/orders/' + legacy.id).expect(200);
    expect(payload(response).data.member).toBeNull();
    await post('/orders/' + legacy.id + '/cancel', {}).expect(409);
  });

  it('仅待支付可取消，重复取消幂等，读者不能取消', async () => {
    await post('/orders/' + orderId + '/cancel', {}, reader).expect(403);
    await post('/orders/' + orderId + '/cancel', {}, clerk).expect(201);
    await post('/orders/' + orderId + '/cancel', {}, clerk).expect(201);
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('CANCELED');
    expect(order.canceledAt).not.toBeNull();
    expect(order.paidAmount.toFixed(2)).toBe('0.00');
  });
});
