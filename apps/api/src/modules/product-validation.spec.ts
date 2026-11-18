import type { Server } from 'node:http';
import { INestApplication, Type, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ApiExceptionFilter } from '../common/api';
import { ProductsService, ResourcesModule } from './resources';

// 使用真实控制器和全局校验配置；隔离数据库及鉴权，只验证本批HTTP入参边界。
describe('商品与分类维护 HTTP 校验', () => {
  let app: INestApplication;
  const service = {
    update: jest.fn((_id: string, dto: unknown) => Promise.resolve(dto)),
    updateCategory: jest.fn((_id: string, dto: unknown) => Promise.resolve(dto)),
    create: jest.fn((dto: unknown) => Promise.resolve(dto)),
    createCategory: jest.fn((dto: unknown) => Promise.resolve(dto)),
  };
  beforeAll(async () => {
    const controller = (Reflect.getMetadata('controllers', ResourcesModule) as Type[]).find(
      (c) => c.name === 'ProductsController',
    )!;
    const module = await Test.createTestingModule({
      controllers: [controller],
      providers: [{ provide: ProductsService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => {
    await app?.close();
  });

  it('拒绝编辑负价格，且不调用写入服务', async () => {
    const response = await request(app.getHttpServer() as Server)
      .patch('/products/p')
      .send({ price: -1 })
      .expect(400);
    expect((response.body as { code: string }).code).toBe('HTTP_400');
    expect(service.update).not.toHaveBeenCalled();
  });

  it.each([
    { price: '12.50' },
    { price: 12.345 },
    { costPrice: 10000000000 },
    { costPrice: -1 },
    { name: '   ' },
    { price: null },
    { enabled: null },
    { enabled: 'false' },
    { stockReserved: 0 },
  ])('商品编辑拒绝非法值/库存直改 %j', async (body) => {
    await request(app.getHttpServer() as Server)
      .patch('/products/p')
      .send(body)
      .expect(400);
    expect(service.update).not.toHaveBeenCalled();
  });

  it.each([
    { products: { create: [{ code: 'bypass', name: 'bypass', stockOnHand: 100 }] } },
    { id: 'replacement' },
    { sort: 1.5 },
    { enabled: null },
    { code: '' },
  ])('分类编辑拒绝嵌套写入/主键篡改/非法值 %j', async (body) => {
    await request(app.getHttpServer() as Server)
      .patch('/product-categories/c')
      .send(body)
      .expect(400);
    expect(service.updateCategory).not.toHaveBeenCalled();
  });

  it.each([{}, { enabled: 'false' }, { enabled: null }, { enabled: true, price: 0 }])(
    '商品状态入口拒绝缺值、错误类型和额外字段 %j',
    async (body) => {
      await request(app.getHttpServer() as Server)
        .patch('/products/p/status')
        .send(body)
        .expect(400);
      expect(service.update).not.toHaveBeenCalled();
    },
  );

  it('允许正常局部编辑、零金额、清空图片和布尔停用', async () => {
    await request(app.getHttpServer() as Server)
      .patch('/products/p')
      .send({ price: 0, imageUrl: null })
      .expect(200);
    expect(service.update).toHaveBeenLastCalledWith(
      'p',
      expect.objectContaining({ price: 0, imageUrl: null }),
    );
    await request(app.getHttpServer() as Server)
      .patch('/products/p/status')
      .send({ enabled: false })
      .expect(200);
    expect(service.update).toHaveBeenLastCalledWith('p', { enabled: false });
    await request(app.getHttpServer() as Server)
      .patch('/product-categories/c')
      .send({ sort: 0 })
      .expect(200);
    expect(service.updateCategory).toHaveBeenCalledWith('c', expect.objectContaining({ sort: 0 }));
  });

  it('新增入口同样拒绝空白名称，正常商品提交保持兼容', async () => {
    await request(app.getHttpServer() as Server)
      .post('/product-categories')
      .send({ code: 'C', name: '  ' })
      .expect(400);
    expect(service.createCategory).not.toHaveBeenCalled();
    const body = {
      code: 'P',
      name: '商品',
      categoryId: 'c',
      price: 10.5,
      costPrice: 0,
      enabled: true,
    };
    await request(app.getHttpServer() as Server)
      .post('/products')
      .send(body)
      .expect(201);
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining(body));
  });
});
