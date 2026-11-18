import { transactionService } from './transaction-service';

it('业务嵌套调用复用同一事务，失败传播给外层回滚', async () => {
  const query = jest.fn().mockResolvedValue('row');
  const tx = { product: { findUnique: query } };
  const service = transactionService(tx as never);
  expect(
    await service.$transaction(async (inner) => {
      expect(inner.product).toBe(tx.product);
      return inner.product.findUnique({ where: { id: 'p' } });
    }),
  ).toBe('row');
  await expect(service.$transaction(() => Promise.reject(new Error('rollback')))).rejects.toThrow(
    'rollback',
  );
});
