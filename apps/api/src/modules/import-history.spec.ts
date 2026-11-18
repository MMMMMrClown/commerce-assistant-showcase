import { ImportsService } from './resources';

describe('导入历史跨页筛选', () => {
  it('列表与分页总数使用同一状态条件，标签计数覆盖全部记录', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'ready-21', status: 'READY' }]);
    const count = jest.fn().mockResolvedValue(41);
    const groupBy = jest.fn().mockResolvedValue([
      { status: 'READY', _count: { _all: 41 } },
      { status: 'IMPORTED', _count: { _all: 120 } },
    ]);
    const db = {
      dataImport: { findMany, count, groupBy },
      $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
    };
    const result = await new ImportsService(db as never).history({
      status: 'READY',
      page: '2',
      pageSize: '20',
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'READY' }, skip: 20, take: 20 }),
    );
    expect(count).toHaveBeenCalledWith({ where: { status: 'READY' } });
    expect(result).toMatchObject({
      total: 41,
      page: 2,
      statusCounts: { '': 161, READY: 41, IMPORTED: 120, FAILED: 0 },
    });
  });
  it('非法状态拒绝查询', async () => {
    await expect(new ImportsService({} as never).history({ status: 'invalid' })).rejects.toThrow(
      '导入状态无效',
    );
  });
});
