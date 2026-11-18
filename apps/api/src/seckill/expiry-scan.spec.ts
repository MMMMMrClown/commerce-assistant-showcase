import { Logger } from '@nestjs/common';
import { SeckillService } from './seckill.service';
type ScanQuery = { where: { OR?: unknown } };
type ScanRows = { id: string; expiresAt: Date }[];

describe('过期订单扫描恢复', () => {
  const at = new Date('2026-11-01T00:00:00Z');
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('单条异常不阻止后续订单，并在扫描末尾回绕重试', async () => {
    const findMany = jest
      .fn<Promise<ScanRows>, [ScanQuery]>()
      .mockResolvedValueOnce([
        { id: 'bad', expiresAt: at },
        { id: 'ok', expiresAt: at },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'bad', expiresAt: at }]);
    const expireSeckillOrder = jest.fn((id: string) => {
      if (id === 'bad') return Promise.reject(Error('secret'));
      return Promise.resolve(1);
    });
    const service = new SeckillService(
      { order: { findMany } } as unknown as ConstructorParameters<typeof SeckillService>[0],
      { expireSeckillOrder } as unknown as ConstructorParameters<typeof SeckillService>[1],
    );
    expect(await service.releaseExpired()).toBe(1);
    expect(await service.releaseExpired()).toBe(0);
    expect(findMany.mock.calls[1][0].where?.OR).toEqual([
      { expiresAt: { gt: at } },
      { expiresAt: at, id: { gt: 'ok' } },
    ]);
    expect(findMany.mock.calls[2][0].where?.OR).toBeUndefined();
    expect(expireSeckillOrder.mock.calls.map(([id]) => id)).toEqual(['bad', 'ok', 'bad']);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: 'bad', code: 'UNEXPECTED_ERROR' }),
    );
  });

  it('扫描中防重入，数据库失败后可以再次运行', async () => {
    let reject!: (reason: Error) => void;
    const findMany = jest
      .fn<Promise<ScanRows>, [ScanQuery]>()
      .mockImplementationOnce(
        () =>
          new Promise<ScanRows>((_, fail) => {
            reject = fail;
          }),
      )
      .mockResolvedValue([]);
    const service = new SeckillService(
      { order: { findMany } } as unknown as ConstructorParameters<typeof SeckillService>[0],
      {} as ConstructorParameters<typeof SeckillService>[1],
    );
    const first = service.releaseExpired();
    expect(await service.releaseExpired()).toBe(0);
    reject(Error('offline'));
    await expect(first).rejects.toThrow('offline');
    expect(await service.releaseExpired()).toBe(0);
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});
