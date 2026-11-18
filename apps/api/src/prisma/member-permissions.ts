import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 找到项目已有的超级管理员角色
  const role = await prisma.role.findUniqueOrThrow({
    where: { code: 'SUPER_ADMIN' },
  });

  // 创建新增会员权限；已经存在则保留
  const permission = await prisma.permission.upsert({
    where: { code: 'member:create' },
    update: {},
    create: {
      code: 'member:create',
      name: '会员新增',
      type: 'BUTTON',
    },
  });

  // 将权限分配给超级管理员角色
  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId: role.id,
        permissionId: permission.id,
      },
    },
    update: {},
    create: {
      roleId: role.id,
      permissionId: permission.id,
    },
  });

  // 创建会员查看权限
  const viewPermission = await prisma.permission.upsert({
    where: { code: 'member:view' },
    update: {},
    create: {
      code: 'member:view',
      name: '会员查看',
      type: 'MENU',
      path: '/members',
    },
  });

  // 将查看权限分配给超级管理员
  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId: role.id,
        permissionId: viewPermission.id,
      },
    },
    update: {},
    create: {
      roleId: role.id,
      permissionId: viewPermission.id,
    },
  });

  // 创建会员编辑权限
  const editPermission = await prisma.permission.upsert({
    where: { code: 'member:edit' },
    update: {},
    create: {
      code: 'member:edit',
      name: '会员编辑',
      type: 'BUTTON',
    },
  });

  // 将编辑权限分配给超级管理员
  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId: role.id,
        permissionId: editPermission.id,
      },
    },
    update: {},
    create: {
      roleId: role.id,
      permissionId: editPermission.id,
    },
  });

  console.log('会员新增、查看、编辑权限已分配给超级管理员');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
