import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { AuthUser } from '../common/api';
const text = z.string().trim().min(1).max(100);
const category = z
  .object({
    code: text,
    name: text,
    sort: z.number().int().min(0).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
const region = z.object({ code: text, name: text, enabled: z.boolean().optional() }).strict();
const store = z
  .object({
    code: text,
    name: text,
    regionId: text,
    address: z.string().trim().min(1).max(300),
    openedAt: z.union([z.iso.date(), z.iso.datetime({ offset: true })]),
    phone: z.string().max(30).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
const role = z
  .object({
    code: text,
    name: text,
    description: z.string().max(300).optional(),
    dataScope: z.enum(['ALL', 'REGION', 'STORE']),
    permissionIds: z.array(text).max(1000).optional(),
  })
  .strict();
const user = z
  .object({
    username: text,
    name: text,
    email: z.email().optional(),
    regionId: text.optional(),
    storeId: text.optional(),
    roleId: text.optional(),
  })
  .strict();
const userChanges = user.omit({ username: true }).extend({ enabled: z.boolean().optional() });
const edit = (schema: z.ZodObject) =>
  z
    .object({
      id: text,
      changes: schema.partial().refine((c) => Object.keys(c).length > 0, '至少修改一个字段'),
    })
    .strict();

// 【固定管理目录】每个入口独立schema与权限；模型不接触URL或HTTP方法。
export const CATALOG_OPERATIONS = [
  {
    key: 'prepare_role_create',
    kind: 'ROLE_CREATE',
    label: '新增角色',
    route: 'system/roles',
    permission: 'role:edit',
    readPermission: 'role:view',
    schema: role,
    create: true,
  },
  {
    key: 'prepare_role_edit',
    kind: 'ROLE_EDIT',
    label: '修改角色权限',
    route: 'system/roles',
    permission: 'role:edit',
    readPermission: 'role:view',
    schema: edit(role),
    create: false,
  },
  {
    key: 'prepare_user_create',
    kind: 'USER_CREATE',
    label: '新增后台用户',
    route: 'system/users',
    permission: 'user:edit',
    readPermission: 'user:view',
    schema: user,
    create: true,
  },
  {
    key: 'prepare_user_edit',
    kind: 'USER_EDIT',
    label: '修改后台用户',
    route: 'system/users',
    permission: 'user:edit',
    readPermission: 'user:view',
    schema: edit(userChanges),
    create: false,
  },
  {
    key: 'prepare_category_create',
    kind: 'CATEGORY_CREATE',
    label: '新增商品分类',
    route: 'product-categories',
    permission: 'product-category:edit',
    readPermission: 'product-category:view',
    schema: category,
    create: true,
  },
  {
    key: 'prepare_category_edit',
    kind: 'CATEGORY_EDIT',
    label: '修改商品分类',
    route: 'product-categories',
    permission: 'product-category:edit',
    readPermission: 'product-category:view',
    schema: edit(category),
    create: false,
  },
  {
    key: 'prepare_region_create',
    kind: 'REGION_CREATE',
    label: '新增区域',
    route: 'regions',
    permission: 'region:create',
    readPermission: 'region:view',
    schema: region,
    create: true,
  },
  {
    key: 'prepare_region_edit',
    kind: 'REGION_EDIT',
    label: '修改区域',
    route: 'regions',
    permission: 'region:edit',
    readPermission: 'region:view',
    schema: edit(region),
    create: false,
  },
  {
    key: 'prepare_store_create',
    kind: 'STORE_CREATE',
    label: '新增门店',
    route: 'stores',
    permission: 'store:create',
    readPermission: 'store:view',
    schema: store,
    create: true,
  },
  {
    key: 'prepare_store_edit',
    kind: 'STORE_EDIT',
    label: '修改门店',
    route: 'stores',
    permission: 'store:edit',
    readPermission: 'store:view',
    schema: edit(store),
    create: false,
  },
] as const;
export const CATALOG_LOOKUPS = [
  { key: 'list_system_roles', label: '角色查询', route: 'system/roles', permission: 'role:view' },
  {
    key: 'list_system_users',
    label: '后台用户查询',
    route: 'system/users',
    permission: 'user:view',
  },
  {
    key: 'list_permissions',
    label: '权限目录查询',
    route: 'system/permissions',
    permission: 'role:view',
  },
] as const;
const labels: Record<string, string> = {
  username: '用户名',
  email: '邮箱',
  roleId: '角色编号',
  dataScope: '数据范围',
  permissionIds: '权限编号集合',
  description: '说明',
  code: '业务编号',
  name: '名称',
  sort: '排序',
  enabled: '启用状态',
  regionId: '所属区域编号',
  address: '地址',
  openedAt: '开业日期',
  phone: '联系电话',
};
export class CatalogOperations {
  constructor(private readonly config: ConfigService) {}
  definition(kind: string) {
    return CATALOG_OPERATIONS.find((d) => d.kind === kind);
  }
  async lookup(user: AuthUser, credential: string, key: string, keyword: string, page: number) {
    const d = CATALOG_LOOKUPS.find((d) => d.key === key);
    if (
      !d ||
      !user.permissions.includes(d.permission) ||
      !user.roles.some((r) => r.dataScope === 'ALL')
    )
      throw new ForbiddenException('无全平台管理目录查看权限');
    const rows = (await this.request(credential, d.route)) as (Record<string, unknown> & {
      id?: string;
      name?: string;
      code?: string;
      username?: string;
    })[];
    const selected = rows.filter((r) =>
      [r.id, r.name, r.code, r.username].some((v) =>
        String(v || '')
          .toLowerCase()
          .includes(keyword.toLowerCase()),
      ),
    );
    return {
      ok: true,
      total: selected.length,
      page,
      items: selected.slice((page - 1) * 10, page * 10).map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        username: r.username,
        enabled: r.enabled,
        dataScope: r.dataScope,
        storeId: r.storeId,
        regionId: r.regionId,
        roles: Array.isArray(r.roles)
          ? (r.roles as { roleId: string }[]).map((x) => x.roleId)
          : undefined,
        permissions: Array.isArray(r.permissions)
          ? (
              r.permissions as {
                permissionId: string;
                permission?: { code: string; name: string };
              }[]
            ).map((x) => ({
              id: x.permissionId,
              code: x.permission?.code,
              name: x.permission?.name,
            }))
          : undefined,
      })),
      definition: '管理目录已裁剪，不含密码、密钥、完整手机号；权限调整仍需独立预览确认',
    };
  }
  async regions(user: AuthUser, credential: string) {
    if (!user.permissions.includes('region:view')) throw new ForbiddenException('没有区域查看权限');
    return {
      ok: true,
      items: ((await this.request(credential, 'regions')) as Record<string, unknown>[]).map(
        (r) => ({ id: r.id, name: r.name, code: r.code, enabled: r.enabled }),
      ),
    };
  }
  policy(user: AuthUser, kind: string) {
    const d = this.definition(kind);
    if (!d) throw new BadRequestException('未接入的管理操作');
    if (
      !user.roles.some((r) => r.dataScope === 'ALL') ||
      ![d.permission, d.readPermission].every((p) => user.permissions.includes(p))
    )
      throw new ForbiddenException('没有全平台资料管理权限');
    return d;
  }
  private async request(credential: string, path: string, method = 'GET', body?: unknown) {
    if (!credential) throw new ForbiddenException('需要当前登录凭据');
    const response = await fetch(
      `http://127.0.0.1:${this.config.get('PORT', 3200)}/api/v1/${path}`,
      {
        method,
        headers: { Authorization: 'Bearer ' + credential, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000),
      },
    );
    const result = (await response.json()) as {
      data: Record<string, unknown> | Record<string, unknown>[];
      message?: string;
    };
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        throw new ForbiddenException('当前账号无权执行该资料操作');
      if (response.status < 500) throw new BadRequestException(result.message || '业务条件不满足');
      throw new Error('管理服务暂不可用');
    }
    return result.data;
  }
  private async current(credential: string, route: string, id: string) {
    if (route === 'stores')
      return (await this.request(credential, route + '/' + encodeURIComponent(id))) as Record<
        string,
        unknown
      >;
    const row = ((await this.request(credential, route)) as Record<string, unknown>[]).find(
      (r) => r.id === id,
    );
    if (row && route === 'system/roles')
      row.permissionIds = (row.permissions as { permissionId: string }[])
        .map((p) => p.permissionId)
        .sort();
    if (row && route === 'system/users')
      row.roleId = (row.roles as { roleId: string }[] | undefined)?.[0]?.roleId;
    return row;
  }
  async preview(user: AuthUser, credential: string, kind: string, input: unknown) {
    const d = this.policy(user, kind);
    const args = d.schema.parse(input) as Record<string, unknown>;
    if (d.create && ['product-categories', 'regions', 'stores'].includes(d.route)) {
      args.enabled ??= true;
      if (d.route === 'product-categories') args.sort ??= 0;
    }
    const changes = (d.create ? args : args.changes) as Record<string, unknown>;
    const before = d.create ? undefined : await this.current(credential, d.route, String(args.id));
    if (!d.create && !before) throw new NotFoundException('目标资料不存在');
    const displayName = args.name || before?.name || d.label;
    const diff = Object.entries(changes).map(([key, value]) => ({
      label: labels[key] || key,
      before: before?.[key] ?? '—',
      after: value,
    }));
    return {
      input: args,
      before: before
        ? {
            updatedAt: before.updatedAt,
            values: Object.fromEntries(Object.keys(changes).map((k) => [k, before[k] ?? null])),
          }
        : undefined,
      summary: {
        name: typeof displayName === 'string' ? displayName : JSON.stringify(displayName),
      },
      fields: diff,
      definition:
        '仅预览，需确认；修改前复读，原接口没有强CAS保证。结果未知时人工核对，不自动重发。',
    };
  }
  async execute(
    user: AuthUser,
    credential: string,
    kind: string,
    payload: Record<string, unknown>,
  ) {
    const d = this.policy(user, kind);
    const args = d.schema.parse(payload.input) as Record<string, unknown>;
    if (!d.create) {
      const current = await this.current(credential, d.route, String(args.id));
      const before = payload.before as { updatedAt?: unknown; values: Record<string, unknown> };
      if (
        !current ||
        (before.updatedAt && current.updatedAt !== before.updatedAt) ||
        Object.entries(before.values).some(
          ([k, v]) => JSON.stringify(current[k] ?? null) !== JSON.stringify(v),
        )
      )
        throw new ConflictException('资料已变化，请重新预览');
    }
    const written = (await this.request(
      credential,
      d.route + (d.create ? '' : '/' + encodeURIComponent(String(args.id))),
      d.create ? 'POST' : 'PATCH',
      d.create
        ? d.route === 'system/users'
          ? { ...args, password: randomBytes(24).toString('base64url') }
          : args
        : args.changes,
    )) as Record<string, unknown>;
    try {
      const actual = await this.current(credential, d.route, String(written.id));
      if (!actual) throw new Error('提交后暂无法核对结果');
      return {
        id: actual.id,
        name: actual.name,
        code: actual.code,
        status: 'enabled' in actual ? (actual.enabled ? 'ENABLED' : 'DISABLED') : 'SAVED',
      };
    } catch {
      throw new Error('业务已提交但回查失败，结果待核对');
    }
  }
}
