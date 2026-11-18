import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { summaryPeriod } from './summary-period';
const period = z.object({ startDate: z.iso.date(), endDate: z.iso.date() }).strict();
export const comparisonSchema = z
  .object({
    current: period,
    previous: period,
    domain: z.enum(['sales', 'members', 'campaigns', 'payments']).default('sales'),
  })
  .strict();
const tools = {
  sales: 'query_sales_summary',
  members: 'query_member_statistics',
  campaigns: 'query_campaign_performance',
  payments: 'query_payment_summary',
};
export async function compareBusinessPeriods(
  input: unknown,
  summary: (name: string, args: unknown) => Promise<unknown>,
) {
  const args = comparisonSchema.parse(input),
    current = summaryPeriod(args.current),
    previous = summaryPeriod(args.previous);
  if (current.days !== previous.days)
    throw new BadRequestException('对比周期必须等长，避免将天数差异当成经营变化');
  if (previous.end >= current.start)
    throw new BadRequestException('对比的上期必须早于本期且不能重叠');
  const [a, b] = (await Promise.all([
    summary(tools[args.domain], args.current),
    summary(tools[args.domain], args.previous),
  ])) as { result: Record<string, unknown>; queriedAt: string }[];
  const deltas =
    args.domain === 'sales'
      ? Object.fromEntries(
          ['revenue', 'orderCount', 'averageOrderValue', 'productSales'].map((key) => {
            const now = Number(a.result[key]),
              before = Number(b.result[key]);
            return [
              key,
              {
                current: now,
                previous: before,
                difference: Number((now - before).toFixed(2)),
                changePercent: before ? Number((((now - before) / before) * 100).toFixed(2)) : null,
              },
            ];
          }),
        )
      : undefined;
  return {
    ok: true,
    domain: args.domain,
    current: a,
    previous: b,
    ...(deltas ? { deltas } : {}),
    definition:
      '等长不重叠日期区间、同一工具与权限范围比较。上期为0时增长率为null。会员总量与等级分布为当前快照，不是历史快照，不得做历史存量增长推断；只对带时间口径的新增/消费指标比较。分类金额是商品行原价，不能当实付或利润；相关性不能证明活动因果效果。',
    nextActions:
      '回答引用时间窗与证据，区分发现/假设/行动/验证指标；没有流量、库存或完整成本依据时不计算转化、周转或利润，不承诺未来收益。',
  };
}
