import { ConflictException, type ArgumentsHost } from '@nestjs/common';
import { assertStockAvailable } from './stock-feedback';
import { adjustStock, reserveStock } from './product-stock';
import { ApiExceptionFilter } from '../common/api';
const product = {
  id: 'p',
  name: '演示保温杯',
  enabled: true,
  deletedAt: null,
  stockOnHand: 5,
  stockReserved: 3,
  stockVersion: 2,
};
function errorOf(run: () => void) {
  try {
    run();
    throw Error('Expected failure');
  } catch (e) {
    expect(e).toBeInstanceOf(ConflictException);
    return (e as ConflictException).getResponse() as {
      code: string;
      message: string;
      details: Record<string, unknown>[];
    };
  }
}
describe('库存反馈', () => {
  it('未初始化数量保持未知，并给出初始化建议', () => {
    const e = errorOf(() =>
      assertStockAvailable({ ...product, stockOnHand: null, stockReserved: 0 }, 1),
    );
    expect(e.code).toBe('STOCK_NOT_INITIALIZED');
    expect(e.message).toContain('演示保温杯');
    expect(e.details[0]).toMatchObject({ availableQuantity: null, nextAction: 'INITIALIZE_STOCK' });
  });
  it('缺货返回可售数与需求数，不泄漏成本或其他订单', () => {
    const e = errorOf(() =>
      assertStockAvailable({ ...product, costPrice: 'secret' } as typeof product, 3),
    );
    expect(e.code).toBe('STOCK_INSUFFICIENT');
    expect(e.details[0]).toMatchObject({
      availableQuantity: 2,
      requiredQuantity: 3,
      nextAction: 'REQUOTE',
    });
    expect(JSON.stringify(e)).not.toContain('secret');
    expect(e.details[0]).not.toHaveProperty('orderId');
  });
  it('已初始化零库存与未初始化分开', () => {
    expect(
      errorOf(() => assertStockAvailable({ ...product, stockOnHand: 0, stockReserved: 0 }, 1)).code,
    ).toBe('STOCK_INSUFFICIENT');
  });
  it.each([{ enabled: false }, { deletedAt: new Date() }])(
    '下架与回收商品阻止购买 %p',
    (change) => {
      expect(errorOf(() => assertStockAvailable({ ...product, ...change }, 1)).code).toBe(
        'PRODUCT_UNAVAILABLE',
      );
    },
  );
  it('可售刚好足够时不改变余额', () => {
    const p = { ...product };
    expect(() => assertStockAvailable(p, 2)).not.toThrow();
    expect(p).toEqual(product);
  });
  it('事务内加锁后仍复核可售数量，失败前不写占用', async () => {
    const create = jest.fn(),
      tx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        product: { findUniqueOrThrow: () => Promise.resolve(product) },
        productStockHold: { create },
      };
    await expect(
      reserveStock(tx as never, 'o', [{ productId: 'p', quantity: 3 }], 'a'),
    ).rejects.toMatchObject({ response: { code: 'STOCK_INSUFFICIENT' } });
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
  it('库存版本冲突和占用下限均拒绝写入', async () => {
    const update = jest.fn(),
      tx = {
        $queryRaw: () => Promise.resolve([]),
        product: { findUniqueOrThrow: () => Promise.resolve(product), update },
        productStockMovement: { findUnique: () => Promise.resolve(null) },
      };
    await expect(adjustStock(tx as never, 'p', 5, 1, 'a', '调整', 'req', 0)).rejects.toMatchObject({
      response: { code: 'STOCK_CHANGED' },
    });
    await expect(adjustStock(tx as never, 'p', 2, 2, 'a', '调整', 'req', 0)).rejects.toMatchObject({
      response: {
        code: 'STOCK_RESERVED_CONFLICT',
        details: [
          {
            productId: 'p',
            productName: product.name,
            reservedQuantity: 3,
            requestedOnHand: 2,
            nextAction: 'CHECK_ACTIVE_ORDERS',
          },
        ],
      },
    });
    expect(update).not.toHaveBeenCalled();
  });
  it('原API错误格式保留message、details和requestId', () => {
    let error: unknown;
    try {
      assertStockAvailable(product, 3);
    } catch (e) {
      error = e;
    }
    const response = { status: jest.fn(), json: jest.fn() };
    response.status.mockReturnValue(response);
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ requestId: 'request-test' }),
      }),
    } as unknown as ArgumentsHost;
    new ApiExceptionFilter().catch(error, host);
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'STOCK_INSUFFICIENT',
        message: expect.stringContaining('可售库存为2件') as unknown,
        details: expect.any(Array) as unknown,
        requestId: 'request-test',
      }),
    );
  });
});
