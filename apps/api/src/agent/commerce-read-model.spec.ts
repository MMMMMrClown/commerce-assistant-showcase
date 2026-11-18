import { inventoryView, fulfillmentView } from './commerce-read-model';
import { AgentActions, type ExecutionContext } from './actions';
import type { AuthUser } from '../common/api';

describe('Agent现行业务读取', () => {
  afterEach(() => jest.restoreAllMocks());
  it('预警目录使用固定授权路由，输出库存但剔除成本', async () => {
    const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            items: [
              { id: 'p', stockOnHand: 8, stockReserved: 6, stockWarning: 2, costPrice: 'secret' },
            ],
            total: 1,
          },
        }),
    } as Response);
    const actions = new AgentActions(
      {} as never,
      {} as never,
      {} as never,
      { get: () => 3200 } as never,
      {} as never,
      {} as never,
    );
    const result = await actions.catalog(
      { permissions: ['product:view'] } as AuthUser,
      { credential: 'synthetic' } as ExecutionContext,
      'products',
      { state: 'warning' },
      {},
    );
    expect(result.items[0]).toMatchObject({ stockAvailable: 2, stockLow: true });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(fetcher.mock.calls[0][0] as string).toContain('/api/v1/products?');
    expect(new URL(fetcher.mock.calls[0][0] as string).searchParams.get('state')).toBe('warning');
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer synthetic' });
  });
  it('库存流水只读且无权限时不调用业务接口', async () => {
    const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            items: [
              {
                id: 'm',
                kind: 'RESERVE',
                beforeOnHand: 8,
                afterOnHand: 8,
                beforeReserved: 0,
                afterReserved: 2,
                reason: 'private',
                actorId: 'private',
              },
            ],
            page: 1,
            total: 1,
            pageSize: 20,
          },
        }),
    } as Response);
    const actions = new AgentActions(
      {} as never,
      {} as never,
      {} as never,
      { get: () => 3200 } as never,
      {} as never,
      {} as never,
    );
    const ctx = { credential: 'synthetic' } as ExecutionContext;
    const result = await actions.stockMovements(
      { permissions: ['product:view'] } as AuthUser,
      ctx,
      { productId: 'p' },
    );
    expect(result.items[0]).toMatchObject({ kind: 'RESERVE', afterReserved: 2 });
    expect(JSON.stringify(result)).not.toContain('private');
    await expect(
      actions.stockMovements({ permissions: [] } as unknown as AuthUser, ctx, { productId: 'p' }),
    ).rejects.toThrow('权限');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('未初始化不当成0，现存减占用且不会返回成本', () => {
    expect(inventoryView({ stockOnHand: null, costPrice: 100 })).toMatchObject({
      stockInitialized: false,
      stockAvailable: null,
      stockLow: null,
    });
    expect(
      inventoryView({ stockOnHand: 10, stockReserved: 7, stockWarning: 3, costPrice: 100 }),
    ).toEqual({
      stockInitialized: true,
      stockOnHand: 10,
      stockReserved: 7,
      stockAvailable: 3,
      stockWarning: 3,
      stockLow: true,
    });
  });
  it('同为PAID按真实发货记录区分，历史单不补造履约', () => {
    const base = { status: 'PAID', source: 'BACKOFFICE' };
    expect(fulfillmentView(base).fulfillmentStage).toBe('AWAITING_SHIPMENT');
    expect(fulfillmentView({ ...base, shippedAt: new Date() }).fulfillmentStage).toBe(
      'AWAITING_RECEIPT',
    );
    expect(fulfillmentView({ ...base, status: 'COMPLETED' }).fulfillmentStage).toBe(
      'HISTORICAL_COMPLETED',
    );
    expect(
      fulfillmentView({ ...base, status: 'COMPLETED', receivedAt: new Date() }).fulfillmentStage,
    ).toBe('RECEIVED');
    expect(fulfillmentView({ ...base, source: 'CSV_IMPORT' }).fulfillmentStage).toBe(
      'NOT_APPLICABLE',
    );
  });
  it('订单详情沿用当前身份Service，不泄漏无关字段', async () => {
    const detail = jest.fn().mockResolvedValue({
      id: 'o',
      status: 'PAID',
      source: 'BACKOFFICE',
      shippedAt: new Date(),
      payableAmount: { toFixed: () => '10.00' },
      paidAmount: { toFixed: () => '10.00' },
      privateNote: 'secret',
      items: [
        {
          productId: 'p',
          productName: '合成商品',
          productCode: 'P',
          quantity: 3,
          unitPrice: { toFixed: () => '2.00' },
          subtotal: { toFixed: () => '6.00' },
          costPrice: 'secret-cost',
        },
      ],
    });
    const actions = new AgentActions(
      {} as never,
      { detail } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const user = { permissions: ['order:view'] } as AuthUser;
    expect(await actions.getOrder(user, { orderId: 'o' })).toMatchObject({
      fulfillmentStage: 'AWAITING_RECEIPT',
      items: [{ productId: 'p', quantity: 3, subtotal: '6.00' }],
    });
    expect(detail).toHaveBeenCalledWith(user, 'o');
    await expect(
      actions.getOrder({ permissions: [] } as unknown as AuthUser, { orderId: 'o' }),
    ).rejects.toThrow('权限');
    expect(detail).toHaveBeenCalledTimes(1);
  });
});
