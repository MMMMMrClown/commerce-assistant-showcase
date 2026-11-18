/* Runs business integration tests in a disposable LOCAL database, never in the project database. */
const { ConfigModule } = require('@nestjs/config');
const { PrismaClient } = require('@prisma/client');
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');

(async () => {
  await ConfigModule.forRoot();
  const source = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1'].includes(source.hostname)) {
    throw new Error('Integration runner only supports an explicitly local PostgreSQL instance');
  }
  const name = 'sunny_member_test_' + randomBytes(8).toString('hex');
  if (!/^sunny_member_test_[a-f0-9]{16}$/.test(name)) throw new Error('Invalid test database name');
  const adminUrl = new URL(source);
  adminUrl.pathname = '/postgres';
  const testUrl = new URL(source);
  testUrl.pathname = '/' + name;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  let created = false;
  try {
    await admin.$executeRawUnsafe('CREATE DATABASE "' + name + '"');
    created = true;
    const env = { ...process.env, DATABASE_URL: testUrl.toString() };
    const migration = spawnSync(
      process.execPath,
      [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
      {
        env,
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    if (migration.status !== 0) throw new Error('Test database migration failed');
    const db = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
    try {
      await db.permission.createMany({
        data: [
          ['order:view', '订单查看'],
          ['order:create', '订单创建'],
          ['order:cancel', '订单取消'],
          ['order:pay', '订单支付'],
          ['order:refund', '整单退款'],
          ['member:view', '会员查看'],
          ['member:edit', '会员编辑'],
          ['member:benefits-manage', '会员权益管理'],
          ['member:coupon-issue', '会员发券'],
          ['seckill:view', '秒杀查看'],
          ['seckill:manage', '秒杀管理'],
        ].map(([code, name]) => ({ code, name, type: 'BUTTON' })),
      });
    } finally {
      await db.$disconnect();
    }
    console.log('Running member business tests in isolated local database');
    const result = spawnSync(
      process.execPath,
      [
        require.resolve('jest/bin/jest'),
        '--config',
        './test/jest-e2e.json',
        '--runInBand',
        '(member-(orders|benefits|coupons)|seckill|payments)',
      ],
      { env, stdio: 'inherit', windowsHide: true },
    );
    if (result.status !== 0) process.exitCode = 1;
  } finally {
    // The name is generated above, validated and never taken from user configuration.
    if (created) await admin.$executeRawUnsafe('DROP DATABASE "' + name + '" WITH (FORCE)');
    await admin.$disconnect();
  }
})().catch(() => {
  console.error(
    'Isolated business checks failed; verify local database availability/CREATEDB permission',
  );
  process.exitCode = 1;
});
