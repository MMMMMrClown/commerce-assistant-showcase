import { summaryPeriod } from './summary-period';
describe('新增精确分析时间窗', () => {
  it('历史自然月保持原起止日期', () => {
    expect(summaryPeriod({ startDate: '2026-10-01', endDate: '2026-10-31' }).q).toEqual({
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });
  });
  it('滚动窗口按上海日期计算', () => {
    expect(summaryPeriod({ days: 7 }, new Date('2026-11-11T23:00:00Z')).q).toEqual({
      startDate: '2026-11-06',
      endDate: '2026-11-12',
    });
  });
  it.each([
    { startDate: '2026-10-01' },
    { startDate: '2026-11-12', endDate: '2026-11-01' },
    { days: 7, startDate: '2026-11-01', endDate: '2026-11-12' },
    { startDate: '2026-01-01', endDate: '2026-12-31' },
  ])('拒绝缺项、倒序、冲突和过大区间 %j', (input) => expect(() => summaryPeriod(input)).toThrow());
});
