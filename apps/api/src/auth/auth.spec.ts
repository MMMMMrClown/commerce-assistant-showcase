import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthController, AuthService, DataScopeService, extractJwtToken } from './auth';
import type { AuthUser } from '../common/api';
import { DEFAULT_COOKIE_NAME, DEFAULT_SESSION_MAX_AGE_MS } from './auth.constants';

const user = (scope: 'ALL' | 'REGION' | 'STORE'): AuthUser => ({
  id: 'u1',
  username: 'tester',
  name: '测试用户',
  regionId: 'r1',
  storeId: scope === 'STORE' ? 's1' : null,
  permissions: [],
  roles: [{ code: 'TEST', name: '测试角色', dataScope: scope }],
});

describe('DataScopeService', () => {
  const service = new DataScopeService();
  it('超级管理员查询全部门店', () => expect(service.storeWhere(user('ALL'))).toEqual({}));
  it('区域经理只查询所属区域', () =>
    expect(service.storeWhere(user('REGION'))).toEqual({ regionId: 'r1' }));
  it('店长只查询所属门店', () => expect(service.storeWhere(user('STORE'))).toEqual({ id: 's1' }));
  it('门店角色缺少门店绑定时不会扩大到区域', () =>
    expect(service.storeWhere({ ...user('STORE'), storeId: null })).toEqual({ id: { in: [] } }));
  it('区域角色有门店资料时仍按角色查看区域', () =>
    expect(service.storeWhere({ ...user('REGION'), storeId: 's1' })).toEqual({ regionId: 'r1' }));
  it('区域角色缺少区域绑定时不以门店资料替代授权', () =>
    expect(service.storeWhere({ ...user('REGION'), regionId: null, storeId: 's1' })).toEqual({
      id: { in: [] },
    }));
  it('没有角色时绑定资料不赋予查询权限', () =>
    expect(service.storeWhere({ ...user('STORE'), roles: [] })).toEqual({ id: { in: [] } }));
  it('多个受限角色取各自有效范围的并集', () => {
    const actor = { ...user('STORE'), roles: [...user('STORE').roles, ...user('REGION').roles] };
    expect(service.storeWhere(actor)).toEqual({ OR: [{ regionId: 'r1' }, { id: 's1' }] });
    expect(service.orderWhere(actor)).toEqual({
      store: { OR: [{ regionId: 'r1' }, { id: 's1' }] },
    });
  });
});

describe('extractJwtToken', () => {
  it('优先读取 Bearer token，并兼容 Cookie', () => {
    const request = {
      headers: { authorization: 'Bearer bearer-token' },
      cookies: { [DEFAULT_COOKIE_NAME]: 'cookie-token' },
    } as Pick<Request, 'headers' | 'cookies'>;

    expect(extractJwtToken(request)).toBe('bearer-token');
    expect(extractJwtToken({ headers: {}, cookies: request.cookies })).toBe('cookie-token');
  });
});

describe('AuthController session cookie', () => {
  const accessToken = 'signed-jwt';
  const service = {
    login: jest.fn().mockResolvedValue({ accessToken }),
  } as unknown as AuthService;
  const config = new ConfigService({ NODE_ENV: 'test' });
  const controller = new AuthController(service, config);

  beforeEach(() => jest.clearAllMocks());

  it('登录成功后设置 HttpOnly Cookie 并保留 accessToken 响应', async () => {
    const cookie = jest.fn();
    const response = {
      cookie,
    } as unknown as Response;

    await expect(
      controller.login({ username: 'admin', password: 'password' }, response),
    ).resolves.toEqual({ accessToken });
    expect(cookie).toHaveBeenCalledWith(
      DEFAULT_COOKIE_NAME,
      accessToken,
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        path: '/',
        maxAge: DEFAULT_SESSION_MAX_AGE_MS,
      }),
    );
  });

  it('退出时清除会话 Cookie', () => {
    const clearCookie = jest.fn();
    const response = {
      clearCookie,
    } as unknown as Response;

    expect(controller.logout(response)).toEqual({ loggedOut: true });
    expect(clearCookie).toHaveBeenCalledWith(
      DEFAULT_COOKIE_NAME,
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        path: '/',
      }),
    );
  });
});
