import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

// 动作台账与业务写入共用外层事务。原Service内部的事务在这里复用，不能另开连接提交。
export function transactionService(tx: Prisma.TransactionClient): PrismaService {
  const client = new Proxy(tx, {
    get(target, key) {
      if (key === '$transaction')
        return (
          operation: ((db: Prisma.TransactionClient) => Promise<unknown>) | Promise<unknown>[],
        ) => (typeof operation === 'function' ? operation(client) : Promise.all(operation));
      const value: unknown = Reflect.get(target, key);
      return typeof value === 'function' ? (value.bind(target) as unknown) : value;
    },
  });
  return client as PrismaService;
}
