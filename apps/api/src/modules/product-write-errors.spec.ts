import type { Server } from 'node:http';
import { INestApplication, Type, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { ApiExceptionFilter } from '../common/api';
import { ProductsService, ResourcesModule } from './resources';

// 使用真实控制器、Service及错误过滤器，只替换数据库写入，避免操作经营数据。
describe('商品与分类保存失败的 HTTP 反馈', () => {
  let app: INestApplication;
  const db = {
    product: { create: jest.fn(), update: jest.fn() },
    productCategory: { create: jest.fn(), update: jest.fn() },
  };
  const product = { code: 'P', name: '商品', categoryId: 'c', price: 10, costPrice: 1 };
  const category = { code: 'C', name: '分类' };
  const routes = [
    { method: 'post' as const, path: '/products', body: product, write: db.product.create },
    {
      method: 'patch' as const,
      path: '/products/p',
      body: { name: '商品' },
      write: db.product.update,
    },
    {
      method: 'post' as const,
      path: '/product-categories',
      body: category,
      write: db.productCategory.create,
    },
    {
      method: 'patch' as const,
      path: '/product-categories/c',
      body: { name: '分类' },
      write: db.productCategory.update,
    },
  ];
  beforeAll(async () => {
    const controller = (Reflect.getMetadata('controllers', ResourcesModule) as Type[]).find(
      (c) => c.name === 'ProductsController',
    )!;
    const module = await Test.createTestingModule({
      controllers: [controller],
      providers: [
        {
          provide: ProductsService,
          useValue: new ProductsService(
            db as unknown as ConstructorParameters<typeof ProductsService>[0],
            {} as ConstructorParameters<typeof ProductsService>[1],
          ),
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });
  beforeEach(() => jest.resetAllMocks());
  afterAll(async () => {
    await app?.close();
  });

  it.each([
    {
      route: 0,
      dbCode: 'P2002',
      status: 409,
      code: 'PRODUCT_CODE_EXISTS',
      text: '编号',
      action: 'CHANGE_CODE',
    },
    {
      route: 1,
      dbCode: 'P2002',
      status: 409,
      code: 'PRODUCT_CODE_EXISTS',
      text: '编号',
      action: 'CHANGE_CODE',
    },
    {
      route: 2,
      dbCode: 'P2002',
      status: 409,
      code: 'PRODUCT_CATEGORY_CODE_EXISTS',
      text: '编码',
      action: 'CHANGE_CODE',
    },
    {
      route: 3,
      dbCode: 'P2002',
      status: 409,
      code: 'PRODUCT_CATEGORY_CODE_EXISTS',
      text: '编码',
      action: 'CHANGE_CODE',
    },
    {
      route: 0,
      dbCode: 'P2003',
      status: 400,
      code: 'PRODUCT_CATEGORY_INVALID',
      text: '分类',
      action: 'RESELECT_CATEGORY',
    },
    {
      route: 1,
      dbCode: 'P2003',
      status: 400,
      code: 'PRODUCT_CATEGORY_INVALID',
      text: '分类',
      action: 'RESELECT_CATEGORY',
    },
    {
      route: 1,
      dbCode: 'P2025',
      status: 404,
      code: 'PRODUCT_NOT_EDITABLE',
      text: '回收',
      action: 'RELOAD_PRODUCT',
    },
    {
      route: 3,
      dbCode: 'P2025',
      status: 404,
      code: 'PRODUCT_CATEGORY_NOT_FOUND',
      text: '不存在',
      action: 'RELOAD_CATEGORY',
    },
  ])('$route $dbCode 对应 $code', async ({ route, dbCode, status, code, text, action }) => {
    const target = routes[route];
    target.write.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('SQL secret connection', {
        code: dbCode,
        clientVersion: 'test',
      }),
    );
    const response = await request(app.getHttpServer() as Server)
      [target.method](target.path)
      .send(target.body)
      .expect(status);
    expect(response.body).toMatchObject({
      code,
      message: expect.stringContaining(text) as unknown,
      details: [expect.objectContaining({ nextAction: action })],
    });
    expect(JSON.stringify(response.body)).not.toMatch(/SQL|secret|connection/);
    expect(target.write).toHaveBeenCalledTimes(1);
  });

  it('数据库连接、未知错误及非业务约束错误不会冒充编号重复', async () => {
    for (const [index, target] of routes.entries()) {
      target.write.mockRejectedValue(
        index === 0
          ? new Prisma.PrismaClientInitializationError(
              'password=hidden connection',
              'test',
              'P1001',
            )
          : index % 2
            ? Error('password=hidden SQL')
            : new Prisma.PrismaClientKnownRequestError('private SQL', {
                code: 'P2034',
                clientVersion: 'test',
              }),
      );
      const response = await request(app.getHttpServer() as Server)
        [target.method](target.path)
        .send(target.body)
        .expect(500);
      expect(response.body).toMatchObject({
        code: 'HTTP_500',
        message: '服务器内部错误',
        details: [],
      });
      expect(JSON.stringify(response.body)).not.toMatch(/hidden|private|SQL|编号|编码/);
    }
  });

  it('正常更新保持原数据和回收站过滤条件', async () => {
    db.product.update.mockResolvedValue({ id: 'p', ...product });
    const response = await request(app.getHttpServer() as Server)
      .patch('/products/p')
      .send({ price: 10 })
      .expect(200);
    expect(response.body).toEqual({ id: 'p', ...product });
    expect(db.product.update).toHaveBeenCalledWith({
      where: { id: 'p', deletedAt: null },
      data: expect.objectContaining({ price: 10 }) as unknown,
    });
  });
});
