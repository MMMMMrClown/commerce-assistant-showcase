import { PrismaClient, DataScope, OrderStatus } from '@prisma/client';
import { hash } from 'bcryptjs';
import { syncBusinessPermissions } from '../src/prisma/business-permissions';

const prisma = new PrismaClient();

const permissionSeeds = [
  ['dashboard:view', '经营总览', 'MENU', '/dashboard'],
  ['region:view', '区域查看', 'MENU', '/regions'],
  ['region:create', '区域新增', 'BUTTON', null],
  ['region:edit', '区域编辑', 'BUTTON', null],
  ['store:view', '门店查看', 'MENU', '/stores'],
  ['store:create', '门店新增', 'BUTTON', null],
  ['store:edit', '门店编辑', 'BUTTON', null],
  ['product-category:view', '分类查看', 'MENU', '/product-categories'],
  ['product-category:edit', '分类维护', 'BUTTON', null],
  ['product:view', '商品查看', 'MENU', '/products'],
  ['product:create', '商品新增', 'BUTTON', null],
  ['product:edit', '商品编辑', 'BUTTON', null],
  ['order:view', '订单查看', 'MENU', '/orders'],
  ['order:create', '演示订单', 'BUTTON', null],
  ['data-import:create', '数据导入', 'MENU', '/data-imports'],
  ['data-import:view', '导入记录', 'MENU', '/data-imports/history'],
  ['metric:view', '指标查看', 'MENU', '/metrics'],
  ['metric:edit', '指标启停', 'BUTTON', null],
  ['user:view', '用户查看', 'MENU', '/system/users'],
  ['user:edit', '用户维护', 'BUTTON', null],
  ['role:view', '角色查看', 'MENU', '/system/roles'],
  ['role:edit', '角色维护', 'BUTTON', null],
  ['log:view', '日志查看', 'MENU', '/system/logs'],
] as const;

async function main() {
  await prisma.memberBenefitLedger.deleteMany();
  await prisma.memberBenefitAudit.deleteMany();
  await prisma.member.updateMany({ data: { totalSpent: 0, points: 0 } });
  await prisma.operationLog.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.dataImportError.deleteMany();
  await prisma.dataImport.deleteMany();
  await prisma.product.deleteMany();
  await prisma.productCategory.deleteMany();
  await prisma.store.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();
  await prisma.region.deleteMany();
  await prisma.metricDefinition.deleteMany();

  const permissions = await Promise.all(
    permissionSeeds.map(([code, name, type, path]) =>
      prisma.permission.create({ data: { code, name, type, path } }),
    ),
  );
  const permissionMap = new Map(permissions.map((item) => [item.code, item]));

  const adminRole = await prisma.role.create({
    data: {
      code: 'SUPER_ADMIN',
      name: '超级管理员',
      description: '拥有全部菜单、按钮和数据权限',
      dataScope: DataScope.ALL,
    },
  });
  const operatorRole = await prisma.role.create({
    data: {
      code: 'HQ_OPERATOR',
      name: '总部运营',
      description: '管理经营基础数据',
      dataScope: DataScope.ALL,
    },
  });
  const regionRole = await prisma.role.create({
    data: {
      code: 'REGION_MANAGER',
      name: '区域经理',
      description: '查看所属区域经营数据',
      dataScope: DataScope.REGION,
    },
  });
  const storeRole = await prisma.role.create({
    data: {
      code: 'STORE_MANAGER',
      name: '门店店长',
      description: '查看所属门店数据',
      dataScope: DataScope.STORE,
    },
  });
  const analystRole = await prisma.role.create({
    data: {
      code: 'ANALYST',
      name: '数据分析员',
      description: '查看经营分析数据',
      dataScope: DataScope.ALL,
    },
  });

  const assign = async (roleId: string, codes: string[]) =>
    prisma.rolePermission.createMany({
      data: codes.map((code) => ({ roleId, permissionId: permissionMap.get(code)!.id })),
    });
  await assign(
    adminRole.id,
    permissions.map((item) => item.code),
  );
  await assign(
    operatorRole.id,
    permissions
      .filter((item) => !item.code.startsWith('user:') && !item.code.startsWith('role:'))
      .map((item) => item.code),
  );
  await assign(regionRole.id, [
    'dashboard:view',
    'store:view',
    'product:view',
    'order:view',
    'metric:view',
  ]);
  await assign(storeRole.id, ['dashboard:view', 'product:view', 'order:view']);
  await assign(analystRole.id, [
    'dashboard:view',
    'store:view',
    'product:view',
    'order:view',
    'metric:view',
    'data-import:view',
  ]);

  const east = await prisma.region.create({ data: { code: 'EAST', name: '华东区域' } });
  const south = await prisma.region.create({ data: { code: 'SOUTH', name: '华南区域' } });
  const north = await prisma.region.create({ data: { code: 'NORTH', name: '华北区域' } });
  const passwordHash = await hash('Sunny@123456', 10);
  const admin = await prisma.user.create({
    data: { username: 'admin', passwordHash, name: '系统管理员', email: 'admin@sunnycoffee.local' },
  });
  const eastManager = await prisma.user.create({
    data: {
      username: 'east.manager',
      passwordHash,
      name: '华东区域经理',
      email: 'east@sunnycoffee.local',
      regionId: east.id,
    },
  });
  const storeManager = await prisma.user.create({
    data: {
      username: 'store.manager',
      passwordHash,
      name: '门店店长',
      email: 'store@sunnycoffee.local',
      regionId: east.id,
    },
  });
  await prisma.userRole.createMany({
    data: [
      { userId: admin.id, roleId: adminRole.id },
      { userId: eastManager.id, roleId: regionRole.id },
      { userId: storeManager.id, roleId: storeRole.id },
    ],
  });

  const stores = await Promise.all([
    prisma.store.create({
      data: {
        code: 'SH001',
        name: '上海静安店',
        regionId: east.id,
        address: '上海市静安区南京西路',
        phone: '021-60000001',
        openedAt: new Date('2024-01-08'),
      },
    }),
    prisma.store.create({
      data: {
        code: 'HZ001',
        name: '杭州西湖店',
        regionId: east.id,
        address: '杭州市西湖区北山街',
        phone: '0571-60000002',
        openedAt: new Date('2024-03-18'),
      },
    }),
    prisma.store.create({
      data: {
        code: 'GZ001',
        name: '广州天河店',
        regionId: south.id,
        address: '广州市天河区体育西路',
        phone: '020-60000003',
        openedAt: new Date('2024-05-20'),
      },
    }),
    prisma.store.create({
      data: {
        code: 'BJ001',
        name: '北京朝阳店',
        regionId: north.id,
        address: '北京市朝阳区建国路',
        phone: '010-60000004',
        openedAt: new Date('2024-07-01'),
      },
    }),
  ]);
  await prisma.user.update({ where: { id: storeManager.id }, data: { storeId: stores[0].id } });
  await prisma.store.update({ where: { id: stores[0].id }, data: { managerId: storeManager.id } });

  const daily = await prisma.productCategory.create({
    data: { code: 'DAILY', name: '日用百货', sort: 1 },
  });
  const tea = await prisma.productCategory.create({ data: { code: 'DIGITAL', name: '数码配件', sort: 2 } });
  const food = await prisma.productCategory.create({
    data: { code: 'FOOD', name: '休闲食品', sort: 3 },
  });
  const products = await Promise.all([
    prisma.product.create({
      data: {
        code: 'P001',
        name: '便携保温杯',
        categoryId: daily.id,
        price: 32,
        costPrice: 11,
        imageUrl: null,
      },
    }),
    prisma.product.create({
      data: {
        code: 'P002',
        name: '轻便购物袋',
        categoryId: daily.id,
        price: 26,
        costPrice: 8,
        imageUrl: null,
      },
    }),
    prisma.product.create({
      data: {
        code: 'P003',
        name: '编织充电线',
        categoryId: tea.id,
        price: 30,
        costPrice: 10,
        imageUrl: null,
      },
    }),
    prisma.product.create({
      data: {
        code: 'P004',
        name: '全麦饼干',
        categoryId: food.id,
        price: 18,
        costPrice: 6,
        imageUrl: null,
      },
    }),
    prisma.product.create({
      data: {
        code: 'P005',
        name: '每日坚果礼盒',
        categoryId: food.id,
        price: 28,
        costPrice: 12,
        imageUrl: null,
      },
    }),
  ]);

  const now = new Date();
  await syncBusinessPermissions(prisma);
  for (let day = 20; day >= 0; day -= 1) {
    for (let index = 0; index < stores.length; index += 1) {
      const orderedAt = new Date(now);
      orderedAt.setDate(now.getDate() - day);
      orderedAt.setHours(8 + ((day + index * 3) % 12), 20, 0, 0);
      const product = products[(day + index) % products.length];
      const quantity = 1 + ((day + index) % 3);
      const original = Number(product.price) * quantity;
      const discount = day % 5 === 0 ? 2 : 0;
      await prisma.order.create({
        data: {
          orderNo: `SEED-${String(day).padStart(2, '0')}-${index}`,
          storeId: stores[index].id,
          orderedAt,
          status: day % 11 === 0 ? OrderStatus.CANCELED : OrderStatus.COMPLETED,
          originalAmount: original,
          discountAmount: discount,
          paidAmount: original - discount,
          payableAmount: original - discount,
          items: {
            create: {
              productId: product.id,
              productName: product.name,
              productCode: product.code,
              quantity,
              unitPrice: product.price,
              subtotal: original,
            },
          },
        },
      });
    }
  }

  await prisma.metricDefinition.createMany({
    data: [
      {
        code: 'REVENUE',
        name: '营业额',
        description: '已完成订单实付金额之和',
        formula: 'SUM(orders.paidAmount)',
      },
      {
        code: 'ORDER_COUNT',
        name: '订单量',
        description: '已完成订单数量',
        formula: 'COUNT(DISTINCT orders.id)',
      },
      {
        code: 'AVG_ORDER_VALUE',
        name: '平均客单价',
        description: '营业额除以订单量',
        formula: 'REVENUE / ORDER_COUNT',
      },
      {
        code: 'PRODUCT_SALES',
        name: '商品销量',
        description: '已完成订单商品数量之和',
        formula: 'SUM(orderItems.quantity)',
      },
    ],
  });
  console.log('Seed completed. admin / Sunny@123456');
}

main().finally(() => prisma.$disconnect());
