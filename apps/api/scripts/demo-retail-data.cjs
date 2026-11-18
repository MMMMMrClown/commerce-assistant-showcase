// 【独立演示数据】默认仅打印计划；所有写入只针对脚本新建的retail_demo_*数据库。
const { PrismaClient } = require('@prisma/client');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
process.chdir(path.resolve(__dirname, '..'));
const mode = process.argv[2];
if (!['--create', '--verify'].includes(mode)) {
  console.log(
    '演示数据计划：6分类、24商品、36会员、约134订单（近60天），含库存流水、券、MOCK支付退款和自动权益记录。',
  );
  console.log(
    '默认不写数据库。--verify：随机隔离库生成并校验后清理；--create：新建独立演示库并保留。不会修改当前库或.env。',
  );
  process.exit(0);
}
(async () => {
  await require('@nestjs/config').ConfigModule.forRoot();
  const source = new URL(process.env.DATABASE_URL);
  assert(['localhost', '127.0.0.1'].includes(source.hostname), 'Only local database supported');
  const name = 'retail_demo_' + Date.now() + '_' + randomBytes(4).toString('hex');
  assert(/^retail_demo_\d{13}_[a-f0-9]{8}$/.test(name));
  const adminUrl = new URL(source);
  adminUrl.pathname = '/postgres';
  const targetUrl = new URL(source);
  targetUrl.pathname = '/' + name;
  assert.notEqual(source.pathname, targetUrl.pathname);
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  let db,
    created = false,
    complete = false;
  try {
    await admin.$executeRawUnsafe('CREATE DATABASE "' + name + '"');
    created = true;
    const migration = spawnSync(
      process.execPath,
      [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
      {
        env: { ...process.env, DATABASE_URL: targetUrl.toString() },
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    assert.equal(migration.status, 0, 'Demo migration failed');
    db = new PrismaClient({ datasources: { db: { url: targetUrl.toString() } } });
    const media = require('../../web/public/demo/catalog.json');
    assert.equal(media.length, 24, 'Prepare all product images before creating the demo');
    const withAccounts = process.argv.includes('--project-accounts');
    let projectAccounts;
    if (withAccounts) {
      const original = new PrismaClient({ datasources: { db: { url: source.toString() } } });
      try {
        projectAccounts = {
          permissions: await original.permission.findMany(),
          roles: await original.role.findMany({
            include: { permissions: { include: { permission: true } } },
          }),
          users: await original.user.findMany({ include: { roles: { include: { role: true } } } }),
          regions: await original.region.findMany(),
          stores: await original.store.findMany(),
        };
      } finally {
        await original.$disconnect();
      }
    }
    const { DataScopeService } = require('../dist/src/auth/auth');
    const { DEFAULT_MEMBER_TIERS } = require('../dist/src/member-benefits/benefit-rules');
    const {
      MemberBenefitsService,
    } = require('../dist/src/member-benefits/member-benefits.service');
    const { MembersService } = require('../dist/src/members/members.service');
    const { OrdersService } = require('../dist/src/orders/orders.service');
    const { ProductsService } = require('../dist/src/modules/resources');
    const { CouponsService } = require('../dist/src/coupons/coupons.service');
    const { PaymentsService } = require('../dist/src/payments/payments.service');
    const { MockPaymentGateway } = require('../dist/src/payments/mock-payment.gateway');
    const { MarketingService } = require('../dist/src/marketing/marketing.service');
    const { SeckillService } = require('../dist/src/seckill/seckill.service');
    const scope = new DataScopeService(),
      benefits = new MemberBenefitsService(db, scope),
      members = new MembersService(db, benefits),
      orders = new OrdersService(db, scope, benefits),
      products = new ProductsService(db, scope),
      coupons = new CouponsService(db),
      payments = new PaymentsService(db, scope, benefits, new MockPaymentGateway()),
      marketing = new MarketingService(db, coupons),
      seckill = new SeckillService(db, orders);
    const now = Date.now(),
      day = 86400000,
      at = (t) => new Date(t);
    await db.memberBenefitPolicy.upsert({
      where: { id: 'default' },
      create: { id: 'default', tiers: DEFAULT_MEMBER_TIERS },
      update: { tiers: DEFAULT_MEMBER_TIERS },
    });
    const codes = [
      'dashboard:view',
      'product:view',
      'product:create',
      'product:edit',
      'product-category:view',
      'product-category:edit',
      'member:view',
      'member:create',
      'member:edit',
      'member:benefits-manage',
      'member:coupon-issue',
      'order:view',
      'order:create',
      'order:cancel',
      'order:pay',
      'order:refund',
      'order:fulfill',
      'seckill:view',
      'seckill:manage',
      'store:view',
      'region:view',
      'metric:view',
      'log:view',
      'data-import:view',
    ];
    for (const code of codes)
      await db.permission.upsert({
        where: { code },
        create: { code, name: code, type: 'BUTTON' },
        update: {},
      });
    const role = await db.role.create({
      data: {
        code: 'SUPER_ADMIN',
        name: '演示管理员',
        dataScope: 'ALL',
        permissions: {
          create: (await db.permission.findMany()).map((p) => ({ permissionId: p.id })),
        },
      },
    });
    const entity = await db.user.create({
      data: {
        username: 'demo',
        name: '演示运营员',
        passwordHash: await require('bcryptjs').hash('DemoOnly@2026', 10),
        roles: { create: { roleId: role.id } },
        createdAt: at(now - 70 * day),
      },
    });
    const user = {
      ...entity,
      permissions: codes,
      roles: [{ code: 'SUPER_ADMIN', name: role.name, dataScope: 'ALL' }],
    };
    const stores = [];
    if (projectAccounts) {
      for (const region of projectAccounts.regions) await db.region.create({ data: region });
      for (const store of projectAccounts.stores) {
        const { managerId, ...data } = store;
        stores.push(await db.store.create({ data }));
      }
      assert(stores.length >= 4, 'At least four existing stores are required');
    } else
      for (let i = 0; i < 2; i++) {
        const region = await db.region.create({
          data: { code: 'DEMO-R' + i, name: '演示' + (i ? '华南' : '华东') + '区' },
        });
        for (let j = 0; j < 2; j++)
          stores.push(
            await db.store.create({
              data: {
                code: 'DEMO-S' + i + j,
                name: '演示' + (i ? '华南' : '华东') + (j ? '二' : '一') + '店',
                regionId: region.id,
                address: '合成演示地址，不对应真实门店',
                openedAt: at(now - 180 * day),
              },
            }),
          );
      }
    const categoryNames = ['日用百货', '数码配件', '休闲食品', '办公文具', '运动户外', '个护清洁'];
    const demoNames = [
      '林晓晴',
      '陈子涵',
      '王雨桐',
      '李明轩',
      '张悦宁',
      '刘思远',
      '赵安然',
      '周一诺',
      '吴嘉怡',
      '徐书言',
      '孙可欣',
      '朱景行',
      '胡沐阳',
      '郭若溪',
      '何予安',
      '高星辰',
      '罗清和',
      '郑知夏',
      '梁初见',
      '谢景明',
      '宋晚晴',
      '唐亦晨',
      '许静宜',
      '韩书宁',
      '冯嘉木',
      '邓芷宁',
      '曹语晨',
      '彭向晚',
      '曾修远',
      '萧乐言',
      '田心悦',
      '董知秋',
      '袁星河',
      '潘若琳',
      '叶晨曦',
      '苏念安',
    ];
    const prices = [
      39.9, 19.9, 129, 12.9, 159, 49, 99, 39.9, 49.9, 19.9, 29.9, 59.9, 29.9, 12.9, 19.9, 9.9, 79,
      129, 199, 29.9, 29.9, 39.9, 49.9, 12.9,
    ];
    const catalog = [];
    for (let i = 0; i < 6; i++) {
      const category = await db.productCategory.create({
        data: { name: categoryNames[i], code: 'CAT' + String(i + 1).padStart(3, '0'), sort: i + 1 },
      });
      for (let j = 0; j < 4; j++) {
        const n = i * 4 + j,
          p = await products.create({
            name: media[n].name,
            imageUrl: media[n].imageUrl,
            code: 'DEMO-P' + String(n + 1).padStart(3, '0'),
            categoryId: category.id,
            price: prices[n],
            costPrice: Math.round(prices[n] * 0.55 * 100) / 100,
            enabled: n !== 20,
          });
        await products.stock(
          p.id,
          {
            quantity: n === 23 ? 0 : n === 22 ? 2 : 80,
            warning: 5,
            version: 0,
            reason: '合成演示库存初始化，不对应真实仓库',
            requestId: randomUUID(),
          },
          user,
        );
        catalog.push(p);
      }
    }
    await products.recycle(catalog[21].id, false);
    await db.productStockMovement.updateMany({
      where: { kind: 'INITIALIZE' },
      data: { createdAt: at(now - 66 * day) },
    });
    const people = [];
    for (let i = 0; i < 34; i++) {
      const today = new Date(now + 8 * 3600000).toISOString().slice(5, 10);
      const member = await members.create({
        name: demoNames[i],
        phone: '1999000' + String(i + 1).padStart(4, '0'),
        birthday: i < 3 ? '2000-' + today : i === 3 ? '2000-02-29' : undefined,
        enabled: i < 30,
      });
      await db.member.update({
        where: { id: member.id },
        data: {
          createdAt: at(now - 68 * day),
          avatarUrl: '/demo/avatars/' + String(i + 1).padStart(2, '0') + '.svg',
        },
      });
      people.push(member);
    }
    await db.product.updateMany({ data: { createdAt: at(now - 66 * day) } });
    await db.productCategory.updateMany({ data: { createdAt: at(now - 70 * day) } });
    await db.region.updateMany({ data: { createdAt: at(now - 70 * day) } });
    await db.store.updateMany({ data: { createdAt: at(now - 70 * day) } });
    const template = await coupons.createTemplate({
      name: '演示·满100减10',
      minimumSpend: '100',
      discountAmount: '10',
      startsAt: at(now - 66 * day).toISOString(),
      endsAt: at(now + 30 * day).toISOString(),
    });
    await db.couponTemplate.update({
      where: { id: template.id },
      data: { createdAt: at(now - 66 * day) },
    });
    // 【历史分布】金额由现行规则算出；只在本隔离库回填合成时间，不代表历史真实业绩。
    async function stamp(orderId, t, expired = false) {
      const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
      await db.order.update({
        where: { id: orderId },
        data: {
          createdAt: at(t),
          orderedAt: at(t),
          expiresAt: at(t + (expired ? 10000 : 1800000)),
          ...(order.canceledAt ? { canceledAt: at(t + 20000) } : {}),
        },
      });
      await db.paymentRecord.updateMany({
        where: { orderId },
        data: { createdAt: at(t + 5000), updatedAt: at(t + 10000) },
      });
      await db.paymentRecord.updateMany({
        where: { orderId, status: 'SUCCEEDED' },
        data: { paidAt: at(t + 10000), updatedAt: at(t + 10000) },
      });
      await db.refundRecord.updateMany({
        where: { orderId },
        data: { createdAt: at(t + 15000), updatedAt: at(t + 20000), refundedAt: at(t + 20000) },
      });
      await db.paymentEvent.updateMany({
        where: { orderId, kind: 'PAYMENT' },
        data: { createdAt: at(t + 10000) },
      });
      await db.paymentEvent.updateMany({
        where: { orderId, kind: 'REFUND' },
        data: { createdAt: at(t + 20000) },
      });
      await db.productStockMovement.updateMany({
        where: { orderId, kind: 'RESERVE' },
        data: { createdAt: at(t) },
      });
      await db.productStockMovement.updateMany({
        where: { orderId, kind: 'CONSUME' },
        data: { createdAt: at(t + 10000) },
      });
      await db.productStockMovement.updateMany({
        where: { orderId, kind: { in: ['RELEASE', 'REFUND'] } },
        data: { createdAt: at(t + 20000) },
      });
      await db.memberBenefitLedger.updateMany({
        where: { orderId, kind: 'PAYMENT' },
        data: { createdAt: at(t + 10000) },
      });
      await db.memberBenefitLedger.updateMany({
        where: { orderId, kind: 'REFUND' },
        data: { createdAt: at(t + 20000) },
      });
      await db.memberCoupon.updateMany({
        where: { orderId },
        data: {
          createdAt: at(t - 1000),
          reservedAt: at(t),
          ...(order.status === 'PAID' ? { usedAt: at(t + 10000) } : {}),
        },
      });
    }
    async function place(input) {
      const q = await orders.quote(user, input);
      return orders.create(user, { ...input, quoteHash: q.quoteHash, requestId: randomUUID() });
    }
    const pending = [];
    for (let i = 0; i < 120; i++) {
      // 日常经营以正常成交为主；少量取消、超时、退款及一笔失败支付用于展示异常处理。
      const scenario = i % 40;
      const mode = scenario === 0 ? 0 : scenario === 1 ? 1 : scenario === 2 ? 6 : 4;
      if (i >= 116) {
        pending.push(i);
        continue;
      }
      const p = catalog[i % 20],
        p2 = catalog[(i + 7) % 20],
        member = people[i % 30];
      let input = {
        storeId: stores[i % 4].id,
        memberId: member.id,
        benefitMode: 'MEMBER',
        items: [
          { productId: p.id, quantity: 1 + (i % 3) },
          { productId: p2.id, quantity: 1 },
        ],
      };
      let issued;
      if (i % 8 === 7) {
        input.items[0].quantity = Math.max(
          input.items[0].quantity,
          Math.ceil((100 - Number(p2.price)) / Number(p.price)),
        );
        issued = await coupons.issue(user, member.id, {
          templateId: template.id,
          requestId: randomUUID(),
        });
        input = { ...input, benefitMode: 'COUPON', couponId: issued.id };
      }
      const o = await place(input);
      if (mode === 0) await orders.cancel(user, o.id);
      else if (mode === 1) {
        await payments.start(user, o.id);
        await db.order.update({ where: { id: o.id }, data: { expiresAt: at(now - 1000) } });
        await orders.expireSeckillOrder(o.id);
      } else {
        await payments.start(user, o.id);
        await payments.simulate(user, o.id, 'PAYMENT', { outcome: 'SUCCESS', attempt: 1 });
        if (mode === 6) {
          await payments.requestRefund(user, o.id, { reason: '合成演示整单退款' });
          await payments.simulate(user, o.id, 'REFUND', { outcome: 'SUCCESS', attempt: 1 });
        }
      }
      const t = now - 60 * day + (i * day) / 2;
      await stamp(o.id, t, mode === 1);
      // 历史演示成交模拟已完成；保留近七天已支付订单供运营处理，不改变支付/库存流水。
      if ([4, 5, 7].includes(mode) && t <= now - 7 * day) {
        await db.order.updateMany({
          where: { id: o.id, status: 'PAID' },
          data: { status: 'COMPLETED', updatedAt: at(t + 20000) },
        });
      }
      if (issued)
        await db.memberCoupon.update({
          where: { id: issued.id },
          data: { createdAt: at(t - 1000) },
        });
    }
    // 【当前待处理】待支付/失败待重试全部放在今天，避免制造历史永久占用。
    for (const i of pending) {
      let input = {
        storeId: stores[i % 4].id,
        memberId: people[i % 30].id,
        benefitMode: 'NONE',
        items: [{ productId: catalog[i % 20].id, quantity: 1 }],
      };
      if (i === pending[0]) {
        const held = await coupons.issue(user, input.memberId, {
          templateId: template.id,
          requestId: randomUUID(),
        });
        input = {
          ...input,
          benefitMode: 'COUPON',
          couponId: held.id,
          items: [{ productId: catalog[i % 20].id, quantity: 3 }],
        };
      }
      const o = await place(input);
      if (i === 117) {
        await payments.start(user, o.id);
        await payments.simulate(user, o.id, 'PAYMENT', { outcome: 'FAILURE', attempt: 1 });
      }
    }

    // 【历史基础数据】LEGACY无会员、无渠道流水、无库存占用，不伪造已执行的交易记录。
    for (let i = 0; i < 12; i++) {
      const p = catalog[i % 20],
        amount = Number(p.price) * 2;
      await db.order.create({
        data: {
          orderNo: 'DEMO-LEGACY-' + i,
          source: 'LEGACY',
          storeId: stores[i % 4].id,
          orderedAt: at(now - (60 - i * 5) * day),
          status: 'COMPLETED',
          originalAmount: amount,
          payableAmount: amount,
          discountAmount: 0,
          paidAmount: amount,
          items: {
            create: {
              productId: p.id,
              productName: p.name,
              productCode: p.code,
              quantity: 2,
              unitPrice: p.price,
              subtotal: amount,
            },
          },
        },
      });
    }
    const activity = await seckill.create({
      name: '演示·周末限时特惠',
      productId: catalog[0].id,
      price: 9.9,
      stock: 20,
      holdMinutes: 5,
      startsAt: at(now - day).toISOString(),
      endsAt: at(now + day).toISOString(),
    });
    for (let i = 0; i < 2; i++) {
      const o = await place({
        storeId: stores[i].id,
        memberId: people[i].id,
        benefitMode: 'SECKILL',
        activityId: activity.id,
        items: [{ productId: catalog[0].id, quantity: 1 }],
      });
      if (!i) await orders.cancel(user, o.id);
      else {
        await payments.start(user, o.id);
        await payments.simulate(user, o.id, 'PAYMENT', { outcome: 'SUCCESS', attempt: 1 });
        await payments.requestRefund(user, o.id, { reason: '合成秒杀整单退款' });
        await payments.simulate(user, o.id, 'REFUND', { outcome: 'SUCCESS', attempt: 1 });
      }
    }
    // 【券场景】批量、未开始、过期、作废与两类自动权益均使用原发放服务。
    await coupons.issueBatch(user, {
      mode: 'SELECTED',
      memberIds: people.slice(0, 5).map((m) => m.id),
      templateId: template.id,
      requestId: randomUUID(),
    });
    const future = await coupons.createTemplate({
      name: '演示·下周券',
      minimumSpend: '50',
      discountAmount: '5',
      startsAt: at(now + 7 * day).toISOString(),
      endsAt: at(now + 14 * day).toISOString(),
    });
    await coupons.issue(user, people[0].id, { templateId: future.id, requestId: randomUUID() });
    const expired = await coupons.createTemplate({
      name: '演示·历史券',
      minimumSpend: '50',
      discountAmount: '5',
      startsAt: at(now - day).toISOString(),
      endsAt: at(now + day).toISOString(),
    });
    const expiredCoupon = await coupons.issue(user, people[1].id, {
      templateId: expired.id,
      requestId: randomUUID(),
    });
    await db.memberCoupon.update({
      where: { id: expiredCoupon.id },
      data: { createdAt: at(now - 10 * day) },
    });
    await db.couponTemplate.update({
      where: { id: expired.id },
      data: {
        createdAt: at(now - 14 * day),
        startsAt: at(now - 14 * day),
        endsAt: at(now - 7 * day),
      },
    });
    const voided = await coupons.issue(user, people[2].id, {
      templateId: template.id,
      requestId: randomUUID(),
    });
    await coupons.voidCoupon(people[2].id, voided.id);
    for (const kind of ['BIRTHDAY', 'WELCOME']) {
      const config = await db.marketingProgram.findUniqueOrThrow({ where: { kind } });
      await marketing.configure(user, kind, {
        enabled: true,
        templateId: template.id,
        version: config.version,
      });
    }
    for (let i = 34; i < 36; i++) {
      const member = await members.create({
        name: demoNames[i],
        phone: '1999000' + String(i + 1).padStart(4, '0'),
      });
      await db.member.update({
        where: { id: member.id },
        data: { avatarUrl: '/demo/avatars/' + String(i + 1).padStart(2, '0') + '.svg' },
      });
    }
    await marketing.sweep();
    for (const kind of ['BIRTHDAY', 'WELCOME']) {
      const config = await db.marketingProgram.findUniqueOrThrow({ where: { kind } });
      await marketing.configure(user, kind, {
        enabled: false,
        templateId: template.id,
        version: config.version,
      });
    }
    if (projectAccounts) {
      for (const p of projectAccounts.permissions) {
        const { id, ...data } = p;
        await db.permission.upsert({ where: { code: p.code }, create: data, update: data });
      }
      for (const r of projectAccounts.roles) {
        const { id, permissions, ...data } = r;
        const role = await db.role.upsert({ where: { code: r.code }, create: data, update: data });
        await db.rolePermission.deleteMany({ where: { roleId: role.id } });
        for (const rp of permissions) {
          const p = await db.permission.findUniqueOrThrow({ where: { code: rp.permission.code } });
          await db.rolePermission.create({ data: { roleId: role.id, permissionId: p.id } });
        }
      }
      for (const u of projectAccounts.users) {
        if (u.username === 'demo') continue;
        const { roles, ...data } = u;
        await db.user.create({
          data: {
            ...data,
            roles: {
              create: await Promise.all(
                roles.map(async (ur) => ({
                  roleId: (await db.role.findUniqueOrThrow({ where: { code: ur.role.code } })).id,
                })),
              ),
            },
          },
        });
      }
      for (const store of projectAccounts.stores)
        if (store.managerId)
          await db.store.update({ where: { id: store.id }, data: { managerId: store.managerId } });
    }
    await db.operationLog.create({
      data: {
        userId: entity.id,
        module: '演示数据',
        action: '通过原业务服务生成合成交易、库存与营销样例',
        method: 'SCRIPT',
        path: 'scripts/demo-retail-data.cjs',
        success: true,
      },
    });
    // 指标口径是基础配置，独立演示库也应具备；不把定义表伪装成动态公式引擎。
    for (const metric of [
      {
        code: 'revenue',
        name: '营业额',
        description:
          '当前筛选范围内已完成且未删除订单的实付金额合计，不包含待支付、已支付未完成、取消及整单退款订单。',
        formula: 'SUM(completed.paidAmount)',
      },
      {
        code: 'orderCount',
        name: '订单量',
        description: '当前筛选范围内已完成且未删除的订单数量，与订单列表的全部状态数量不同。',
        formula: 'COUNT(completed.id)',
      },
      {
        code: 'averageOrderValue',
        name: '平均客单价',
        description: '已完成订单营业额除以已完成订单数，无订单时为0。',
        formula: 'revenue / orderCount',
      },
      {
        code: 'productSales',
        name: '商品销量',
        description: '已完成订单商品明细件数合计，不是订单笔数。',
        formula: 'SUM(completed.items.quantity)',
      },
      {
        code: 'activeStores',
        name: '在营门店',
        description: '当前账号与区域、门店筛选范围内启用且未删除的门店数，不限是否有成交。',
        formula: 'COUNT(enabledStores)',
      },
      {
        code: 'growthRate',
        name: '营业额环比',
        description: '与前一个等长时间窗口比较；上期营业额为0时不计算增长率。',
        formula: '(revenue - previousRevenue) / previousRevenue × 100%',
      },
    ])
      await db.metricDefinition.upsert({
        where: { code: metric.code },
        create: metric,
        update: {},
      });
    assert.equal(await db.product.count({ where: { imageUrl: { not: null } } }), 24);
    assert.equal(await db.member.count({ where: { avatarUrl: { not: null } } }), 36);
    // 【生成后校验】余额和占用对账；不把销量倒推成当前库存。
    for (const p of await db.product.findMany()) {
      const holds = await db.productStockHold.aggregate({
        where: { productId: p.id, status: 'RESERVED' },
        _sum: { quantity: true },
      });
      assert.equal(p.stockReserved, holds._sum.quantity || 0);
      assert(p.stockOnHand >= p.stockReserved);
      const moves = await db.productStockMovement.findMany({
        where: { productId: p.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      let onHand = null,
        reserved = 0;
      for (const m of moves) {
        assert.equal(m.beforeOnHand, onHand);
        assert.equal(m.beforeReserved, reserved);
        onHand = m.afterOnHand;
        reserved = m.afterReserved;
      }
      assert.equal(onHand, p.stockOnHand);
      assert.equal(reserved, p.stockReserved);
    }
    assert.equal(
      (await db.seckillActivity.findUnique({ where: { id: activity.id } })).remainingStock,
      19,
    );
    // 【新记录页校验】所有展示状态、两页查询、真实来源和字段边界。
    const allRecords = await coupons.records({ page: 1 });
    assert.equal(allRecords.total, await db.memberCoupon.count());
    assert.equal(allRecords.items.length, 20);
    assert((await coupons.records({ page: 2 })).items.length > 0);
    for (const status of ['AVAILABLE', 'RESERVED', 'USED', 'VOID', 'EXPIRED', 'NOT_STARTED']) {
      const result = await coupons.records({ page: 1, status });
      assert(result.total > 0, status);
      assert(result.items.every((c) => c.displayStatus === status));
    }
    assert(allRecords.items.some((c) => c.source === 'BIRTHDAY'));
    assert(allRecords.items.some((c) => c.source === 'WELCOME'));
    assert(allRecords.items.some((c) => c.source === 'BATCH'));
    assert(
      allRecords.items.every(
        (c) => !('orderId' in c) && !('requestId' in c) && !('passwordHash' in c.issuedBy),
      ),
    );
    assert(allRecords.items.every((c) => c.member.phone.includes('****')));
    assert(
      (await coupons.records({ page: 1, templateId: template.id })).items.every(
        (c) => c.template.id === template.id,
      ),
    );
    assert(
      (await coupons.records({ page: 1, keyword: '下周券' })).items.every(
        (c) => c.template.id === future.id,
      ),
    );
    await assert.rejects(() =>
      coupons.records({ page: 1, startDate: '2026-11-15', endDate: '2026-11-14' }),
    );
    const counts = {
      products: await db.product.count(),
      members: await db.member.count(),
      orders: await db.order.count(),
      coupons: await db.memberCoupon.count(),
      stockMovements: await db.productStockMovement.count(),
    };
    complete = true;
    console.log(
      JSON.stringify(
        {
          mode,
          database: name,
          synthetic: true,
          counts,
          checks: '余额/占用/流水顺序通过',
          ...(mode === '--create'
            ? {
                demoLogin: 'demo / DemoOnly@2026',
                note: '未切换当前服务、未改.env。两个自动营销玩法已恢复关闭。',
              }
            : { note: '验证库即将清理' }),
        },
        null,
        2,
      ),
    );
  } finally {
    if (db) await db.$disconnect();
    if (created && (mode === '--verify' || !complete))
      await admin.$executeRawUnsafe('DROP DATABASE "' + name + '" WITH (FORCE)');
    await admin.$disconnect();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
