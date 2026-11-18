import type { Server } from 'node:http';
import { INestApplication, Type, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MembersController } from '../members/members.controller';
import { MembersService } from '../members/members.service';
import { OrdersService } from '../orders/orders.service';
import { ResourcesModule } from './resources';

describe('基础资料维护的 HTTP 输入边界', () => {
  let app: INestApplication;
  const service = {
    update: jest.fn((_id: string, dto: unknown) => Promise.resolve(dto)),
    updateUser: jest.fn((_id: string, dto: unknown) => Promise.resolve(dto)),
    updateRole: jest.fn((_id: string, dto: unknown) => Promise.resolve(dto)),
  };
  beforeAll(async () => {
    const controllers = (Reflect.getMetadata('controllers', ResourcesModule) as Type[]).filter(
      (c) => ['RegionsController', 'StoresController', 'SystemController'].includes(c.name),
    );
    const providers = controllers.map((c) => ({
      provide: (Reflect.getMetadata('design:paramtypes', c) as Type[])[0],
      useValue: service,
    }));
    const module = await Test.createTestingModule({
      controllers: [...controllers, MembersController],
      providers: [
        ...providers,
        { provide: MembersService, useValue: service },
        { provide: OrdersService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => {
    await app?.close();
  });

  it.each<[string, Record<string, unknown>]>([
    ['/regions/r', { stores: { create: [] } }],
    ['/regions/r', { enabled: null }],
    ['/stores/s', { id: 'replacement' }],
    ['/stores/s', { openedAt: 'invalid-date' }],
    ['/stores/s/status', {}],
    ['/regions/r/status', { enabled: 'false' }],
    ['/system/users/u', { passwordHash: 'injected' }],
    ['/system/users/u', { password: 'short' }],
    ['/system/roles/r', { permissionIds: 'all' }],
    ['/system/roles/r', { permissionIds: ['x', 'x'] }],
    ['/system/roles/r', { dataScope: 'UNKNOWN' }],
    ['/members/m', { enabled: null }],
    ['/members/m', { phone: null }],
    ['/members/m', { name: '  ' }],
  ])('拒绝%s中的无效数据', async (path, body) => {
    await request(app.getHttpServer() as Server)
      .patch(path)
      .send(body)
      .expect(400);
    expect(service.update).not.toHaveBeenCalled();
    expect(service.updateUser).not.toHaveBeenCalled();
    expect(service.updateRole).not.toHaveBeenCalled();
  });
  it('正常局部编辑允许false、清空可空关联、空密码不修改和清空权限列表', async () => {
    await request(app.getHttpServer() as Server)
      .patch('/stores/s')
      .send({ managerId: null, enabled: false })
      .expect(200);
    await request(app.getHttpServer() as Server)
      .patch('/system/users/u')
      .send({ regionId: null, storeId: '', password: '', enabled: false })
      .expect(200);
    await request(app.getHttpServer() as Server)
      .patch('/system/roles/r')
      .send({ permissionIds: [] })
      .expect(200);
    await request(app.getHttpServer() as Server)
      .patch('/members/m')
      .send({ birthday: null })
      .expect(200);
    expect(service.updateRole).toHaveBeenCalledWith(
      'r',
      expect.objectContaining({ permissionIds: [] }),
    );
  });
});
