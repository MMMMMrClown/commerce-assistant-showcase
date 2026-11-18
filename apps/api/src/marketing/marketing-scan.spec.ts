import { Logger } from '@nestjs/common';
import { MarketingService } from './marketing.service';
type ScanQuery = { where: { OR?: unknown; status?: string; program?: unknown } };
type ScanRows = { id: string; createdAt: Date }[];

describe('会员营销扫描恢复', () => {
  const at = new Date('2026-11-01T00:00:00Z');
  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation());
  afterEach(() => jest.restoreAllMocks());

  it('生日资格失败、逐条技术异常和业务失败均不阻断已有队列', async () => {
    const findMany = jest
      .fn<Promise<ScanRows>, [ScanQuery]>()
      .mockResolvedValue(['throw', 'failed', 'paused', 'ok'].map((id) => ({ id, createdAt: at })));
    const service = new MarketingService(
      { marketingGrant: { findMany } } as unknown as ConstructorParameters<
        typeof MarketingService
      >[0],
      {} as ConstructorParameters<typeof MarketingService>[1],
    );
    jest.spyOn(service, 'enrollBirthdays').mockRejectedValue(Error('offline'));
    const process = jest.spyOn(service, 'process').mockImplementation((id) => {
      if (id === 'throw') return Promise.reject(Error('offline'));
      return Promise.resolve({
        status: id === 'failed' ? 'FAILED' : id === 'paused' ? 'PENDING' : 'SUCCEEDED',
      } as Awaited<ReturnType<MarketingService['process']>>);
    });
    expect(await service.sweep()).toEqual({
      busy: false,
      processed: 4,
      succeeded: 1,
      failed: 2,
      deferred: 1,
      enrollmentFailed: true,
    });
    expect(process).toHaveBeenCalledTimes(4);
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      status: 'PENDING',
      program: { enabled: true },
    });
  });

  it('不同玩法的扫描位置独立，到末尾回绕', async () => {
    const findMany = jest
      .fn<Promise<ScanRows>, [ScanQuery]>()
      .mockResolvedValueOnce([{ id: 'w', createdAt: at }])
      .mockResolvedValueOnce([{ id: 'b', createdAt: at }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const service = new MarketingService(
      { marketingGrant: { findMany } } as unknown as ConstructorParameters<
        typeof MarketingService
      >[0],
      {} as ConstructorParameters<typeof MarketingService>[1],
    );
    jest.spyOn(service, 'enrollBirthdays').mockResolvedValue(0);
    jest
      .spyOn(service, 'process')
      .mockResolvedValue({ status: 'PENDING' } as Awaited<ReturnType<MarketingService['process']>>);
    await service.sweep('WELCOME');
    await service.sweep('BIRTHDAY');
    await service.sweep('WELCOME');
    expect(findMany.mock.calls[1][0].where?.OR).toBeUndefined();
    expect(findMany.mock.calls[2][0].where?.OR).toEqual([
      { createdAt: { gt: at } },
      { createdAt: at, id: { gt: 'w' } },
    ]);
    expect(findMany.mock.calls[3][0].where?.OR).toBeUndefined();
  });

  it('队列查询失败后释放运行标记', async () => {
    const findMany = jest
      .fn<Promise<ScanRows>, [ScanQuery]>()
      .mockRejectedValueOnce(Error('offline'))
      .mockResolvedValue([]);
    const service = new MarketingService(
      { marketingGrant: { findMany } } as unknown as ConstructorParameters<
        typeof MarketingService
      >[0],
      {} as ConstructorParameters<typeof MarketingService>[1],
    );
    await expect(service.sweep('WELCOME')).rejects.toThrow('offline');
    expect(await service.sweep('WELCOME')).toMatchObject({ busy: false, processed: 0 });
  });
});
