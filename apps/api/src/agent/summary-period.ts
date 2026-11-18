import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
export const summaryPeriodSchema = z
  .object({
    days: z.number().int().min(1).max(90).optional(),
    startDate: z.iso.date().optional(),
    endDate: z.iso.date().optional(),
  })
  .strict();
// 【分析时间窗】支持精确自然月/历史区间，避免把“上个月”误查成滚动30天。
export function summaryPeriod(input: unknown, now = new Date()) {
  const parsed = summaryPeriodSchema.safeParse(input);
  if (!parsed.success) throw new BadRequestException('查询时间参数无效，只支持days或完整起止日期');
  const args = parsed.data;
  if (Boolean(args.startDate) !== Boolean(args.endDate))
    throw new BadRequestException('开始和结束日期必须同时提供');
  if (args.startDate && args.days !== undefined)
    throw new BadRequestException('精确日期与滚动天数不能同时提供');
  const endDate = args.endDate || now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const end = new Date(endDate + 'T23:59:59.999+08:00');
  const start = args.startDate
    ? new Date(args.startDate + 'T00:00:00+08:00')
    : new Date(end.getTime() - (args.days ?? 30) * 86400000 + 1);
  const days = Math.round((end.getTime() - start.getTime() + 1) / 86400000);
  if (days < 1 || days > 90)
    throw new BadRequestException('单次查询区间必须为1至90天，请拆分较长区间');
  return {
    days,
    start,
    end,
    q: { startDate: start.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }), endDate },
  };
}
