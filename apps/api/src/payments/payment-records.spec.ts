import { PaymentsService } from './payments.service';
import type { AuthUser } from '../common/api';
describe('记录查询范围', () => {
  it.each(['payments', 'refunds'] as const)('%s筛选不能覆盖账号范围', async (kind) => {
    const model = {
      findMany: jest.fn().mockResolvedValue([{ amount: '12.30', actorId: 'a' }]),
      count: jest.fn().mockResolvedValue(1),
    };
    const service = new PaymentsService(
      {
        paymentRecord: model,
        refundRecord: model,
        user: { findMany: jest.fn().mockResolvedValue([]) },
        $transaction: (values: Promise<unknown>[]) => Promise.all(values),
      } as never,
      { orderWhere: () => ({ storeId: 'allowed' }) } as never,
      {} as never,
      {} as never,
    );
    const result: unknown = await service.records({} as AuthUser, kind, 2, 'ORDER', {
      orderId: 'other-order',
    });
    expect(model.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 20,
        where: expect.objectContaining({
          order: { AND: [{ deletedAt: null }, { storeId: 'allowed' }, { id: 'other-order' }] },
        }) as unknown,
      }),
    );
    expect(result).toMatchObject({ total: 1, items: [{ amount: '12.30' }] });
  });
});
