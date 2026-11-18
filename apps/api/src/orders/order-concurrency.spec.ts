import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OrdersService } from './orders.service';
import { BenefitMode, type CreateOrderDto } from './order.dto';
import type { AuthUser } from '../common/api';

const input: CreateOrderDto = {
  storeId: 's',
  memberId: 'm',
  items: [{ productId: 'p', quantity: 1 }],
  benefitMode: BenefitMode.NONE,
  requestId: '11111111-1111-4111-8111-111111111111',
  quoteHash: 'a'.repeat(64),
};
function databaseError(sqlState: string) {
  return new Prisma.PrismaClientKnownRequestError('synthetic raw SQL conflict', {
    code: 'P2010',
    clientVersion: 'test',
    meta: { code: sqlState },
  });
}
function service(transaction: jest.Mock) {
  return new OrdersService(
    { $transaction: transaction } as unknown as ConstructorParameters<typeof OrdersService>[0],
    {} as ConstructorParameters<typeof OrdersService>[1],
    {} as ConstructorParameters<typeof OrdersService>[2],
  );
}
describe('建单原始锁查询冲突恢复', () => {
  it('其他原始SQL错误原样失败，不被误当成竞争重试', async () => {
    const error = databaseError('42501');
    const transaction = jest.fn().mockRejectedValue(error);
    await expect(service(transaction).create({ id: 'operator' } as AuthUser, input)).rejects.toBe(
      error,
    );
    expect(transaction).toHaveBeenCalledTimes(1);
  });
  it.each(['40001', '40P01'])('%s仅重试已知可恢复的数据库竞争', async (code) => {
    const saved = { id: 'existing-order' };
    const transaction = jest
      .fn()
      .mockRejectedValueOnce(databaseError(code))
      .mockResolvedValue(saved);
    expect(await service(transaction).create({ id: 'operator' } as AuthUser, input)).toBe(saved);
    expect(transaction).toHaveBeenCalledTimes(2);
  });
  it('竞争持续时最多3次尝试，返回可核对重试的409而非无限循环', async () => {
    const transaction = jest.fn().mockRejectedValue(databaseError('40P01'));
    await expect(
      service(transaction).create({ id: 'operator' } as AuthUser, input),
    ).rejects.toMatchObject({ response: { code: 'ORDER_BUSY' } });
    expect(transaction).toHaveBeenCalledTimes(3);
  });
  it('不重试其他SQL错误，也不将业务拒绝伪装为竞争', async () => {
    for (const failure of [databaseError('42501'), new ConflictException('价格变化')]) {
      const transaction = jest.fn().mockRejectedValue(failure);
      await expect(service(transaction).create({ id: 'operator' } as AuthUser, input)).rejects.toBe(
        failure,
      );
      expect(transaction).toHaveBeenCalledTimes(1);
    }
  });
});
