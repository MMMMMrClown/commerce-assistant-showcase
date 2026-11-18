import { PrismaClient } from '@prisma/client';
import { syncBusinessPermissions } from './business-permissions';

const prisma = new PrismaClient();
syncBusinessPermissions(prisma)
  .then(() => console.log('会员订单权限已增量同步；现有用户、业务数据和授权均已保留'))
  .catch(() => {
    console.error('权限同步失败，请检查数据库连接');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
