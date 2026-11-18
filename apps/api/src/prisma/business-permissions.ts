import { PrismaClient } from '@prisma/client';
import { DEFAULT_MEMBER_TIERS } from '../member-benefits/benefit-rules';

export const businessPermissions = [
  { code: 'order:fulfill', name: '模拟发货与收货', type: 'BUTTON', path: null },
  { code: 'order:pay', name: '模拟订单支付', type: 'BUTTON', path: null },
  { code: 'order:refund', name: '整单退款', type: 'BUTTON', path: null },
  { code: 'seckill:view', name: '秒杀活动查看', type: 'MENU', path: '/seckill' },
  { code: 'seckill:manage', name: '秒杀活动管理', type: 'BUTTON', path: null },
  { code: 'member:view', name: '会员查看', type: 'MENU', path: '/members' },
  { code: 'member:create', name: '会员新增', type: 'BUTTON', path: null },
  { code: 'member:edit', name: '会员编辑', type: 'BUTTON', path: null },
  { code: 'member:benefits-manage', name: '会员权益管理', type: 'BUTTON', path: null },
  { code: 'member:coupon-issue', name: '会员发券', type: 'BUTTON', path: null },
  { code: 'order:cancel', name: '取消待支付订单', type: 'BUTTON', path: null },
] as const;

// Only add the permissions needed by this delivery; never clear existing assignments.
export async function syncBusinessPermissions(prisma: PrismaClient) {
  await prisma.memberBenefitPolicy.upsert({
    where: { id: 'default' },
    create: { id: 'default', tiers: DEFAULT_MEMBER_TIERS },
    update: {},
  });
  for (const permission of businessPermissions) {
    await prisma.permission.upsert({
      where: { code: permission.code },
      create: permission,
      update: permission,
    });
  }
  const grants: Record<string, string[]> = {
    SUPER_ADMIN: businessPermissions.map((item) => item.code),
    HQ_OPERATOR: businessPermissions.map((item) => item.code),
    STORE_MANAGER: [
      'seckill:view',
      'member:view',
      'store:view',
      'product:view',
      'order:view',
      'order:create',
      'order:cancel',
      'order:pay',
      'order:fulfill',
    ],
  };
  for (const [code, codes] of Object.entries(grants)) {
    const role = await prisma.role.findUnique({ where: { code } });
    if (!role) continue;
    const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } });
    for (const permission of permissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        create: { roleId: role.id, permissionId: permission.id },
        update: {},
      });
    }
  }
}
