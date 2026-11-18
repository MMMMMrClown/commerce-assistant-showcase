import { MembersService } from './members.service';
describe('会员状态列表', () => {
  it.each(['true', 'false'])('启停筛选%s在服务端分页前应用', async (enabled) => {
    const findMany = jest.fn().mockResolvedValue([]),
      count = jest.fn().mockResolvedValue(0);
    const service = new MembersService(
      {
        member: { findMany, count },
        $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
      } as never,
      { policy: () => Promise.resolve({}) } as never,
    );
    await service.list({ enabled, page: '2', pageSize: '20' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 20,
        take: 20,
        where: { AND: expect.arrayContaining([{ enabled: enabled === 'true' }]) as unknown },
      }),
    );
  });
});
