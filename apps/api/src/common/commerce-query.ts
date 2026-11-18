import { BadRequestException } from '@nestjs/common';
// 上海自然日结束边界为次日零点。
export function commerceDateRange(start?: string, end?: string) {
  for (const value of [start, end])
    if (
      value !== undefined &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(new Date(value + 'T00:00:00Z').getTime()) ||
        new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value)
    )
      throw new BadRequestException('日期必须为真实的YYYY-MM-DD日期');
  if (start && end && start > end) throw new BadRequestException('开始日期不能晚于结束日期');
  return {
    ...(start ? { gte: new Date(start + 'T00:00:00+08:00') } : {}),
    ...(end ? { lt: new Date(new Date(end + 'T00:00:00+08:00').getTime() + 86400000) } : {}),
  };
}
